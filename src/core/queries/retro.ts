/**
 * Retrospective analysis for harness runs.
 *
 * Reads pi-insights metadata/cache plus raw Pi session JSONL to find sessions
 * associated with ACCORD runs, then groups friction into shift-left
 * opportunities for harness design.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface InsightMeta {
  sessionId?: string;
  path?: string;
  cwd?: string;
  timestamp?: string;
  firstPrompt?: string;
  toolErrors?: number;
  conversationSnippet?: string;
}

interface InsightCache {
  underlyingGoal?: string;
  outcome?: string;
  friction?: string;
  frictionCounts?: Record<string, number>;
  briefSummary?: string;
  userInstructionsToClaude?: string[];
}

interface HarnessMarker {
  harness_run_id?: string;
  harness_session_tag?: string;
  work_item_id?: string;
  auto_provisioned?: boolean;
  updated_at?: string;
}

interface RetroSession {
  session_id: string;
  timestamp?: string;
  cwd?: string;
  first_prompt?: string;
  outcome?: string;
  friction?: string;
  brief_summary?: string;
  marker?: HarnessMarker;
  associated_by: "marker" | "legacy_heuristic";
  shift_left: ShiftLeftFinding[];
}

export interface ShiftLeftFinding {
  category:
    | "intent_scoping"
    | "artifact_preflight"
    | "tool_environment"
    | "subagent_reliability"
    | "terminal_outcome"
    | "spec_plan_gap";
  evidence: string;
  recommendation: string;
}

export interface DevRetroOptions {
  insights_dir?: string;
  include_legacy_heuristic?: boolean;
  limit?: number;
  since?: string;
  work_item_id?: string;
}

export interface DevRetroResult {
  insights_dir: string;
  sessions_examined: number;
  harness_sessions: number;
  outcome_counts: Record<string, number>;
  friction_counts: Record<string, number>;
  top_shift_left: Array<{
    category: ShiftLeftFinding["category"];
    count: number;
    recommendation: string;
  }>;
  sessions: RetroSession[];
  formatted: string;
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function defaultInsightsDir(): string {
  const cwdDir = path.join(process.cwd(), "insights");
  if (fs.existsSync(cwdDir)) return cwdDir;
  return path.join(os.homedir(), ".config", "pi", "agent", "insights");
}

function listJsonFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function readHarnessMarker(sessionPath?: string): HarnessMarker | null {
  if (!sessionPath || !fs.existsSync(sessionPath)) return null;
  try {
    const lines = fs.readFileSync(sessionPath, "utf8").split("\n");
    let latest: HarnessMarker | null = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (entry.type === "custom" && entry.customType === "dev-harness-run") {
        latest = entry.data || {};
      }
    }
    return latest;
  } catch {
    return null;
  }
}

function textBlob(meta: InsightMeta, cache: InsightCache | null): string {
  return [
    meta.firstPrompt,
    meta.conversationSnippet,
    cache?.underlyingGoal,
    cache?.briefSummary,
    cache?.friction,
    ...(cache?.userInstructionsToClaude || []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function isLegacyHarnessSession(blob: string): boolean {
  return /\bdev[- ]harness\b|\/skill:(accord|dev)|\/dev\b|\.tasks\/|phase-(align|spec|plan|code|verify)/i.test(
    blob,
  );
}

function matchesWorkItemFilter(
  meta: InsightMeta,
  cache: InsightCache | null,
  marker: HarnessMarker | null,
  workItemId?: string,
): boolean {
  if (!workItemId) return true;
  if (marker?.work_item_id === workItemId || marker?.harness_session_tag === workItemId)
    return true;
  return textBlob(meta, cache).includes(workItemId.toLowerCase());
}

function addCount(map: Record<string, number>, key: string | undefined): void {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function countFriction(total: Record<string, number>, cache: InsightCache | null): void {
  for (const [key, val] of Object.entries(cache?.frictionCounts || {})) {
    if (val > 0) total[key] = (total[key] || 0) + val;
  }
}

function finding(
  category: ShiftLeftFinding["category"],
  evidence: string,
  recommendation: string,
): ShiftLeftFinding {
  return { category, evidence, recommendation };
}

function shiftLeftFindings(meta: InsightMeta, cache: InsightCache | null): ShiftLeftFinding[] {
  const blob = textBlob(meta, cache);
  const friction = cache?.frictionCounts || {};
  const findings: ShiftLeftFinding[] = [];

  if (
    (friction.misunderstood_request || 0) > 0 ||
    (friction.wrong_approach || 0) > 0 ||
    (friction.wrong_file_or_location || 0) > 0
  ) {
    findings.push(
      finding(
        "intent_scoping",
        cache?.friction || "Misunderstood request, wrong approach, or wrong target location.",
        "Shift left with dev_intent, target_paths, out_of_scope, and an escalation ceiling before bootstrapping.",
      ),
    );
  }

  if (
    /missing .*\.tasks|work artifacts?|spec\.json|plan\.json|verify preflight|\/skill:(accord|dev) verify/.test(
      blob,
    )
  ) {
    findings.push(
      finding(
        "artifact_preflight",
        cache?.friction || "Run failed or stalled because harness artifacts were missing.",
        "Add deterministic preflight checks that block verify/resume with exact recovery commands.",
      ),
    );
  }

  if (
    (meta.toolErrors || 0) > 0 ||
    (friction.tool_failed || 0) > 0 ||
    /plan mode|command blocked|tool failed|bash workaround/.test(blob)
  ) {
    findings.push(
      finding(
        "tool_environment",
        cache?.friction || "Tools failed or execution environment blocked the intended path.",
        "Shift left with environment capability checks, plan-mode guards, and explicit fallback prompts.",
      ),
    );
  }

  if (/subagent|stuck|brittle|no recorded assistant outcome|review.*no .*outcome/.test(blob)) {
    findings.push(
      finding(
        "subagent_reliability",
        cache?.friction || "Subagent or review flow left no durable outcome.",
        "Require structured stuck/review outcome packets and promote them into work-item events.",
      ),
    );
  }

  if (["unclear", "partially_achieved", "not_achieved"].includes(cache?.outcome || "")) {
    findings.push(
      finding(
        "terminal_outcome",
        `Outcome was ${cache?.outcome}.`,
        "Require a terminal run summary: done, blocked, partially_achieved, or unclear with owner and next command.",
      ),
    );
  }

  if (
    /vibe|post harness|manual fix|had to .*fix|missed in spec|missed .*plan|after verify|follow-up edit/.test(
      blob,
    )
  ) {
    findings.push(
      finding(
        "spec_plan_gap",
        cache?.friction || "Post-harness coding suggests spec/plan missed implementation detail.",
        "Feed examples into spec/plan checklists as recurring questions or acceptance criteria prompts.",
      ),
    );
  }

  return findings;
}

function summarizeShiftLeft(sessions: RetroSession[]): DevRetroResult["top_shift_left"] {
  const counts: Record<string, { count: number; recommendation: string }> = {};
  for (const s of sessions) {
    for (const f of s.shift_left) {
      const existing = counts[f.category] || { count: 0, recommendation: f.recommendation };
      existing.count++;
      counts[f.category] = existing;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([category, data]) => ({
      category: category as ShiftLeftFinding["category"],
      count: data.count,
      recommendation: data.recommendation,
    }));
}

function formatRetro(result: Omit<DevRetroResult, "formatted">): string {
  const lines: string[] = [];
  lines.push("ACCORD Retrospective");
  lines.push("");
  lines.push(`insights_dir: ${result.insights_dir}`);
  lines.push(`sessions_examined: ${result.sessions_examined}`);
  lines.push(`harness_sessions: ${result.harness_sessions}`);
  lines.push("");

  if (Object.keys(result.outcome_counts).length) {
    lines.push("Outcomes:");
    for (const [k, v] of Object.entries(result.outcome_counts).sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${k}: ${v}`);
    }
    lines.push("");
  }

  if (Object.keys(result.friction_counts).length) {
    lines.push("Friction:");
    for (const [k, v] of Object.entries(result.friction_counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)) {
      lines.push(`- ${k}: ${v}`);
    }
    lines.push("");
  }

  if (result.top_shift_left.length) {
    lines.push("Shift-left opportunities:");
    for (const f of result.top_shift_left) {
      lines.push(`- ${f.category} (${f.count}): ${f.recommendation}`);
    }
    lines.push("");
  }

  lines.push("Representative sessions:");
  for (const s of result.sessions.slice(0, 8)) {
    const label = s.marker?.work_item_id || s.marker?.harness_session_tag || s.session_id;
    lines.push(`- ${label} [${s.associated_by}] outcome=${s.outcome || "unknown"}`);
    if (s.first_prompt) lines.push(`  ask: ${s.first_prompt}`);
    if (s.friction) lines.push(`  friction: ${s.friction}`);
    if (s.shift_left.length)
      lines.push(`  shift_left: ${s.shift_left.map((f) => f.category).join(", ")}`);
  }

  return lines.join("\n");
}

export function devRetro(opts: DevRetroOptions = {}): DevRetroResult | { error: string } {
  const insightsDir = path.resolve(opts.insights_dir || defaultInsightsDir());
  const metaDir = path.join(insightsDir, "meta");
  const cacheDir = path.join(insightsDir, "cache");
  if (!fs.existsSync(metaDir)) return { error: `Insights metadata not found: ${metaDir}` };

  const sinceMs = opts.since ? Date.parse(opts.since) : Number.NaN;
  const includeLegacy = opts.include_legacy_heuristic ?? true;
  const limit = opts.limit ?? 50;
  const outcomeCounts: Record<string, number> = {};
  const frictionCounts: Record<string, number> = {};
  const sessions: RetroSession[] = [];
  let examined = 0;

  for (const metaPath of listJsonFiles(metaDir)) {
    const meta = readJson<InsightMeta>(metaPath);
    if (!meta?.sessionId) continue;
    if (!Number.isNaN(sinceMs) && meta.timestamp && Date.parse(meta.timestamp) < sinceMs) continue;
    examined++;

    const cache = readJson<InsightCache>(path.join(cacheDir, `${meta.sessionId}.json`));
    const marker = readHarnessMarker(meta.path);
    if (!matchesWorkItemFilter(meta, cache, marker, opts.work_item_id)) continue;
    const blob = textBlob(meta, cache);
    const associatedBy = marker
      ? "marker"
      : includeLegacy && isLegacyHarnessSession(blob)
        ? "legacy_heuristic"
        : null;
    if (!associatedBy) continue;

    addCount(outcomeCounts, cache?.outcome || "unknown");
    countFriction(frictionCounts, cache);

    sessions.push({
      session_id: meta.sessionId,
      timestamp: meta.timestamp,
      cwd: meta.cwd,
      first_prompt: meta.firstPrompt,
      outcome: cache?.outcome,
      friction: cache?.friction,
      brief_summary: cache?.briefSummary,
      marker: marker || undefined,
      associated_by: associatedBy,
      shift_left: shiftLeftFindings(meta, cache),
    });
  }

  sessions.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  const limited = sessions.slice(0, limit);
  const result = {
    insights_dir: insightsDir,
    sessions_examined: examined,
    harness_sessions: sessions.length,
    outcome_counts: outcomeCounts,
    friction_counts: frictionCounts,
    top_shift_left: summarizeShiftLeft(sessions),
    sessions: limited,
  };

  return { ...result, formatted: formatRetro(result) };
}
