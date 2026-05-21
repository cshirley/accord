/**
 * Usage tracking — pricing, cost accounting, run tags, and work item discovery.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXT_DIR } from "../config/paths.js";
import { createLogger } from "../logging.js";
import {
  mutateJson,
  WORK_ITEM_FILE_PATTERN,
  WORK_ITEM_ID_PATTERN,
  writeJson,
} from "../work-items/io.js";
import type { WorkItem } from "../work-items/types.js";

const log = createLogger("usage");

// ── Types ──────────────────────────────────────────────────

interface PricingEntry {
  input: number;
  output: number;
}

export interface PricingConfig {
  unit: string;
  default: PricingEntry;
  models: Record<string, PricingEntry>;
}

export interface UsageLine {
  at: string;
  work_item_id: string;
  /** Logical phase slot: phase agent name or "orchestrator" for the main session. */
  subagent_type: string;
  model: string | undefined;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens: number;
    turns: number;
  };
  /** Where usage was billed: isolated subagent pi vs main orchestrator turns. */
  source?: "subagent" | "orchestrator";
  /** Correlate `.tasks/<id>-usage.jsonl` rows for post-analysis (see /dev tag). */
  harness_run_id?: string;
  harness_session_tag?: string;
}

/** Persisted by /dev tag or auto-provisioned from the active work item. */
export interface HarnessRunMeta {
  run_id: string;
  tag: string;
  updated_at: string;
  /** True when tag was inferred from work item id (first billable harness usage). */
  auto?: boolean;
  /** All work items that have recorded usage in this session. Allows retro/session
   *  analysis to correlate a single run_id with multiple parallel work items. */
  work_item_ids?: string[];
}

export interface WorkItemSummary {
  id: string;
  phase: string;
  pattern: string;
  cost_usd: number;
  decisions_pending: number;
}

// ── Pricing ────────────────────────────────────────────────

const HARNESS_RUN_META_PATH = path.join(".tasks", ".harness-run.json");

const DEFAULT_PRICING: PricingConfig = {
  unit: "usd_per_million_tokens",
  default: { input: 3.0, output: 15.0 },
  models: {},
};

function resolvePricingPath(): string | null {
  try {
    const candidate = path.join(EXT_DIR, "schemas", "model-pricing.json");
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    /* bundled or unavailable */
  }
  return null;
}

// ── Harness run tagging (session → usage analytics) ────────

export function readHarnessRunMeta(): HarnessRunMeta | null {
  try {
    if (!fs.existsSync(HARNESS_RUN_META_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(HARNESS_RUN_META_PATH, "utf8"));
    if (raw && typeof raw.run_id === "string" && typeof raw.tag === "string")
      return raw as HarnessRunMeta;
  } catch {
    /* ignore */
  }
  return null;
}

export function resolveHarnessRunContext(): Partial<
  Pick<UsageLine, "harness_run_id" | "harness_session_tag">
> {
  const envTag = process.env.DEV_HARNESS_RUN_TAG?.trim();
  const envRunId = process.env.DEV_HARNESS_RUN_ID?.trim();
  const fileMeta = readHarnessRunMeta();
  return {
    harness_session_tag: envTag || fileMeta?.tag,
    harness_run_id: envRunId || fileMeta?.run_id,
  };
}

export function setHarnessRunTag(label: string, opts?: { newRunId?: boolean }): HarnessRunMeta {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Tag must be non-empty");
  const prev = readHarnessRunMeta();
  const meta: HarnessRunMeta = {
    run_id: opts?.newRunId ? randomUUID() : (prev?.run_id ?? randomUUID()),
    tag: trimmed,
    updated_at: new Date().toISOString(),
  };
  // writeJson is atomic (tmp + fsync + rename) so concurrent readers in
  // hooks never observe a torn file.
  writeJson(HARNESS_RUN_META_PATH, meta);
  return meta;
}

/**
 * Ensure a harness run record exists for this session.
 *
 * On first call: creates meta with this work item as the tag.
 * On subsequent calls with a different work item: adds it to work_item_ids
 * but does NOT overwrite the tag (avoids flip-flopping in parallel sessions).
 * The run_id is session-stable and is the primary correlator for retro/analytics.
 */
export function ensureAutoHarnessRunMeta(workItemId: string): void {
  if (process.env.DEV_HARNESS_RUN_TAG?.trim() || process.env.DEV_HARNESS_RUN_ID?.trim()) return;
  const existing = readHarnessRunMeta();

  if (existing) {
    const ids = existing.work_item_ids ?? [existing.tag];
    if (ids.includes(workItemId)) return;
    try {
      ids.push(workItemId);
      const meta: HarnessRunMeta = {
        ...existing,
        work_item_ids: ids,
        updated_at: new Date().toISOString(),
      };
      writeJson(HARNESS_RUN_META_PATH, meta);
    } catch (e) {
      log.warn(`failed to update harness run meta: ${e}`);
    }
    return;
  }

  try {
    const meta: HarnessRunMeta = {
      run_id: randomUUID(),
      tag: workItemId,
      updated_at: new Date().toISOString(),
      auto: true,
      work_item_ids: [workItemId],
    };
    writeJson(HARNESS_RUN_META_PATH, meta);
  } catch (e) {
    log.warn(`failed to write harness run meta: ${e}`);
  }
}

export function clearHarnessRunTag(): void {
  try {
    if (fs.existsSync(HARNESS_RUN_META_PATH)) fs.unlinkSync(HARNESS_RUN_META_PATH);
  } catch {
    /* ignore */
  }
}

export function describeHarnessRunMeta(): string {
  const envTag = process.env.DEV_HARNESS_RUN_TAG?.trim();
  const envRunId = process.env.DEV_HARNESS_RUN_ID?.trim();
  if (envTag || envRunId) {
    const parts = [
      `DEV_HARNESS_RUN_TAG=${envTag || "(unset)"}`,
      `DEV_HARNESS_RUN_ID=${envRunId || "(unset)"}`,
    ];
    return `Harness run (environment overrides file):\n  ${parts.join("\n  ")}`;
  }
  const m = readHarnessRunMeta();
  if (!m)
    return "No harness run tag yet - it will auto-set on first billable usage for a work item, or use `/dev tag <label>`.";
  const prov = m.auto ? " (auto)" : "";
  const ids = m.work_item_ids ?? [m.tag];
  const idLine = ids.length > 1 ? `  work_items: ${ids.join(", ")}` : `  tag:    ${m.tag}`;
  return `Harness run${prov}:\n${idLine}\n  run_id: ${m.run_id}\n  updated_at: ${m.updated_at}`;
}

/** Normalize provider usage.cost (number vs { total }) for append + rollup. */
export function normalizeUsageCostFields(usage: unknown): UsageLine["usage"] {
  const u = (usage && typeof usage === "object" ? usage : {}) as {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: unknown;
    totalTokens?: number;
    contextTokens?: number;
    turns?: number;
  };
  let cost = 0;
  const c = u.cost as number | { total?: number } | undefined;
  if (typeof c === "number") cost = c;
  else if (c && typeof c === "object" && typeof c.total === "number") cost = c.total;

  return {
    input: u.input || 0,
    output: u.output || 0,
    cacheRead: u.cacheRead || 0,
    cacheWrite: u.cacheWrite || 0,
    cost,
    contextTokens: u.contextTokens ?? u.totalTokens ?? 0,
    turns: u.turns ?? 0,
  };
}

function extractTextFromUserMessageContent(content: unknown[] | undefined): string {
  if (!content) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text"
    ) {
      parts.push(String((block as { text?: string }).text ?? ""));
    }
  }
  return parts.join("\n");
}

/** Walk session branch (chronological); collect user-visible text payloads. */
function collectUserTextsFromBranch(ctx: ExtensionContext): string[] {
  const out: string[] = [];
  try {
    for (const e of ctx.sessionManager.getBranch()) {
      if (e.type !== "message") continue;
      const m = e.message as { role?: string; content?: unknown[] };
      if (m.role !== "user") continue;
      const t = extractTextFromUserMessageContent(m.content);
      if (t) out.push(t);
    }
  } catch {
    /* no session */
  }
  return out;
}

/**
 * Resolve work item for attributing orchestrator usage: active subagent WI,
 * last user mention of PROJ-123, or single WI in .tasks/.
 *
 * Only accepts IDs that correspond to an actual .tasks/<ID>.json file to avoid
 * false positives from example text in tool descriptions (e.g. "ACCORD-1234").
 */
export function inferWorkItemIdFromSession(
  ctx: ExtensionContext,
  activeWorkItem: string | null,
): string | null {
  if (activeWorkItem) return activeWorkItem;
  const knownIds = new Set(discoverWorkItems().map((i) => i.id));
  if (knownIds.size === 0) return null;
  // Before falling back to the single-item shortcut, prefer an explicit
  // mention in the user's recent messages — that handles the case where the
  // user starts a new conversation after /clear with an unrelated topic.
  const texts = collectUserTextsFromBranch(ctx);
  for (let i = texts.length - 1; i >= 0; i--) {
    const id = extractWorkItemId(texts[i]);
    if (id && knownIds.has(id)) return id;
  }
  if (knownIds.size === 1) {
    const onlyId = [...knownIds][0];
    log.debug(
      `attributing usage to single existing work item ${onlyId} (no active WI, no explicit mention)`,
    );
    return onlyId;
  }
  return null;
}

export function loadPricing(): PricingConfig {
  const pricingPath = resolvePricingPath();
  if (!pricingPath) return DEFAULT_PRICING;
  try {
    return JSON.parse(fs.readFileSync(pricingPath, "utf8"));
  } catch {
    return DEFAULT_PRICING;
  }
}

export function pricingFor(pricing: PricingConfig, modelId?: string): PricingEntry {
  if (modelId) {
    if (pricing.models[modelId]) return pricing.models[modelId];
    const bare = modelId.replace(/^[^/]+\//, "");
    if (pricing.models[bare]) return pricing.models[bare];
    const normalised = bare.replace(/\./g, "-");
    for (const [key, val] of Object.entries(pricing.models)) {
      if (key.replace(/\./g, "-") === normalised) return val;
    }
  }
  return pricing.default;
}

// ── Work item ID extraction ────────────────────────────────

/**
 * Extract a work-item ID from arbitrary text. The regex is unanchored so it
 * may match incidental tokens (e.g. "HTTP-200", "ABC-1234" in an example
 * embedded in a brief). Pass `mustExist: true` to filter the result against
 * `.tasks/<ID>.json` so attribution can't drift onto IDs that aren't real
 * work items in this project.
 */
export function extractWorkItemId(task: string, opts?: { mustExist?: boolean }): string | null {
  const match = task.match(WORK_ITEM_ID_PATTERN);
  if (!match) return null;
  const id = match[0];
  if (opts?.mustExist) {
    const known = new Set(discoverWorkItems().map((i) => i.id));
    return known.has(id) ? id : null;
  }
  return id;
}

// ── Usage persistence ──────────────────────────────────────

export function appendUsageLine(workItemId: string, line: UsageLine): void {
  const jsonlPath = path.join(".tasks", `${workItemId}-usage.jsonl`);
  try {
    fs.mkdirSync(".tasks", { recursive: true });
    const ctx = resolveHarnessRunContext();
    const merged: UsageLine = {
      ...line,
      ...(ctx.harness_run_id ? { harness_run_id: ctx.harness_run_id } : {}),
      ...(ctx.harness_session_tag ? { harness_session_tag: ctx.harness_session_tag } : {}),
    };
    fs.appendFileSync(jsonlPath, `${JSON.stringify(merged)}\n`);
  } catch (e) {
    log.warn(`failed to append usage line for ${workItemId}: ${e}`);
  }
}

export function recomputeCost(workItemId: string, pricing: PricingConfig): number {
  const jsonlPath = path.join(".tasks", `${workItemId}-usage.jsonl`);
  if (!fs.existsSync(jsonlPath)) return 0;

  let totalCost = 0;
  try {
    const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry: UsageLine = JSON.parse(line);
      totalCost += computeLineCost(entry, pricing);
    }
  } catch (e) {
    log.warn(`failed to recompute cost for ${workItemId}: ${e}`);
  }
  return totalCost;
}

/** Compute cost for a single usage line. Used by the in-memory cache for incremental updates. */
export function computeLineCost(line: UsageLine, pricing: PricingConfig): number {
  const rates = pricingFor(pricing, line.model);
  const u = line.usage;
  const lineCost = typeof u.cost === "number" ? u.cost : 0;
  if (lineCost > 0) return lineCost;
  const inputTokens = u.input + (u.cacheRead ?? 0) * 0.1;
  return (inputTokens * rates.input) / 1_000_000 + (u.output * rates.output) / 1_000_000;
}

export function updateWorkItemCost(workItemId: string, cost: number): void {
  const wiPath = path.join(".tasks", `${workItemId}.json`);
  if (!fs.existsSync(wiPath)) return;
  try {
    mutateJson<WorkItem>(wiPath, (wi) => {
      if (!wi) return;
      wi.cost_usd = Math.round(cost * 10000) / 10000;
      wi.updated = new Date().toISOString();
    });
  } catch (e) {
    log.warn(`failed to update work item cost for ${workItemId}: ${e}`);
  }
}

// ── Work item discovery ────────────────────────────────────

export function discoverWorkItems(): WorkItemSummary[] {
  const tasksDir = ".tasks";
  if (!fs.existsSync(tasksDir)) return [];

  const items: WorkItemSummary[] = [];
  try {
    for (const file of fs.readdirSync(tasksDir)) {
      if (!WORK_ITEM_FILE_PATTERN.test(file)) continue;
      try {
        const wi = JSON.parse(fs.readFileSync(path.join(tasksDir, file), "utf8"));
        items.push({
          id: wi.id,
          phase: wi.phase,
          pattern: wi.pattern,
          cost_usd: wi.cost_usd || 0,
          decisions_pending: (wi.decisions || []).filter(
            (d: unknown) => (d as { status?: string }).status === "pending",
          ).length,
        });
      } catch {}
    }
  } catch {
    /* .tasks not readable */
  }
  return items;
}
