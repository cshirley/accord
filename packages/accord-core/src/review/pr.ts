/**
 * PR review — core helpers for the `pr-review` skill: split a PR diff into per-file pieces,
 * shard it for parallel reviewers with a checked partition, build shard briefs on top of the
 * standalone review rubric, check reviewer coverage, and build a *pending* GitHub review.
 *
 * Pure functions only (no git, no gh, no fs) except {@link writePrShardFiles}.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractReturnPacketFromSubagentResult } from "../subagent/result/packet.js";
import { prReviewLensFor } from "./pr-lens.js";
import {
  buildStandaloneReviewTasks,
  parseStandaloneReviewAgentResult,
  type StandaloneReviewAgentResult,
  type StandaloneReviewFinding,
  type StandaloneReviewTask,
  synthesizeStandaloneReviewReport,
} from "./standalone.js";

// ── Diff split ──────────────────────────────────────────────────────────────

export type PrFileDiff = { path: string; diff: string; bytes: number };

/** Splits a unified `git diff` / `gh pr diff` into one entry per file, in diff order. */
export function splitDiffByFile(raw: string): PrFileDiff[] {
  const files: PrFileDiff[] = [];
  for (const part of raw.split(/^(?=diff --git )/m)) {
    if (!part.startsWith("diff --git ")) continue;
    const header = part.split("\n", 1)[0] ?? "";
    const idx = header.lastIndexOf(" b/");
    const path = idx >= 0 ? header.slice(idx + 3) : header.slice("diff --git ".length);
    files.push({ path, diff: part, bytes: Buffer.byteLength(part, "utf8") });
  }
  return files;
}

const GENERATED_PATTERN =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock)$|\.generated\.[a-z]+$|\.snap$|\.min\.(?:js|css)$/i;

/** Files that are generated or lock output; listed in the report but not reviewed. */
export function isGeneratedReviewFile(path: string): boolean {
  return GENERATED_PATTERN.test(path);
}

// ── Sharding ────────────────────────────────────────────────────────────────

export type PrShard = {
  index: number; // 1-based
  files: string[];
  bytes: number;
};

export type PrShardPlan = {
  shards: PrShard[];
  skipped: string[];
  /** Files larger than the shard budget on their own (kept whole, in a shard alone or first). */
  oversized: string[];
};

export type PlanShardsOptions = {
  /** Shard count cap. Default 4. */
  maxShards?: number;
  /** Target bytes per shard. Default {@link DEFAULT_SHARD_BUDGET_BYTES} (60 KiB). */
  budgetBytes?: number;
  /** At or under this many files and one budget of bytes → a single shard. Default {@link DEFAULT_SINGLE_SHARD_MAX_FILES} (20). */
  singleShardMaxFiles?: number;
};

/**
 * Reviewers go less deeply the more they are given: a 127 KB, 33-file PR reviewed as one shard
 * missed several findings that three shards of the same PR caught. So a PR is only one shard when
 * it is small in both bytes and files.
 */
export const DEFAULT_SHARD_BUDGET_BYTES = 60 * 1024;
export const DEFAULT_SINGLE_SHARD_MAX_FILES = 20;

const TEST_DIR = /(?:^|\/)(?:test|tests|__tests__|spec)\//;
const TEST_FILE = /\.(?:test|spec)\.[a-z]+$/i;

function stemOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.(?:test|spec)(?=\.)/i, "").replace(/\.[^.]+$/, "");
}

/** Group key: files in one directory belong together; a test joins the source it is named for. */
export function groupFilesForShards(paths: string[]): Map<string, string[]> {
  const sourceDirByStem = new Map<string, string>();
  for (const p of paths) {
    if (TEST_DIR.test(p) || TEST_FILE.test(p)) continue;
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
    if (!sourceDirByStem.has(stemOf(p))) sourceDirByStem.set(stemOf(p), dir);
  }
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const isTest = TEST_DIR.test(p) || TEST_FILE.test(p);
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".";
    const key = isTest ? (sourceDirByStem.get(stemOf(p)) ?? dir) : dir;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  return groups;
}

export function planPrShards(files: PrFileDiff[], options: PlanShardsOptions = {}): PrShardPlan {
  const maxShards = Math.max(1, options.maxShards ?? 4);
  const budget = options.budgetBytes ?? DEFAULT_SHARD_BUDGET_BYTES;
  const singleMaxFiles = options.singleShardMaxFiles ?? DEFAULT_SINGLE_SHARD_MAX_FILES;

  const skipped = files.filter((f) => isGeneratedReviewFile(f.path)).map((f) => f.path);
  const reviewable = files.filter((f) => !isGeneratedReviewFile(f.path));
  const bytesOf = new Map(reviewable.map((f) => [f.path, f.bytes]));
  const total = reviewable.reduce((n, f) => n + f.bytes, 0);
  const oversized = reviewable.filter((f) => f.bytes > budget).map((f) => f.path);

  const wanted =
    reviewable.length <= singleMaxFiles && total <= budget
      ? 1
      : Math.min(maxShards, Math.max(1, Math.ceil(total / budget)));

  const shards: PrShard[] = Array.from({ length: wanted }, (_, i) => ({
    index: i + 1,
    files: [],
    bytes: 0,
  }));

  const groups = [...groupFilesForShards(reviewable.map((f) => f.path)).entries()]
    .map(([key, paths]) => ({
      key,
      paths,
      bytes: paths.reduce((n, p) => n + (bytesOf.get(p) ?? 0), 0),
    }))
    // Largest first, then by key, so the same input always gives the same shards.
    .sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));

  for (const group of groups) {
    const target = shards.reduce((min, s) => (s.bytes < min.bytes ? s : min));
    target.files.push(...group.paths);
    target.bytes += group.bytes;
  }

  const plan: PrShardPlan = {
    shards: shards.filter((s) => s.files.length > 0),
    skipped,
    oversized,
  };
  plan.shards.forEach((s, i) => {
    s.index = i + 1;
  });
  assertShardPartition(files, plan);
  return plan;
}

/**
 * Every reviewable file is in exactly one shard, every skipped file is in none, and the bytes
 * add up. Throws with the offending paths: a review on a broken partition is not a review.
 */
export function assertShardPartition(files: PrFileDiff[], plan: PrShardPlan): void {
  const skipped = new Set(plan.skipped);
  const expected = new Set(files.filter((f) => !skipped.has(f.path)).map((f) => f.path));
  const seen = new Map<string, number>();
  for (const shard of plan.shards) {
    for (const p of shard.files) seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  const missing = [...expected].filter((p) => !seen.has(p));
  const duplicated = [...seen].filter(([, n]) => n > 1).map(([p]) => p);
  const unknown = [...seen.keys()].filter((p) => !expected.has(p));
  if (missing.length > 0 || duplicated.length > 0 || unknown.length > 0) {
    throw new Error(
      `shard partition is invalid: missing [${missing.join(", ")}], duplicated [${duplicated.join(", ")}], unknown [${unknown.join(", ")}]`,
    );
  }
  const bytesOf = new Map(files.map((f) => [f.path, f.bytes]));
  const expectedBytes = [...expected].reduce((n, p) => n + (bytesOf.get(p) ?? 0), 0);
  const shardBytes = plan.shards.reduce(
    (n, s) => n + s.files.reduce((m, p) => m + (bytesOf.get(p) ?? 0), 0),
    0,
  );
  if (expectedBytes !== shardBytes) {
    throw new Error(`shard bytes ${String(shardBytes)} != diff bytes ${String(expectedBytes)}`);
  }
}

/** Writes `shard-<k>.diff` for each shard and returns their absolute paths. */
export async function writePrShardFiles(
  dir: string,
  files: PrFileDiff[],
  plan: PrShardPlan,
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const byPath = new Map(files.map((f) => [f.path, f]));
  const paths: string[] = [];
  for (const shard of plan.shards) {
    const path = join(dir, `shard-${String(shard.index)}.diff`);
    const head = `# shard ${String(shard.index)}/${String(plan.shards.length)} files: ${shard.files.join(", ")}\n\n`;
    await writeFile(path, head + shard.files.map((p) => byPath.get(p)?.diff ?? "").join(""));
    paths.push(path);
  }
  return paths;
}

// ── Manifest and briefs ─────────────────────────────────────────────────────

export type PrMeta = {
  number: number;
  title: string;
  body?: string;
  baseRefName: string;
  headRefOid: string;
};

export function buildPrManifest(input: {
  pr: PrMeta;
  plan: PrShardPlan;
  worktree: string;
}): string {
  const { pr, plan, worktree } = input;
  const lines = [
    `# PR ${String(pr.number)} manifest`,
    `Title: ${pr.title}`,
    `Base: ${pr.baseRefName}   Head: ${pr.headRefOid}`,
    `Worktree (head checkout; read surrounding code here): ${worktree}`,
    "",
  ];
  const body = (pr.body ?? "").trim();
  if (body)
    lines.push("## PR description", body.length > 4000 ? `${body.slice(0, 4000)}…` : body, "");
  for (const shard of plan.shards) {
    lines.push(`## shard ${String(shard.index)}`, ...shard.files.map((f) => `- ${f}`), "");
  }
  if (plan.skipped.length > 0)
    lines.push("## skipped (generated)", ...plan.skipped.map((f) => `- ${f}`), "");
  return lines.join("\n");
}

export type PrReviewTask = StandaloneReviewTask & {
  shard: number;
  /** 1-based repeat of this task (see `runs`); a finding seen in more than one run is more likely real. */
  run: number;
  /** The model this run should use (`models[run - 1]`), when models were given. */
  model?: string;
  cwd: string;
  /** The files this shard assigned to the agent, for the coverage check. */
  files: string[];
};

export function buildPrReviewTasks(input: {
  pr: PrMeta;
  plan: PrShardPlan;
  shardPaths: string[];
  manifestPath: string;
  worktree: string;
  /** `main`: review-code + review-security. `test`: review-test only (needs test_output). */
  wave: "main" | "test";
  test_output?: string;
  /** Append the per-agent review lens and the return shape. Default true; false gives the bare brief. */
  lens?: boolean;
  /** Repeat every task this many times (default 1, at most 3). Runs differ, so a union finds more. */
  runs?: number;
  /**
   * One model per run, in order. Models make different mistakes, so a mixed pair finds more than
   * the same model twice. When given it sets the number of runs (at most 3) and `runs` is ignored.
   */
  models?: string[];
}): PrReviewTask[] {
  const { pr, plan, shardPaths, manifestPath, worktree, wave } = input;
  const total = plan.shards.length;
  const models = (input.models ?? []).filter((m) => m.trim() !== "").slice(0, 3);
  const runs =
    models.length > 0 ? models.length : Math.min(3, Math.max(1, Math.floor(input.runs ?? 1)));
  const tasks: PrReviewTask[] = [];
  for (const shard of plan.shards) {
    const note =
      ` This is shard ${String(shard.index)} of ${String(total)} of PR #${String(pr.number)} ("${pr.title}"), base \`${pr.baseRefName}\`.` +
      ` The PR description and the other shards' file lists are in \`${manifestPath}\`; read it for cross-file context.` +
      ` The head code is checked out at \`${worktree}\`; use it to read and grep surrounding code.` +
      " At the end of your return packet add a top-level `files_reviewed` array: the changed paths you actually read.";
    const built = buildStandaloneReviewTasks({
      diff_path: shardPaths[shard.index - 1] ?? "",
      source: "branch",
      file_list: shard.files,
      test_output: input.test_output,
    });
    for (const t of built) {
      if ((wave === "test") !== (t.agent === "review-test")) continue;
      for (let run = 1; run <= runs; run += 1) {
        tasks.push({
          ...t,
          run,
          ...(models[run - 1] !== undefined ? { model: models[run - 1] } : {}),
          task: t.task + note + (input.lens === false ? "" : prReviewLensFor(t.agent)),
          shard: shard.index,
          cwd: worktree,
          files: shard.files,
        });
      }
    }
  }
  return tasks;
}

// ── Results: packets, coverage, report ──────────────────────────────────────

export type PrShardResult = {
  shard: number;
  /** Which repeat of the task this is (default 1). */
  run?: number;
  /** The model that ran it, when known. */
  model?: string;
  agent: string;
  /** The files the task assigned. */
  files: string[];
  exitCode: number;
  output: string;
  stderr?: string;
};

export type CoverageGap = { shard: number; agent: string; missed: string[]; reported: boolean };

export function filesReviewedOf(output: string): string[] | null {
  const packet = extractReturnPacketFromSubagentResult({ exitCode: 0, output });
  const list = packet?.files_reviewed;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : null;
}

const samePath = (reported: string, assigned: string): boolean =>
  reported === assigned || reported.endsWith(`/${assigned}`) || assigned.endsWith(`/${reported}`);

/** Which assigned files each agent did not report reading. A missing `files_reviewed` is a gap, not a pass. */
export function checkPrCoverage(results: PrShardResult[]): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const r of results) {
    const reported = filesReviewedOf(r.output);
    const missed =
      reported === null ? r.files : r.files.filter((a) => !reported.some((x) => samePath(x, a)));
    if (missed.length > 0)
      gaps.push({ shard: r.shard, agent: r.agent, missed, reported: reported !== null });
  }
  return gaps;
}

export type RunFinding = StandaloneReviewFinding & {
  /** The repeat of the task that reported it, when a review is run more than once. */
  run?: number;
  /** The model that reported it, when known. */
  model?: string;
};

export type MergedFinding = RunFinding & {
  /** How many findings were merged into this one (absent or 1: none). */
  merged?: number;
  /** The distinct runs that reported it, when runs are recorded. */
  runs?: number[];
  /** The distinct models that reported it, when models are recorded. */
  models?: string[];
  /** Set when the severity was lowered because only one untrusted model reported it. */
  cappedFrom?: string;
};

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, suggestion: 2 };
const rank = (severity: string): number => SEVERITY_RANK[severity.toLowerCase()] ?? 1;

/**
 * Findings at the same location become one entry at the highest severity, so one location gets one
 * review comment. Locations match exactly by default; `tolerance` lets findings within that many
 * lines of each other in a file merge, which repeated runs need because the same issue is reported
 * a line or two apart. Per agent, only its strongest finding's text is kept, so a second run's
 * rewording does not repeat. Findings without a file and line are left as they are.
 */
export function mergeFindingsByLocation(
  findings: RunFinding[],
  options: { tolerance?: number } = {},
): MergedFinding[] {
  const tolerance = Math.max(0, options.tolerance ?? 0);
  const groups: { file: string; items: RunFinding[] }[] = [];
  const order: (number | RunFinding)[] = [];
  for (const f of findings) {
    if (!f.file || f.line === undefined) {
      order.push(f);
      continue;
    }
    const line = f.line;
    const at = groups.findIndex(
      (g) => g.file === f.file && g.items.some((i) => Math.abs((i.line ?? 0) - line) <= tolerance),
    );
    if (at >= 0) groups[at]?.items.push(f);
    else {
      groups.push({ file: f.file, items: [f] });
      order.push(groups.length - 1);
    }
  }
  return order.map((entry): MergedFinding => {
    if (typeof entry !== "number") return entry;
    const group = groups[entry]?.items ?? [];
    const first = group[0] as RunFinding;
    if (group.length === 1 && first.run === undefined) return first;
    const sorted = [...group].sort(
      (a, b) => rank(a.severity) - rank(b.severity) || b.message.length - a.message.length,
    );
    const strongest = sorted[0] as RunFinding;
    const perAgent = new Map<string, RunFinding>();
    for (const g of sorted)
      if (!perAgent.has(g.agent ?? "review")) perAgent.set(g.agent ?? "review", g);
    const agents = [...perAgent.keys()];
    const runs = [
      ...new Set(group.map((g) => g.run).filter((r): r is number => r !== undefined)),
    ].sort((a, b) => a - b);
    const models = [
      ...new Set(group.map((g) => g.model).filter((m): m is string => m !== undefined)),
    ].sort();
    const single = agents.length === 1;
    const merged = single && group.length === 1;
    return {
      severity: strongest.severity,
      agent: agents.join(" + "),
      file: first.file,
      line: strongest.line,
      ...(group.length > 1 ? { merged: group.length } : {}),
      ...(runs.length > 0 ? { runs } : {}),
      ...(models.length > 0 ? { models } : {}),
      message: merged
        ? strongest.message
        : [...perAgent.values()]
            .map((g) => `**${g.agent ?? "review"}** (${g.severity}): ${g.message}`)
            .join("\n\n"),
    };
  });
}

/** Models whose severity grading is trusted without a second model agreeing (the Claude family). */
const TRUSTED_SEVERITY_MODEL = /claude/i;

/**
 * Lowers a `critical` to `warning` when exactly one model reported it and that model's severity is
 * not trusted. On PR 449 gpt-5.6-sol marked 13 findings critical, most of them ordinary bugs. It
 * only applies when at least two different models ran, so a single-model review is left alone.
 */
export function capUntrustedSeverity(
  findings: MergedFinding[],
  modelsRun: number,
): MergedFinding[] {
  if (modelsRun < 2) return findings;
  return findings.map((f) => {
    const only = f.models?.length === 1 ? f.models[0] : undefined;
    if (
      f.severity.toLowerCase() !== "critical" ||
      only === undefined ||
      TRUSTED_SEVERITY_MODEL.test(only)
    )
      return f;
    return {
      ...f,
      severity: "warning",
      cappedFrom: "critical",
      message: `${f.message}\n\n_Marked critical by ${only} alone; shown as a warning until another model agrees._`,
    };
  });
}

function dedupe(findings: StandaloneReviewFinding[]): StandaloneReviewFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.agent ?? ""}|${f.file ?? ""}|${String(f.line ?? "")}|${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type PrReviewReport = {
  formatted: string;
  findings: MergedFinding[];
  gaps: CoverageGap[];
  failures: PrShardResult[];
};

/** Merges shard results into the standalone report shape, plus a Coverage section. */
export function synthesizePrReviewReport(
  results: PrShardResult[],
  meta: { base: string; skipped: string[]; shards: number },
): PrReviewReport {
  const byAgent = new Map<string, StandaloneReviewAgentResult>();
  const failures: PrShardResult[] = [];
  for (const r of results) {
    const parsed = parseStandaloneReviewAgentResult(r.agent, {
      exitCode: r.exitCode,
      output: r.output,
      stderr: r.stderr,
    });
    if (r.exitCode !== 0) failures.push(r);
    const tagged = parsed.findings.map(
      (f): RunFinding => ({ ...f, run: r.run ?? 1, ...(r.model ? { model: r.model } : {}) }),
    );
    const into = byAgent.get(r.agent);
    if (into) {
      into.findings.push(...tagged);
      if (parsed.exit_code !== 0) into.exit_code = parsed.exit_code;
      if (parsed.error) into.error = parsed.error;
    } else byAgent.set(r.agent, { ...parsed, findings: tagged });
  }
  const agents = [...byAgent.values()].map((a) => ({ ...a, findings: dedupe(a.findings) }));
  const standalone = synthesizeStandaloneReviewReport(agents);
  const gaps = checkPrCoverage(results);
  const runCount = Math.max(1, ...results.map((r) => r.run ?? 1));
  const modelsRun = new Set(
    results.map((r) => r.model).filter((m): m is string => m !== undefined),
  );
  const mergedRaw = mergeFindingsByLocation(
    agents.flatMap((a) => a.findings),
    { tolerance: runCount > 1 ? 2 : 0 },
  );
  const merged = capUntrustedSeverity(mergedRaw, modelsRun.size);
  const capped = merged.filter((f) => f.cappedFrom !== undefined);
  const shared = merged.filter((f) => (f.merged ?? 1) > 1);
  const everyRun = merged.filter((f) => (f.runs?.length ?? 0) === runCount).length;

  const assigned = new Set(results.flatMap((r) => r.files)).size;
  const lines = [
    `Base: ${meta.base}   Shards: ${String(meta.shards)}`,
    standalone.formatted,
    "",
    `### By location`,
    `${String(merged.length)} location(s) after merging; ${String(shared.length)} shared by more than one finding and posted as one comment each.`,
    ...(runCount > 1
      ? [
          `${String(runCount)} runs: ${String(everyRun)} of ${String(merged.length)} location(s) were reported in every run; a location seen in one run only is lower confidence.`,
        ]
      : []),
    ...(modelsRun.size > 1
      ? [
          `Models: ${[...modelsRun].sort().join(", ")}.${capped.length > 0 ? ` ${String(capped.length)} critical finding(s) reported by one non-Claude model alone were shown as warnings.` : ""}`,
        ]
      : []),
    ...shared.map(
      (f) =>
        `- \`${f.file ?? ""}:${String(f.line ?? "")}\` (${f.severity}) ${String(f.merged)} findings: ${f.agent ?? ""}${f.runs ? ` (runs ${f.runs.join(", ")}${f.models ? `; ${f.models.join(", ")}` : ""})` : ""}`,
    ),
    "",
    "### Coverage",
    `${String(assigned)} files assigned across ${String(meta.shards)} shard(s); ${String(meta.skipped.length)} generated file(s) skipped.`,
    gaps.length === 0
      ? "Every agent reported every assigned file."
      : gaps
          .map(
            (g) =>
              `- shard ${String(g.shard)} ${g.agent}: ${g.reported ? "did not report" : "returned no files_reviewed for"} ${g.missed.join(", ")}`,
          )
          .join("\n"),
  ];
  return {
    formatted: lines.join("\n"),
    findings: merged,
    gaps,
    failures,
  };
}

// ── Pending review payload ──────────────────────────────────────────────────

/** Head-side line numbers a review comment may anchor to (added and context lines in the hunks). */
export function anchorableLines(fileDiff: string): Set<number> {
  const lines = new Set<number>();
  let next = 0;
  let inHunk = false;
  for (const line of fileDiff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith("\\")) continue;
    if (line.startsWith("+")) lines.add(next++);
    else if (line.startsWith("-")) continue;
    else if (line.startsWith(" ")) lines.add(next++);
  }
  return lines;
}

export type PendingReviewPayload = {
  commit_id: string;
  body: string;
  comments: { path: string; line: number; side: "RIGHT"; body: string }[];
};

/**
 * The request body for `POST /pulls/N/reviews`. There is deliberately no `event`: GitHub then
 * leaves the review PENDING, and only the human submits it. A finding that cannot be anchored to
 * a line in the diff goes into the body instead of being dropped.
 */
export function buildPendingReviewPayload(input: {
  headSha: string;
  summary: string;
  findings: RunFinding[];
  files: PrFileDiff[];
  /** How many times the review was run, so a comment can say how many runs found its issue. */
  totalRuns?: number;
}): { payload: PendingReviewPayload; unanchored: StandaloneReviewFinding[] } {
  const totalRuns = input.totalRuns ?? 1;
  const anchors = new Map(input.files.map((f) => [f.path, anchorableLines(f.diff)]));
  const comments: PendingReviewPayload["comments"] = [];
  const unanchored: StandaloneReviewFinding[] = [];
  for (const f of mergeFindingsByLocation(input.findings)) {
    if (f.file && f.line !== undefined && anchors.get(f.file)?.has(f.line)) {
      comments.push({
        path: f.file,
        line: f.line,
        side: "RIGHT",
        body:
          ((f.merged ?? 1) > 1
            ? f.message
            : `**${f.agent ?? "review"}** (${f.severity}): ${f.message}`) +
          (totalRuns > 1 && f.runs
            ? `\n\n_Reported in ${String(f.runs.length)} of ${String(totalRuns)} runs${f.models ? ` (${f.models.join(", ")})` : ""}._`
            : ""),
      });
    } else unanchored.push(f);
  }
  const extra = unanchored.length
    ? `\n\n### Findings without a diff line\n${unanchored
        .map(
          (f) =>
            `- **${f.agent ?? "review"}** (${f.severity})${f.file ? ` \`${f.file}${f.line !== undefined ? `:${String(f.line)}` : ""}\`` : ""}: ${f.message}`,
        )
        .join("\n")}`
    : "";
  return {
    payload: { commit_id: input.headSha, body: input.summary + extra, comments },
    unanchored,
  };
}
