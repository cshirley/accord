/**
 * Provider definitions — single source of truth for external service
 * connectivity (MCP tools, CLI fallbacks, env vars) and the location
 * of each provider's fetch playbook.
 *
 * Bundled providers are loaded from `assets/providers/{trackers,enrichments}/*.json`
 * sidecars (paired with their `<name>.md` playbook). User-supplied
 * providers are declared inline in `accord.json` under the
 * top-level `providers` array.
 *
 * Used by gather-preflight to check availability before dispatching
 * to phase-gather, and by phase-gather (via the injected report) to
 * locate the playbook for the active provider.
 */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { EXT_DIR } from "../core/config/paths.js";

// ── Types ──────────────────────────────────────────────────

export type ProviderKind = "tracker" | "enrichment";

export interface ProviderDef {
  name: string;
  kind: ProviderKind;
  label: string;
  mcpTools: string[];
  cliFallback: string | null;
  envFallback: string | null;
  /** Resolved absolute path to the markdown fetch playbook. */
  promptFile: string;
}

export interface DepCheckResult {
  provider: string;
  label: string;
  available: boolean;
  method: "mcp" | "cli" | "env" | "none" | "not-needed";
  detail: string;
  promptFile: string;
}

export interface ProviderSet {
  trackers: Map<string, ProviderDef>;
  enrichments: Map<string, ProviderDef>;
}

// ── Bundled provider loader ────────────────────────────────

const TRACKERS_DIR = join(EXT_DIR, "assets", "providers", "trackers");
const ENRICHMENTS_DIR = join(EXT_DIR, "assets", "providers", "enrichments");

let _bundled: ProviderSet | null = null;

function readSidecarsFrom(dir: string, kind: ProviderKind): Map<string, ProviderDef> {
  const map = new Map<string, ProviderDef>();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return map;
  }

  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (raw?.kind !== kind || typeof raw?.name !== "string") continue;

    const promptFile = typeof raw.promptFile === "string" && raw.promptFile.length > 0
      ? (isAbsolute(raw.promptFile) ? raw.promptFile : join(dir, raw.promptFile))
      : join(dir, `${raw.name}.md`);

    map.set(raw.name, {
      name: raw.name,
      kind,
      label: typeof raw.label === "string" ? raw.label : raw.name,
      mcpTools: Array.isArray(raw.mcpTools) ? raw.mcpTools.filter((t: unknown): t is string => typeof t === "string") : [],
      cliFallback: typeof raw.cliFallback === "string" ? raw.cliFallback : null,
      envFallback: typeof raw.envFallback === "string" ? raw.envFallback : null,
      promptFile,
    });
  }
  return map;
}

export function loadBundledProviders(): ProviderSet {
  if (_bundled) return _bundled;
  _bundled = {
    trackers: readSidecarsFrom(TRACKERS_DIR, "tracker"),
    enrichments: readSidecarsFrom(ENRICHMENTS_DIR, "enrichment"),
  };
  return _bundled;
}

// ── User-supplied providers (accord.json `providers`) ────

function expandUserPath(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function normaliseUserProvider(raw: unknown): ProviderDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || !r.name) return null;
  if (r.kind !== "tracker" && r.kind !== "enrichment") return null;
  if (typeof r.promptFile !== "string" || !r.promptFile) return null;

  return {
    name: r.name,
    kind: r.kind,
    label: typeof r.label === "string" ? r.label : r.name,
    mcpTools: Array.isArray(r.mcpTools) ? r.mcpTools.filter((t): t is string => typeof t === "string") : [],
    cliFallback: typeof r.cliFallback === "string" ? r.cliFallback : null,
    envFallback: typeof r.envFallback === "string" ? r.envFallback : null,
    promptFile: expandUserPath(r.promptFile),
  };
}

export function loadUserProviders(defs: unknown[] | undefined | null): ProviderSet {
  const out: ProviderSet = { trackers: new Map(), enrichments: new Map() };
  if (!Array.isArray(defs)) return out;
  for (const raw of defs) {
    const def = normaliseUserProvider(raw);
    if (!def) continue;
    (def.kind === "tracker" ? out.trackers : out.enrichments).set(def.name, def);
  }
  return out;
}

/**
 * Merge bundled + user providers. User-defined providers with the
 * same name as a bundled provider override the bundled definition,
 * which lets projects swap out the playbook or connectivity for a
 * given provider name.
 */
export function loadAllProviders(userDefs?: unknown[] | null): ProviderSet {
  const bundled = loadBundledProviders();
  const user = loadUserProviders(userDefs);
  return {
    trackers: new Map([...bundled.trackers, ...user.trackers]),
    enrichments: new Map([...bundled.enrichments, ...user.enrichments]),
  };
}

// ── Availability check ─────────────────────────────────────

export function checkProviderDeps(def: ProviderDef, allToolNames: Set<string>): DepCheckResult {
  const base = { provider: def.name, label: def.label, promptFile: def.promptFile };

  // No deps needed (e.g. plain-text)
  if (def.mcpTools.length === 0 && !def.cliFallback && !def.envFallback) {
    return { ...base, available: true, method: "not-needed", detail: "no external deps" };
  }

  // Prefer MCP
  const mcpMatch = def.mcpTools.find(t => allToolNames.has(t));
  if (mcpMatch) {
    return { ...base, available: true, method: "mcp", detail: mcpMatch };
  }

  // CLI fallback
  if (def.cliFallback) {
    try {
      execSync(`which ${def.cliFallback}`, { stdio: "ignore", timeout: 2000 });
      return { ...base, available: true, method: "cli", detail: def.cliFallback };
    } catch { /* not found or timed out */ }
  }

  // Env-var fallback
  if (def.envFallback && process.env[def.envFallback]) {
    return { ...base, available: true, method: "env", detail: `$${def.envFallback}` };
  }

  // Unavailable
  const tried: string[] = [];
  if (def.mcpTools.length > 0) tried.push(`MCP: ${def.mcpTools.join(" | ")}`);
  if (def.cliFallback) tried.push(`CLI: ${def.cliFallback}`);
  if (def.envFallback) tried.push(`env: $${def.envFallback}`);
  return { ...base, available: false, method: "none", detail: tried.join("; ") };
}

// ── Preflight report formatting ────────────────────────────

export function formatPreflightReport(tracker: DepCheckResult | null, enrichments: DepCheckResult[]): string {
  const lines: string[] = ["\n── Gather Preflight ─ Source Availability ─────────────"];

  if (tracker) {
    const icon = tracker.available ? "✓" : "✗";
    const via = tracker.available ? ` via ${tracker.method} (${tracker.detail})` : ` — UNAVAILABLE (tried: ${tracker.detail})`;
    lines.push(`  ${icon} Tracker: ${tracker.label}${via}`);
  }

  if (enrichments.length > 0) {
    lines.push("  Enrichments:");
    for (const e of enrichments) {
      const icon = e.available ? "✓" : "✗";
      const via = e.available ? ` via ${e.method} (${e.detail})` : ` — UNAVAILABLE (tried: ${e.detail})`;
      lines.push(`    ${icon} ${e.label}${via}`);
    }
  }

  const unavailable = [tracker, ...enrichments].filter(r => r && !r.available);
  if (unavailable.length > 0) {
    lines.push("");
    lines.push(`  ⚠ ${unavailable.length} source(s) unavailable — gather will skip these or use degraded fallbacks.`);
  } else {
    lines.push("");
    lines.push("  ✓ All configured sources available.");
  }

  // Resolved playbook paths — phase-gather reads these directly so
  // user-supplied providers (with paths outside the bundled tree)
  // work without prompt edits.
  const playbooks: { kind: string; provider: string; path: string }[] = [];
  if (tracker) playbooks.push({ kind: "Tracker", provider: tracker.provider, path: tracker.promptFile });
  for (const e of enrichments) playbooks.push({ kind: "Enrichment", provider: e.provider, path: e.promptFile });
  if (playbooks.length > 0) {
    lines.push("");
    lines.push("  Provider Playbooks (read from these absolute paths):");
    for (const p of playbooks) {
      lines.push(`    ${p.kind} (${p.provider}): ${p.path}`);
    }
  }

  lines.push("───────────────────────────────────────────────────────");
  return lines.join("\n");
}
