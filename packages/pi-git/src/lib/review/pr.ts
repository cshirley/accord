/**
 * pr_review_context / pr_review_report implementation (the `pr-review` skill).
 */

import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { loadSubagentConfig } from "@clive.shirley/accord-core/agents/config.js";
import {
  buildPendingReviewPayload,
  buildPrManifest,
  buildPrReviewTasks,
  type DanglingHit,
  danglingTerms,
  type PrFileDiff,
  type PrMeta,
  type PrReviewTask,
  type PrShardPlan,
  planPrShards,
  splitDiffByFile,
  synthesizePrReviewReport,
  writePrShardFiles,
} from "@clive.shirley/accord-core/review/pr.js";
import type { StandaloneReviewFinding } from "@clive.shirley/accord-core/review/standalone.js";
import { gh, git, gitRoot } from "../git.js";

/** Two runs find about 77% of what three do, against about 49% for one; see the pr-review skill. */
export const DEFAULT_PR_REVIEW_RUNS = 2;

const clampRuns = (runs: number | undefined): number =>
  Math.min(3, Math.max(1, Math.floor(runs ?? DEFAULT_PR_REVIEW_RUNS)));

/**
 * The default mix: sonnet, then opus. Model ids are provider-specific (Copilot spells them
 * `claude-opus-5.5`, Anthropic `claude-opus-5-5`), so there is a default only for providers whose
 * spelling is known; elsewhere the default is the same model twice.
 */
export function defaultPrReviewModels(provider: string | undefined): string[] | undefined {
  if (provider === "github-copilot") return ["claude-sonnet-5.5", "claude-opus-5.5"];
  if (provider === "anthropic") return ["claude-sonnet-5-5", "claude-opus-5-5"];
  return undefined;
}

/**
 * The provider the review agents will actually run on: the review profile in `subagent.json`, else
 * the active or default one. `PI_PROVIDER` is the fallback, because that variable is not always set
 * in the process that runs a tool.
 */
export function reviewAgentProvider(): string | undefined {
  try {
    const cfg = loadSubagentConfig();
    const name = cfg.reviewProfile ?? cfg.activeProfile ?? cfg.defaultProfile;
    const provider = cfg.profiles[name]?.provider;
    if (provider) return provider;
  } catch {
    // fall through to the environment
  }
  return process.env.PI_PROVIDER;
}

/** Explicit `models` win; then an explicit `runs` (same model repeated); then the provider's default mix. */
export function resolvePrReviewModels(
  params: { models?: string[]; runs?: number },
  provider: string | undefined = reviewAgentProvider(),
): string[] | undefined {
  const given = (params.models ?? [])
    .map((m) => m.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (given.length > 0) return given;
  if (params.runs !== undefined) return undefined;
  return defaultPrReviewModels(provider);
}

export interface PrReviewContextParams {
  pr: number;
  max_shards?: number;
  budget_kb?: number;
  single_shard_max_files?: number;
  /** Append the review lens (STRIDE for security, etc.) to the briefs. Default true. */
  lens?: boolean;
  /** Repeat every reviewer task this many times (1 to 3, default 2) and merge by location. */
  runs?: number;
  /** One model per run (up to 3); sets the run count. Default: sonnet then opus on a known provider. */
  models?: string[];
  /** Check out the head in a detached worktree beside the repo. Default true. */
  worktree?: boolean;
}

export interface PrReviewContextDetails {
  pr: PrMeta & { state: string; isDraft: boolean; url: string };
  repo_root: string;
  worktree: string | null;
  temp_dir: string;
  manifest_path: string;
  context_path: string;
  plan: PrShardPlan;
  tasks: PrReviewTask[];
}

export function parsePrNumber(input: unknown): number | null {
  const text = String(input).trim();
  const url = /\/pull\/(\d+)(?:\/|$)/.exec(text);
  const n = Number(url ? url[1] : text.replace(/^#/, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * `gh pr diff` refuses a diff over 20,000 lines (HTTP 406 "too_large"), which is exactly the PR
 * that most needs a sharded review. Fall back to a local three-dot diff, which is what GitHub
 * shows for a PR (merge-base to head), with rename detection.
 */
export async function fetchPrDiff(
  root: string,
  number: number,
  base: string,
  headOid: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await gh(["pr", "diff", String(number)], root, signal);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/too_large|exceeded the maximum number of lines|HTTP 406/.test(msg)) throw err;
  }
  await git(["fetch", "origin", `pull/${String(number)}/head`], root, signal);
  await git(["fetch", "origin", base], root, signal);
  return git(
    ["diff", "--no-color", "--no-ext-diff", "--find-renames", `origin/${base}...${headOid}`],
    root,
    signal,
  );
}

const MAX_DANGLING_FILES = 200;
const MAX_HITS_PER_FILE = 5;

/**
 * What in the head checkout still points at a deleted or renamed-away file. The risk in a delete
 * is its dependants, not its old content, so this is the review of it. Deterministic and cheap.
 */
export async function findDanglingReferences(
  checkout: string,
  stubbed: PrShardPlan["stubbed"],
  signal?: AbortSignal,
): Promise<DanglingHit[]> {
  const out: DanglingHit[] = [];
  for (const f of stubbed.slice(0, MAX_DANGLING_FILES)) {
    const terms = danglingTerms(f.oldPath);
    const hits = new Set<string>();
    const run = async (mode: "-F" | "-E", patterns: string[]): Promise<void> => {
      try {
        const res = await git(
          ["grep", "-n", "-I", mode, ...patterns.flatMap((t) => ["-e", t]), "--", "."],
          checkout,
          signal,
        );
        for (const line of res.split("\n")) {
          if (line.trim() && hits.size < MAX_HITS_PER_FILE) hits.add(line.slice(0, 200));
        }
      } catch {
        // git grep exits 1 on no match
      }
    };
    await run("-F", terms.fixed);
    if (terms.regex) await run("-E", [terms.regex]);
    out.push({ path: f.path, oldPath: f.oldPath, kind: f.kind, hits: [...hits] });
  }
  return out;
}

export async function runPrReviewContext(
  cwd: string,
  params: PrReviewContextParams,
  signal?: AbortSignal,
): Promise<{ text: string; details?: PrReviewContextDetails; isError?: boolean }> {
  const number = parsePrNumber(params.pr);
  if (number === null)
    return { text: `Not a PR number or URL: ${String(params.pr)}`, isError: true };
  const root = await gitRoot(cwd, signal);

  const view = JSON.parse(
    await gh(
      [
        "pr",
        "view",
        String(number),
        "--json",
        "number,title,body,baseRefName,headRefOid,state,isDraft,url",
      ],
      root,
      signal,
    ),
  ) as PrMeta & { state: string; isDraft: boolean; url: string };
  if (view.state !== "OPEN") {
    return { text: `PR #${String(number)} is ${view.state}; nothing to review.`, isError: true };
  }

  const raw = await fetchPrDiff(root, number, view.baseRefName, view.headRefOid, signal);
  const files: PrFileDiff[] = splitDiffByFile(raw);
  if (files.length === 0)
    return { text: `PR #${String(number)} has an empty diff.`, isError: true };

  const plan = planPrShards(files, {
    ...(params.max_shards !== undefined ? { maxShards: params.max_shards } : {}),
    ...(params.budget_kb !== undefined ? { budgetBytes: params.budget_kb * 1024 } : {}),
    ...(params.single_shard_max_files !== undefined
      ? { singleShardMaxFiles: params.single_shard_max_files }
      : {}),
  });

  let worktree: string | null = null;
  if (params.worktree !== false) {
    worktree = join(dirname(root), `${basename(root)}-pr${String(number)}`);
    if (existsSync(worktree)) {
      return {
        text: `${worktree} already exists. Remove it with \`git worktree remove\` (or pick up the earlier review) and call again; this tool never reuses or forces an existing path.`,
        isError: true,
      };
    }
    await git(["fetch", "origin", `pull/${String(number)}/head`], root, signal);
    await git(["worktree", "add", "--detach", worktree, view.headRefOid], root, signal);
  }

  const tempDir = await mkdtemp(join(tmpdir(), `pr-review-${String(number)}-`));
  const shardPaths = await writePrShardFiles(tempDir, files, plan);
  const manifestPath = join(tempDir, "manifest.md");
  const checkout = worktree ?? root;
  const dangling = await findDanglingReferences(checkout, plan.stubbed, signal);
  await writeFile(manifestPath, buildPrManifest({ pr: view, plan, worktree: checkout, dangling }));
  const models = resolvePrReviewModels(params);
  const runCount = models ? models.length : clampRuns(params.runs);
  const tasks = buildPrReviewTasks({
    pr: view,
    plan,
    shardPaths,
    manifestPath,
    worktree: checkout,
    wave: "main",
    ...(params.lens === false ? { lens: false } : {}),
    ...(models ? { models } : { runs: clampRuns(params.runs) }),
  });

  await writeFile(join(tempDir, "pr.diff"), raw);
  await writeFile(join(tempDir, "tasks.json"), JSON.stringify(tasks));
  const contextPath = join(tempDir, "context.json");
  const details: PrReviewContextDetails = {
    pr: view,
    repo_root: root,
    worktree,
    temp_dir: tempDir,
    manifest_path: manifestPath,
    context_path: contextPath,
    plan,
    tasks,
  };
  await writeFile(
    contextPath,
    JSON.stringify(
      {
        ...details,
        tasks: undefined,
        runs: runCount,
        models: models ?? null,
        taskFiles: tasks.map((t) => ({
          shard: t.shard,
          run: t.run,
          ...(t.model ? { model: t.model } : {}),
          agent: t.agent,
          files: t.files,
        })),
      },
      null,
      1,
    ),
  );

  const budgetKb = params.budget_kb ?? 60;
  const lines = [
    `PR #${String(number)} "${view.title}" (${view.isDraft ? "draft" : "ready"}), base ${view.baseRefName}, head ${view.headRefOid.slice(0, 9)}`,
    `${String(files.length)} files: ${String(plan.shards.reduce((n, s) => n + s.files.length, 0))} in ${String(plan.shards.length)} shard(s), ${String(plan.skipped.length)} generated skipped. Partition verified.`,
    ...plan.shards.map(
      (s) =>
        `  shard ${String(s.index)}: ${String(s.files.length)} files, ${String(s.bytes)} bytes (review weight ${String(s.weight)})`,
    ),
    ...(plan.overBudget.length
      ? [
          `WARNING: shard(s) ${plan.overBudget.join(", ")} exceed the ${String(Math.round(budgetKb))} KiB budget by over 25% (shard cap or an oversized file); review there is shallower. Raise max_shards or read those shards' findings with care.`,
        ]
      : []),
    ...(plan.stubbed.length
      ? [
          `${String(plan.stubbed.length)} deleted/renamed file(s) shown as stubs; ${String(dangling.filter((d) => d.hits.length > 0).length)} still referenced (see manifest).`,
        ]
      : []),
    ...(plan.oversized.length ? [`Oversized (kept whole): ${plan.oversized.join(", ")}`] : []),
    `Worktree: ${worktree ?? "(none; reviewers read the shard files only)"}`,
    `Temp dir (delete when done): ${tempDir}`,
    `${String(tasks.length)} task(s) (${String(plan.shards.length)} shard(s) x agents x ${String(runCount)} run(s)${models ? `: ${models.join(", ")}` : ""}), in details.tasks and in ${join(tempDir, "tasks.json")} (read that file if details are not visible to you). Run each with its own single-agent subagent call (agentFile, cwd = task.cwd), keeping 4 in flight (a rolling pool, not batches). Then call pr_review_report.`,
    worktree ? `When finished: git worktree remove ${worktree}` : "",
  ].filter(Boolean);
  return { text: lines.join("\n"), details };
}

export interface PrReviewReportParams {
  temp_dir: string;
  /** JSON array of { shard, run?, agent, exitCode, output, stderr? } — one per task run. */
  results_json: string;
}

export async function runPrReviewReport(
  params: PrReviewReportParams,
): Promise<{ text: string; details?: unknown; isError?: boolean }> {
  let ctx: {
    pr: PrMeta;
    plan: PrShardPlan;
    taskFiles: { shard: number; run?: number; model?: string; agent: string; files: string[] }[];
  };
  try {
    ctx = JSON.parse(await readFile(join(params.temp_dir, "context.json"), "utf8"));
  } catch {
    return {
      text: `No context.json in ${params.temp_dir}; call pr_review_context first.`,
      isError: true,
    };
  }
  let raw: {
    shard: number;
    run?: number;
    agent: string;
    exitCode: number;
    output?: string;
    stderr?: string;
  }[];
  try {
    raw = JSON.parse(params.results_json);
    if (!Array.isArray(raw)) throw new Error("not an array");
  } catch (error) {
    return { text: `results_json is not a JSON array: ${(error as Error).message}`, isError: true };
  }
  const same = (
    a: { shard: number; run?: number; agent: string },
    b: { shard: number; run?: number; agent: string },
  ): boolean => a.shard === b.shard && a.agent === b.agent && (a.run ?? 1) === (b.run ?? 1);
  const results = raw.map((r) => ({
    shard: r.shard,
    run: r.run ?? 1,
    agent: r.agent,
    files: ctx.taskFiles.find((t) => same(t, r))?.files ?? [],
    ...(ctx.taskFiles.find((t) => same(t, r))?.model
      ? { model: ctx.taskFiles.find((t) => same(t, r))?.model }
      : {}),
    exitCode: r.exitCode,
    output: r.output ?? "",
    ...(r.stderr ? { stderr: r.stderr } : {}),
  }));
  // A task that was never run is a coverage gap, not silence.
  const notRun = ctx.taskFiles.filter((t) => !results.some((r) => same(r, t)));
  for (const t of notRun)
    results.push({
      shard: t.shard,
      run: t.run ?? 1,
      ...(t.model ? { model: t.model } : {}),
      agent: t.agent,
      files: t.files,
      exitCode: 1,
      output: "",
      stderr: "task was not run",
    });

  const report = synthesizePrReviewReport(results, {
    base: ctx.pr.baseRefName,
    skipped: ctx.plan.skipped,
    shards: ctx.plan.shards.length,
  });
  await writeFile(
    join(params.temp_dir, "report.json"),
    JSON.stringify({ findings: report.findings, gaps: report.gaps }, null, 1),
  );
  return {
    text: report.formatted,
    details: { findings: report.findings, gaps: report.gaps, failures: report.failures.length },
  };
}

export interface PrReviewPostParams {
  temp_dir: string;
  /** Review body (the summary the human sees first). */
  summary: string;
  /** Extra findings (for example from a cross-shard pass) as a JSON array, merged with report.json. */
  extra_findings_json?: string;
  /** Build and return the payload without calling GitHub. */
  dry_run?: boolean;
  /**
   * `pending` (default) creates one draft the human submits. `comment-batches` SUBMITS the review
   * as COMMENT reviews, `batch_size` inline comments each: use it only when the user asked for
   * submitted reviews, and when one request is too big for GitHub (see the pr-review skill).
   */
  submit?: "pending" | "comment-batches";
  /** Inline comments per review in `comment-batches` mode. Default 20; measured, see below. */
  batch_size?: number;
  /** Seconds between batches. Default 30. */
  pause_seconds?: number;
  /** Inline comments already posted by an earlier, interrupted run; skip this many. */
  resume_from?: number;
}

export interface PrReviewPostDeps {
  gh: (args: string[], cwd: string, signal?: AbortSignal) => Promise<string>;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Batch size that worked in practice (PRs 463 and 465 of population-health, 2026-10-22): batches of
 * 5 to 20 inline comments answered 200 in 3 to 6 s; batches of 40 and 52 answered 502 after about
 * 10 s although GitHub had created the review. So 20 is the default and 25 the cap, and a 5xx
 * is never retried blind: look for the review first.
 */
export const DEFAULT_REVIEW_BATCH_SIZE = 20;
export const MAX_REVIEW_BATCH_SIZE = 25;
export const DEFAULT_BATCH_PAUSE_SECONDS = 30;

/** `gh api --paginate` prints one JSON array per page, back to back; join them. */
export function parsePaginatedArray<T>(raw: string): T[] {
  return JSON.parse(raw.trim().replace(/\]\s*\[/g, ",")) as T[];
}

const RATE_LIMIT = /secondary rate limit|rate limit/i;

/** Right-side line numbers in a GitHub `patch` string, as GitHub itself resolves inline comments. */
export function rightLinesOfPatch(patch: string): Set<number> {
  const lines = new Set<number>();
  let line = 0;
  for (const l of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (l.startsWith("-") || l.startsWith("\\")) continue;
    lines.add(line);
    line += 1;
  }
  return lines;
}

/**
 * Creates a *pending* review: the request has no `event`, so GitHub keeps it as a draft that only
 * its author can see, and the human submits it with a verdict. Refuses if the PR head has moved
 * since the context was built, because the line numbers would no longer match.
 */
export async function runPrReviewPost(
  params: PrReviewPostParams,
  deps: PrReviewPostDeps = { gh },
  signal?: AbortSignal,
): Promise<{ text: string; details?: unknown; isError?: boolean }> {
  let ctx: { pr: PrMeta & { url: string }; repo_root: string; runs?: number };
  let findings: StandaloneReviewFinding[];
  let diff: string;
  try {
    ctx = JSON.parse(await readFile(join(params.temp_dir, "context.json"), "utf8"));
    findings =
      JSON.parse(await readFile(join(params.temp_dir, "report.json"), "utf8")).findings ?? [];
    diff = await readFile(join(params.temp_dir, "pr.diff"), "utf8");
  } catch {
    return {
      text: `Need context.json, report.json and pr.diff in ${params.temp_dir}; run pr_review_context then pr_review_report first.`,
      isError: true,
    };
  }
  if (params.extra_findings_json) {
    try {
      const extra = JSON.parse(params.extra_findings_json);
      if (!Array.isArray(extra)) throw new Error("not an array");
      findings = [...findings, ...extra];
    } catch (error) {
      return {
        text: `extra_findings_json is not a JSON array: ${(error as Error).message}`,
        isError: true,
      };
    }
  }
  if (!params.summary.trim()) return { text: "summary must not be empty.", isError: true };

  const { payload, unanchored } = buildPendingReviewPayload({
    headSha: ctx.pr.headRefOid,
    summary: params.summary,
    findings,
    files: splitDiffByFile(diff),
    totalRuns: ctx.runs ?? 1,
  });
  const preview = `${String(payload.comments.length)} inline comment(s), ${String(unanchored.length)} finding(s) in the body, commit ${ctx.pr.headRefOid.slice(0, 9)}.`;
  if (params.dry_run)
    return { text: `Dry run, nothing posted. ${preview}`, details: { payload, unanchored } };

  const live = JSON.parse(
    await deps.gh(
      ["pr", "view", String(ctx.pr.number), "--json", "headRefOid,state"],
      ctx.repo_root,
      signal,
    ),
  ) as { headRefOid: string; state: string };
  if (live.state !== "OPEN")
    return {
      text: `PR #${String(ctx.pr.number)} is ${live.state}; nothing posted.`,
      isError: true,
    };
  if (live.headRefOid !== ctx.pr.headRefOid) {
    return {
      text: `PR head moved from ${ctx.pr.headRefOid.slice(0, 9)} to ${live.headRefOid.slice(0, 9)} since this review was prepared; line numbers may be wrong. Nothing posted. Re-run pr_review_context.`,
      isError: true,
    };
  }

  if (params.submit === "comment-batches")
    return postCommentBatches(params, deps, ctx, payload, unanchored, signal);

  const inputPath = join(params.temp_dir, "review.json");
  await writeFile(inputPath, JSON.stringify(payload));
  let created: { id?: number; state?: string; html_url?: string };
  try {
    created = JSON.parse(
      await deps.gh(
        [
          "api",
          `repos/{owner}/{repo}/pulls/${String(ctx.pr.number)}/reviews`,
          "--method",
          "POST",
          "--input",
          inputPath,
        ],
        ctx.repo_root,
        signal,
      ),
    );
  } catch (error) {
    // A 5xx can arrive after GitHub has created the review (a 502 did, on PR 449), and a retry
    // would then be refused as a second pending review. So look before reporting a failure.
    const existing = await findPendingReviewWithBody(deps, ctx, payload.body, signal);
    if (existing === null) {
      return {
        text: `GitHub did not accept the review (you may already have a pending review on this PR): ${(error as Error).message}`,
        isError: true,
      };
    }
    created = existing;
  }
  if (created.state !== "PENDING") {
    return {
      text: `Unexpected review state ${String(created.state)}; check the PR on GitHub (${created.html_url ?? ctx.pr.url}).`,
      isError: true,
    };
  }
  return {
    text: `Pending review created (${preview}) — only you can see it. Open ${created.html_url ?? ctx.pr.url}, choose "Finish your review" and pick the verdict. Nothing is submitted.`,
    details: {
      id: created.id,
      url: created.html_url,
      comments: payload.comments.length,
      unanchored: unanchored.length,
    },
  };
}

async function findPendingReviewWithBody(
  deps: PrReviewPostDeps,
  ctx: { pr: { number: number }; repo_root: string },
  body: string,
  signal?: AbortSignal,
): Promise<{ id?: number; state?: string; html_url?: string } | null> {
  try {
    const listed = JSON.parse(
      await deps.gh(
        ["api", `repos/{owner}/{repo}/pulls/${String(ctx.pr.number)}/reviews`],
        ctx.repo_root,
        signal,
      ),
    ) as { id?: number; state?: string; html_url?: string; body?: string }[];
    return listed.find((r) => r.state === "PENDING" && r.body === body) ?? null;
  } catch {
    return null;
  }
}

interface ReviewPayloadShape {
  commit_id: string;
  body: string;
  comments: { path: string; line: number; side: string; body: string }[];
}

/**
 * Submits the review as COMMENT reviews in small batches. Why: GitHub rejected or timed out one
 * request carrying 68 to 122 inline comments on a PR with a diff over 20,000 lines. Findings:
 *  - after a secondary rate limit, retrying keeps the block alive; waiting 20 minutes with no
 *    request cleared it, and every request then succeeded;
 *  - batches of 40 and 52 returned 502 after about 10 s but the review existed, so a retry would
 *    duplicate it; batches of 20 or fewer took 3 to 6 s and returned 200.
 * So: check every comment line against GitHub's own file patches first (a locally built diff
 * disagreed on 12 of 190 lines), post at most `batch_size` comments per review with a pause between
 * them, tag each body with a batch marker so a 5xx can be checked rather than retried, and stop at
 * the first rate limit instead of retrying.
 */
async function postCommentBatches(
  params: PrReviewPostParams,
  deps: PrReviewPostDeps,
  ctx: { pr: PrMeta & { url: string }; repo_root: string },
  payload: ReviewPayloadShape,
  unanchored: unknown[],
  signal?: AbortSignal,
): Promise<{ text: string; details?: unknown; isError?: boolean }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const size = Math.max(
    1,
    Math.min(MAX_REVIEW_BATCH_SIZE, Math.floor(params.batch_size ?? DEFAULT_REVIEW_BATCH_SIZE)),
  );
  const pause = Math.max(0, params.pause_seconds ?? DEFAULT_BATCH_PAUSE_SECONDS) * 1000;
  const number = String(ctx.pr.number);

  // Keep only comments GitHub can resolve; the rest go into the first review's body.
  let comments = payload.comments;
  let body = payload.body;
  try {
    const listed = parsePaginatedArray<{ filename: string; patch?: string }>(
      await deps.gh(
        ["api", "--paginate", `repos/{owner}/{repo}/pulls/${number}/files`],
        ctx.repo_root,
        signal,
      ),
    );
    const lines = new Map(
      listed
        .filter((f) => f.patch !== undefined)
        .map((f) => [f.filename, rightLinesOfPatch(f.patch ?? "")]),
    );
    const moved = comments.filter((c) => !lines.get(c.path)?.has(c.line));
    comments = comments.filter((c) => lines.get(c.path)?.has(c.line));
    if (moved.length > 0)
      body += `\n\n### More findings (line not resolvable by GitHub)\n${moved
        .map(
          (c) =>
            `\n- \`${c.path}:${String(c.line)}\` ${c.body.split("\n\n")[0]?.replace(/\n/g, " ") ?? ""}`,
        )
        .join("")}`;
  } catch {
    // No file list (for example a paginated array GitHub would not serve): post as built.
  }

  const start = Math.max(0, Math.floor(params.resume_from ?? 0));
  const todo = comments.slice(start);
  const posted: { id?: number; comments: number }[] = [];
  let part = start === 0 ? 0 : 1;
  for (let i = 0; i < Math.max(todo.length, start === 0 ? 1 : 0); i += size) {
    part += 1;
    const batch = todo.slice(i, i + size);
    const marker = `[batch ${String(part)}]`;
    const first = part === 1;
    const text = first
      ? `${body}\n\n_Posted in several reviews because GitHub rejects one large request for a PR this size. ${marker}_`
      : `Continuation of the review above, comments ${String(start + i + 1)}-${String(start + i + batch.length)} of ${String(comments.length)}. ${marker}`;
    const input = join(params.temp_dir, `review-batch-${String(part)}.json`);
    await writeFile(
      input,
      JSON.stringify({
        commit_id: payload.commit_id,
        event: "COMMENT",
        body: text,
        comments: batch,
      }),
    );
    let created: { id?: number } | null = null;
    try {
      created = JSON.parse(
        await deps.gh(
          [
            "api",
            `repos/{owner}/{repo}/pulls/${number}/reviews`,
            "--method",
            "POST",
            "--input",
            input,
          ],
          ctx.repo_root,
          signal,
        ),
      ) as { id?: number };
    } catch (error) {
      const message = (error as Error).message;
      if (RATE_LIMIT.test(message)) {
        return {
          text: `GitHub rate-limited the request after ${String(start + posted.reduce((n, p) => n + p.comments, 0))} of ${String(comments.length)} inline comments. Do not retry for at least 20 minutes (retries keep the block alive), then call again with resume_from=${String(start + posted.reduce((n, p) => n + p.comments, 0))}.`,
          isError: true,
          details: { posted, resume_from: start + posted.reduce((n, p) => n + p.comments, 0) },
        };
      }
      // A 5xx or timeout can arrive after GitHub created the review: look before giving up.
      const found = await findSubmittedReviewWithMarker(deps, ctx, marker, signal);
      if (found === null) {
        return {
          text: `Batch ${String(part)} failed: ${message}. Nothing was found on GitHub for it; resume_from=${String(start + posted.reduce((n, p) => n + p.comments, 0))}.`,
          isError: true,
          details: { posted, resume_from: start + posted.reduce((n, p) => n + p.comments, 0) },
        };
      }
      created = found;
    }
    posted.push({
      ...(created.id === undefined ? {} : { id: created.id }),
      comments: batch.length,
    });
    if (i + size < todo.length) await sleep(pause);
  }
  return {
    text: `Submitted ${String(posted.length)} COMMENT review(s) with ${String(posted.reduce((n, p) => n + p.comments, 0))} inline comment(s) (batches of up to ${String(size)}); ${String(unanchored.length)} finding(s) in the first body. ${ctx.pr.url}`,
    details: { posted, unanchored: unanchored.length },
  };
}

async function findSubmittedReviewWithMarker(
  deps: PrReviewPostDeps,
  ctx: { pr: { number: number }; repo_root: string },
  marker: string,
  signal?: AbortSignal,
): Promise<{ id?: number } | null> {
  try {
    const listed = parsePaginatedArray<{ id?: number; body?: string }>(
      await deps.gh(
        ["api", "--paginate", `repos/{owner}/{repo}/pulls/${String(ctx.pr.number)}/reviews`],
        ctx.repo_root,
        signal,
      ),
    );
    return listed.find((r) => (r.body ?? "").includes(marker)) ?? null;
  } catch {
    return null;
  }
}
