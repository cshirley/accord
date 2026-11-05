import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAccordTrailer } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/agents-md.js";
import { resolveStackConfig } from "@clive.shirley/accord-core/config/stack-flags.js";
import { createLogger, type Logger } from "@clive.shirley/accord-core/logging.js";
import {
  branchFor,
  ensureCloseoutBranch,
  ensureTaskBranch,
} from "@clive.shirley/accord-core/stack/branches.js";
import { computeStack } from "@clive.shirley/accord-core/stack/compute-stack.js";
import type { StackPlanTask } from "@clive.shirley/accord-core/stack/types.js";
import { restoreStateFromTree } from "@clive.shirley/accord-core/state/restore.js";
import { MissingSecretError } from "../lib/env.js";
import { checkCostCap } from "../parse-phase-result.js";
import type { PhaseRunBackend } from "../run-phase.js";
import { raiseAlert, spawnExec } from "./alert.js";
import type { Pr0ExecLike as ExecLike } from "./pr0.js";
import { CI_PUSH_TOKEN_NAME } from "./startup.js";

export type ResumeEvent =
  | { readonly name: "push"; readonly branch: string; readonly changedFiles: readonly string[] }
  | {
      readonly name: "issue_comment";
      readonly body: string;
      readonly authorAssociation: string;
      readonly isPullRequest: boolean;
      readonly prBranch: string;
    };

export type ResumeTrigger =
  | { readonly trigger: true; readonly workItemId: string; readonly kind: "merge" | "gate_comment" }
  | { readonly trigger: false; readonly reason: string };

const ID_PATTERN = "[A-Z]+(?:[_-][A-Z]+)*[_-]\\d+";
const LOCK_FILE = new RegExp(`^docs/dev/(${ID_PATTERN})/contract\\.lock\\.json$`);
const PR_BRANCH = new RegExp(
  `^(?:accord/(${ID_PATTERN})/.+|stack/(${ID_PATTERN})/(?:pr-\\d+|closeout))$`,
);
const AUTHORISED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const APPROVE_COMMAND = /^\/accord approve$/;
const UNBLOCK_COMMAND = /^\/accord unblock(?:\s+(\d+)\s+([\s\S]*\S))?$/;

function isAuthorised(association: string): boolean {
  return AUTHORISED.has(association);
}

function isGateCommand(body: string): boolean {
  const text = body.trim();
  return APPROVE_COMMAND.test(text) || UNBLOCK_COMMAND.test(text);
}

function hasCommittedState(repoRoot: string, workItemId: string): boolean {
  return existsSync(join(repoRoot, "docs", "dev", workItemId, "state", "work-item.json"));
}

export function detectResumeTrigger(opts: {
  readonly repoRoot: string;
  readonly event: ResumeEvent;
}): ResumeTrigger {
  const { event } = opts;
  let workItemId: string | undefined;
  let kind: "merge" | "gate_comment" = "merge";
  if (event.name === "push") {
    if (event.branch !== "main") return { trigger: false, reason: "not_main_push" };
    for (const file of event.changedFiles) {
      const match = LOCK_FILE.exec(file);
      if (match?.[1]) {
        workItemId = match[1];
        break;
      }
    }
    if (!workItemId) return { trigger: false, reason: "no_contract_lock_change" };
  } else {
    kind = "gate_comment";
    if (!event.isPullRequest) return { trigger: false, reason: "not_a_pull_request" };
    if (!isAuthorised(event.authorAssociation)) return { trigger: false, reason: "unauthorised" };
    if (!isGateCommand(event.body)) return { trigger: false, reason: "not_a_gate_command" };
    const match = PR_BRANCH.exec(event.prBranch);
    workItemId = match?.[1] ?? match?.[2];
    if (!workItemId) return { trigger: false, reason: "not_a_work_item_branch" };
  }
  if (loadDevHarnessConfig(opts.repoRoot)?.stack?.enabled !== true) {
    return { trigger: false, reason: "stack_disabled" };
  }
  if (!hasCommittedState(opts.repoRoot, workItemId)) {
    return { trigger: false, reason: "no_committed_state" };
  }
  return { trigger: true, workItemId, kind };
}

export type LockResult =
  | { readonly acquired: true; readonly release: () => void }
  | { readonly acquired: false };

export function acquireResumeLock(opts: {
  readonly workItemId: string;
  readonly lockDir: string;
}): LockResult {
  mkdirSync(opts.lockDir, { recursive: true });
  const path = join(opts.lockDir, `${opts.workItemId}.lock`);
  let descriptor: number;
  try {
    descriptor = openSync(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { acquired: false };
    throw error;
  }
  writeSync(descriptor, `${process.pid}\n`);
  closeSync(descriptor);
  let released = false;
  return {
    acquired: true,
    release: () => {
      if (released) return;
      released = true;
      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    },
  };
}

export interface PrComment {
  readonly body: string;
  readonly author_association: string;
}

export interface Gates {
  readonly pr0_approved: boolean;
  readonly unblock_requested: boolean;
  readonly closeout_ready: boolean;
  /** Set when the authorised comment was `/accord unblock <task> <reason>`. */
  readonly unblock?: { readonly task: number; readonly reason: string };
}

function parseTrailer(message: string): ReturnType<typeof parseAccordTrailer> {
  try {
    return parseAccordTrailer(message);
  } catch {
    return null;
  }
}

/** Gates from PR comments (the newest matching comment wins) and from typed commits. */
export function readGates(opts: {
  readonly workItemId: string;
  readonly comments: readonly PrComment[];
  readonly commitMessages: readonly string[];
}): Gates {
  let pr0Approved = false;
  let unblockRequested = false;
  let unblock: { task: number; reason: string } | undefined;
  for (const comment of opts.comments) {
    if (!isAuthorised(comment.author_association)) continue;
    const text = comment.body.trim();
    if (APPROVE_COMMAND.test(text)) {
      pr0Approved = true;
      continue;
    }
    const match = UNBLOCK_COMMAND.exec(text);
    if (!match) continue;
    unblockRequested = true;
    unblock =
      match[1] !== undefined && match[2] !== undefined
        ? { task: Number(match[1]), reason: match[2] }
        : undefined;
  }
  const closeoutReady = opts.commitMessages.some((message) => {
    const trailer = parseTrailer(message);
    return trailer?.id === opts.workItemId && trailer.outcome === "closeout";
  });
  return {
    pr0_approved: pr0Approved,
    unblock_requested: unblockRequested,
    closeout_ready: closeoutReady,
    ...(unblock ? { unblock } : {}),
  };
}

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitOk(repoRoot: string, args: string[]): boolean {
  try {
    git(repoRoot, args);
    return true;
  } catch {
    return false;
  }
}

const COMMIT_LOG_BOUND = 500;

function commitMessages(repoRoot: string, workItemId: string): string[] {
  if (!gitOk(repoRoot, ["rev-parse", "--verify", "-q", "HEAD"])) return [];
  return git(repoRoot, [
    "log",
    `--grep=id=${workItemId}`,
    "-n",
    String(COMMIT_LOG_BOUND),
    "--format=%B%x00",
  ]).split("\0");
}

export function planResume(opts: { readonly repoRoot: string; readonly workItemId: string }): {
  readonly lastRef: string | null;
  readonly lastSeq: number;
} {
  for (const message of commitMessages(opts.repoRoot, opts.workItemId)) {
    const trailer = parseTrailer(message);
    if (trailer?.id === opts.workItemId && trailer.ref !== undefined && trailer.seq !== undefined) {
      return { lastRef: trailer.ref, lastSeq: trailer.seq };
    }
  }
  return { lastRef: null, lastSeq: 0 };
}

export type AdvanceResult =
  | { readonly done: true }
  | {
      readonly done: false;
      readonly ref: string;
      readonly cost_usd: number;
      readonly cost_breakdown?: Readonly<Record<string, number>>;
    }
  | { readonly done: false; readonly gate_failed: string };

export interface AdvanceContext {
  readonly workItemId: string;
  readonly repoRoot: string;
  readonly lastRef: string | null;
  readonly lastSeq: number;
  /** Branch the run advances on: stack/<ID>/pr-<N> (closeout: stack/<ID>/closeout), never main once a plan exists. */
  readonly branch: string;
  /** Gate state read at run time from PR comments (fetchComments) and commit messages (git log). */
  readonly gates: Gates;
}

export type ResumeResult =
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "locked" }
  | { readonly status: "completed"; readonly lastRef: string | null }
  | { readonly status: "cost_capped" }
  | { readonly status: "gate_failed"; readonly gate: string };

export interface RunResumeOpts {
  readonly repoRoot: string;
  readonly workItemId: string;
  readonly lockDir: string;
  /** Absent on a push trigger: resolved via `gh pr list` (stack branch PR, then the PR0 PR). */
  readonly prNumber?: number;
  readonly dryRun?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly exec?: ExecLike;
  readonly logger?: Logger;
  /** PR comments source for gate commands. Absent: no comments (the CLI entry supplies a gh-backed reader). */
  readonly fetchComments?: () => Promise<readonly PrComment[]>;
  readonly advance: (ctx: AdvanceContext) => Promise<AdvanceResult>;
}

function currentBranch(repoRoot: string): string {
  return git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

function isTaskDoneOn(repoRoot: string, branch: string, workItemId: string, task: number): boolean {
  if (
    gitOk(repoRoot, [
      "cat-file",
      "-e",
      `${branch}:docs/dev/${workItemId}/evidence/task-${task}.json`,
    ])
  ) {
    return true;
  }
  try {
    const raw = git(repoRoot, [
      "show",
      `${branch}:docs/dev/${workItemId}/state/task-${task}/task.json`,
    ]);
    const parsed = JSON.parse(raw) as { control?: { status?: string } };
    return parsed.control?.status === "done";
  } catch {
    return false;
  }
}

function readPlanTasks(repoRoot: string, workItemId: string): StackPlanTask[] | null {
  const path = join(repoRoot, "docs", "dev", workItemId, "plan.json");
  if (!existsSync(path)) return null;
  try {
    const plan = JSON.parse(readFileSync(path, "utf8")) as { tasks?: StackPlanTask[] };
    return Array.isArray(plan.tasks) ? plan.tasks : null;
  } catch {
    return null;
  }
}

/** Switch to the branch of the next unfinished PR; typed commits go there, never to main. */
async function deriveBranch(opts: RunResumeOpts): Promise<string> {
  const { repoRoot, workItemId } = opts;
  const current = currentBranch(repoRoot);
  if (current !== "main" && !current.startsWith(`stack/${workItemId}/`)) return current;
  const tasks = readPlanTasks(repoRoot, workItemId);
  if (!tasks) return current;

  const devConfig = loadDevHarnessConfig(repoRoot);
  const prs = computeStack({ tasks }, resolveStackConfig(devConfig).sizing).prs.filter(
    (pr) => pr.kind === "task",
  );
  gitOk(repoRoot, ["fetch", "--quiet", "origin"]);
  const remotePrefix = `refs/remotes/origin/stack/${workItemId}/`;
  const remoteBranches = git(repoRoot, ["for-each-ref", "--format=%(refname)", remotePrefix])
    .split("\n")
    .filter(Boolean)
    .map((ref) => ref.slice("refs/remotes/origin/".length));
  for (const branch of remoteBranches) {
    if (!gitOk(repoRoot, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])) {
      git(repoRoot, ["branch", branch, `origin/${branch}`]);
    }
  }

  const unfinished = prs.find((pr) => {
    const branch = branchFor(workItemId, pr.index);
    return (
      !gitOk(repoRoot, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]) ||
      !pr.tasks.every((task) => isTaskDoneOn(repoRoot, branch, workItemId, task))
    );
  });
  if (!unfinished) {
    const closeout = await ensureCloseoutBranch(workItemId, devConfig, { cwd: repoRoot });
    if (!closeout.ok) throw new Error(closeout.reason);
    return closeout.branch;
  }
  const target = branchFor(workItemId, unfinished.index);
  if (current === target) return current;
  if (gitOk(repoRoot, ["rev-parse", "--verify", "-q", `refs/heads/${target}`])) {
    git(repoRoot, ["checkout", "--quiet", target]);
    return target;
  }
  const first = unfinished.tasks[0];
  if (first === undefined) return current;
  const ensured = await ensureTaskBranch(workItemId, first, devConfig, { cwd: repoRoot });
  if (!ensured.ok) throw new Error(ensured.reason);
  return ensured.branch;
}

interface WorkItemCost {
  readonly cost_usd: number;
  readonly cost_breakdown: Readonly<Record<string, number>>;
}

function readWorkItemCost(repoRoot: string, workItemId: string): WorkItemCost {
  try {
    const parsed = JSON.parse(
      readFileSync(join(repoRoot, ".tasks", `${workItemId}.json`), "utf8"),
    ) as { cost_usd?: number; cost_breakdown?: Record<string, number> };
    return {
      cost_usd: typeof parsed.cost_usd === "number" ? parsed.cost_usd : 0,
      cost_breakdown: parsed.cost_breakdown ?? {},
    };
  } catch {
    return { cost_usd: 0, cost_breakdown: {} };
  }
}

type PrRow = { number: number; headRefName: string };

async function listPrs(
  exec: ExecLike,
  repoRoot: string,
  token: string,
  head?: string,
): Promise<PrRow[]> {
  const result = await exec(
    "gh",
    [
      "pr",
      "list",
      ...(head ? ["--head", head] : []),
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,headRefName",
    ],
    { cwd: repoRoot, env: { GH_TOKEN: token } },
  );
  if (result.exitCode !== 0) throw new Error(`gh pr list failed (exit ${result.exitCode})`);
  return JSON.parse(result.stdout) as PrRow[];
}

/** The open PR on the stack branch, else the PR0 PR (accord/<ID>/*); null when neither exists. */
async function findWorkItemPr(
  opts: RunResumeOpts,
  env: Readonly<Record<string, string | undefined>>,
  branch: string,
): Promise<number | null> {
  const token = env[CI_PUSH_TOKEN_NAME];
  if (opts.dryRun || !token) return null;
  const exec = opts.exec ?? spawnExec;
  try {
    const onBranch = (await listPrs(exec, opts.repoRoot, token, branch)).find(
      (pr) => pr.headRefName === branch,
    );
    if (onBranch) return onBranch.number;
    const all = await listPrs(exec, opts.repoRoot, token);
    return (
      all.find((pr) => pr.headRefName.startsWith(`accord/${opts.workItemId}/`))?.number ?? null
    );
  } catch {
    return null;
  }
}

export async function runResume(opts: RunResumeOpts): Promise<ResumeResult> {
  const { repoRoot, workItemId } = opts;
  const env = opts.env ?? process.env;
  const config = loadDevHarnessConfig(repoRoot);
  if (config?.stack?.enabled !== true) return { status: "skipped", reason: "stack_disabled" };
  if (!hasCommittedState(repoRoot, workItemId)) {
    return { status: "skipped", reason: "no_committed_state" };
  }
  if (!opts.dryRun && !env[CI_PUSH_TOKEN_NAME]) throw new MissingSecretError(CI_PUSH_TOKEN_NAME);

  const lock = acquireResumeLock({ workItemId, lockDir: opts.lockDir });
  if (!lock.acquired) return { status: "locked" };
  try {
    const branch = await deriveBranch(opts);
    const restored = restoreStateFromTree(workItemId, repoRoot);
    if (!restored.ok) throw new Error(restored.error);

    const cap = config.stack.ci?.cost_cap_usd;
    const overCap = (cost: WorkItemCost): boolean =>
      typeof cap === "number" &&
      checkCostCap(
        { id: workItemId, ...cost },
        { maxCostUsd: cap, nextPhase: "resume", ticket: workItemId, transitionOnCostExceeded: "" },
      ).tripped;
    const alert = async (condition: string, detail?: string): Promise<void> => {
      const prNumber =
        opts.prNumber ?? (await findWorkItemPr(opts, env, currentBranch(repoRoot) || branch));
      await raiseAlert({
        workItemId,
        condition,
        prNumber,
        cwd: repoRoot,
        dryRun: opts.dryRun,
        env,
        exec: opts.exec,
        logger: opts.logger,
        detail,
      });
    };

    if (overCap(readWorkItemCost(repoRoot, workItemId))) {
      await alert("cost_cap_exceeded");
      return { status: "cost_capped" };
    }

    const comments = (await opts.fetchComments?.()) ?? [];
    let consumedUnblock = false;
    let progress = planResume({ repoRoot, workItemId });
    for (;;) {
      const read = readGates({
        workItemId,
        comments,
        commitMessages: commitMessages(repoRoot, workItemId),
      });
      const { unblock: _unblock, ...rest } = read;
      const gates: Gates = {
        ...(consumedUnblock ? { ...rest, unblock_requested: false } : read),
        pr0_approved:
          read.pr0_approved ||
          existsSync(join(repoRoot, "docs", "dev", workItemId, "contract.lock.json")),
      };
      const result = await opts.advance({
        workItemId,
        repoRoot,
        lastRef: progress.lastRef,
        lastSeq: progress.lastSeq,
        branch,
        gates,
      });
      consumedUnblock = true;
      if (result.done) return { status: "completed", lastRef: progress.lastRef };
      if ("gate_failed" in result) {
        const gate = result.gate_failed.replace(/\s+/g, "_");
        await alert(`gate_failed:${gate}`);
        return { status: "gate_failed", gate: result.gate_failed };
      }
      if (overCap({ cost_usd: result.cost_usd, cost_breakdown: result.cost_breakdown ?? {} })) {
        await alert("cost_cap_exceeded");
        return { status: "cost_capped" };
      }
      const next = planResume({ repoRoot, workItemId });
      if (next.lastSeq <= progress.lastSeq) {
        throw new Error(`advance made no progress for ${workItemId} at seq ${progress.lastSeq}`);
      }
      progress = next;
    }
  } finally {
    lock.release();
  }
}

export interface CiAdvanceOpts {
  readonly runBackend: PhaseRunBackend;
  readonly exec: ExecLike;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const MAIN_BRANCHES = new Set(["main", "master"]);

const STACK_BRANCH = /^stack\/[^/]+\/(?:pr-\d+|closeout)$/;

async function pushRef(opts: CiAdvanceOpts, repoRoot: string, branch: string): Promise<void> {
  const token = opts.env[CI_PUSH_TOKEN_NAME];
  if (token === undefined || token === "") throw new MissingSecretError(CI_PUSH_TOKEN_NAME);
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  process.stdout.write(`::add-mask::${basic}\n`);
  const result = await opts.exec("git", ["push", "origin", `${branch}:refs/heads/${branch}`], {
    cwd: repoRoot,
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git push of ${branch} failed (exit ${result.exitCode})`);
  }
}

async function pushHead(opts: CiAdvanceOpts, ctx: AdvanceContext): Promise<void> {
  const head = currentBranch(ctx.repoRoot);
  if (MAIN_BRANCHES.has(ctx.branch) || MAIN_BRANCHES.has(head)) {
    throw new Error(
      "refusing to push typed commits to main: the stack branch switch did not happen",
    );
  }
  if (!STACK_BRANCH.test(head) || !head.startsWith(`stack/${ctx.workItemId}/`)) {
    throw new Error(`refusing to push ${head}: not a stack/${ctx.workItemId}/ branch`);
  }
  const others = git(ctx.repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    `refs/heads/stack/${ctx.workItemId}/`,
  ])
    .split("\n")
    .filter((name) => name && name !== head && STACK_BRANCH.test(name))
    .filter((name) => {
      const remote = `refs/remotes/origin/${name}`;
      return (
        gitOk(ctx.repoRoot, ["rev-parse", "--verify", "-q", remote]) &&
        git(ctx.repoRoot, ["rev-list", "--count", `${remote}..${name}`]) !== "0"
      );
    });
  for (const name of others) await pushRef(opts, ctx.repoRoot, name);
  await pushRef(opts, ctx.repoRoot, head);
}

/**
 * CI default advance: runs one phase through the exec-harness backend (the orchestrator makes the
 * typed commit), then pushes HEAD once without force. Returns done when no new typed commit exists.
 */
export function createCiAdvance(
  opts: CiAdvanceOpts,
): (ctx: AdvanceContext) => Promise<AdvanceResult> {
  return async (ctx) => {
    const run = (phase: string, extraArgs?: readonly string[]) =>
      opts.runBackend({
        phase,
        ticket: ctx.workItemId,
        cwd: ctx.repoRoot,
        ...(extraArgs ? { extraArgs } : {}),
      });

    const unblock = ctx.gates.unblock_requested ? ctx.gates.unblock : undefined;
    if (unblock) {
      const unblocked = await run("unblock", [
        "--task",
        String(unblock.task),
        "--reason",
        unblock.reason,
      ]);
      if (unblocked.exitCode !== 0) {
        throw new Error(
          `accord unblock of task ${unblock.task} failed (exit ${unblocked.exitCode})`,
        );
      }
    }

    const headBefore = git(ctx.repoRoot, ["rev-parse", "HEAD"]);
    const backend = await run("resume");
    const next = planResume({ repoRoot: ctx.repoRoot, workItemId: ctx.workItemId });
    const committed = git(ctx.repoRoot, ["rev-parse", "HEAD"]) !== headBefore;
    if (committed && next.lastRef !== null) {
      await pushHead(opts, ctx);
      const cost = readWorkItemCost(ctx.repoRoot, ctx.workItemId);
      return {
        done: false,
        ref: next.lastRef,
        cost_usd: cost.cost_usd,
        ...(Object.keys(cost.cost_breakdown).length > 0
          ? { cost_breakdown: cost.cost_breakdown }
          : {}),
      };
    }

    const { resultFromBackend } = await import("../run-phase.js");
    const outcome = resultFromBackend(backend);
    if (outcome.status === "done") return { done: true };
    if (outcome.status === "blocked") return { done: false, gate_failed: "blocked task" };
    if (outcome.status === "stuck") {
      if (outcome.reason === "subprocess_failed") {
        throw new Error(outcome.detail ?? "accord resume failed");
      }
      return { done: false, gate_failed: outcome.reason };
    }
    return { done: false, gate_failed: outcome.status };
  };
}

// ── CLI entry ───────────────────────────────────────────────────────────────

function writeOutput(line: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${line}\n`);
}

async function ghComments(
  repoRoot: string,
  token: string,
  prNumber: number,
): Promise<readonly PrComment[]> {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return [];
  const result = await spawnExec(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repository}/issues/${prNumber}/comments`,
      "--jq",
      ".[] | {body: .body, author_association: .author_association}",
    ],
    { cwd: repoRoot, env: { GH_TOKEN: token } },
  );
  if (result.exitCode !== 0) throw new Error(`gh api comments failed (exit ${result.exitCode})`);
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PrComment);
}

/** Exec-harness backend; `unblock` maps the comment to `accord unblock <ID> --task <n> --note F-n <reason>`. */
async function createCliBackend(): Promise<PhaseRunBackend> {
  const { defaultRunBackend } = await import("../run-phase.js");
  return async (backendOpts) => {
    if (backendOpts.phase !== "unblock") return defaultRunBackend(backendOpts);
    const [, taskArg, , reason = ""] = backendOpts.extraArgs ?? [];
    const taskId = Number(taskArg);
    const { loadTaskV2 } = await import("@clive.shirley/accord-core/tasks/store.js");
    const { runUnblockCommand } = await import("@clive.shirley/accord-cli/commands/unblock.js");
    const blockers = loadTaskV2(backendOpts.ticket, taskId)?.summary.blockers ?? [];
    if (blockers.length === 0) return { exitCode: 0 };
    const args = [
      "--task",
      String(taskId),
      ...blockers.flatMap((blocker) => ["--note", blocker.finding, reason]),
    ];
    return { exitCode: await runUnblockCommand(backendOpts.ticket, args, { json: false }) };
  };
}

async function main(): Promise<number> {
  const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
  const workItemId = process.env.ACCORD_CI_WORK_ITEM_ID ?? "";
  const prValue = Number(process.env.ACCORD_CI_PR_NUMBER ?? "");
  const prNumber = Number.isInteger(prValue) && prValue > 0 ? prValue : undefined;
  const token = process.env[CI_PUSH_TOKEN_NAME];
  delete process.env[CI_PUSH_TOKEN_NAME];
  const tokenEnv = { ...process.env, ...(token ? { [CI_PUSH_TOKEN_NAME]: token } : {}) };
  const backend = await createCliBackend();
  const result = await runResume({
    repoRoot,
    workItemId,
    lockDir: join(process.env.RUNNER_TEMP || tmpdir(), "accord-locks"),
    prNumber,
    dryRun: process.env.ACCORD_CI_DRY_RUN === "true",
    env: tokenEnv,
    logger: createLogger("stack"),
    fetchComments:
      prNumber !== undefined && token ? () => ghComments(repoRoot, token, prNumber) : undefined,
    advance: createCiAdvance({ runBackend: backend, exec: spawnExec, env: tokenEnv }),
  });
  writeOutput(`status=${result.status}`);
  process.stdout.write(`accord-driven: resume ${result.status}\n`);
  return result.status === "cost_capped" || result.status === "gate_failed" ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
