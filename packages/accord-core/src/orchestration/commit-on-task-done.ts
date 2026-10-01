/**
 * Harness git commits for completed work:
 *
 * - **Per task** — every plan task that reaches `done` gets an associated commit (task-scoped
 *   files + the refreshed `docs/dev/<ID>/trace.*`). Done tasks without a `commit` log entry are
 *   swept on every subagent result, so tasks completed outside a spawn (e.g. `accord unblock`)
 *   or whose commit failed are retried until committed.
 * - **At finalize** — `docs/dev/<ID>/` closeout artifacts (verify, trace, workflow cost).
 */

import * as path from "node:path";
import { listWorkItemTaskIds, writeWorkItemTrace } from "../artifacts/trace-artifact.js";
import { devPersistWorkflowCost } from "../artifacts/workflow-cost-artifact.js";
import type { DevHarnessConfig } from "../config/types.js";
import {
  commitWithMessage,
  extractStatusPaths,
  git,
  gitRoot,
  isSecretFile,
} from "../git/helpers.js";
import { createLogger } from "../logging.js";
import { devVerifySummary } from "../queries/verify-summary.js";
import { allocateRef, appendLog, changedFiles, refActor } from "../tasks/model.js";
import { loadTaskV2, mutateTaskV2 } from "../tasks/store.js";
import type { TaskFileV2 } from "../tasks/types.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { loadWorkItem, readJson } from "../work-items/io.js";
import { commitOnFinalizeFromDevConfig, commitOnTaskDoneFromDevConfig } from "./policy.js";

const log = createLogger("commit");

export interface CommitOnTaskDoneResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hash?: string;
  files?: string[];
  message?: string;
  /** True when the commit carries no file changes (`--allow-empty`). */
  empty?: boolean;
}

function taskHasHarnessCommit(task: TaskFileV2): boolean {
  return task.log.some((entry) => refActor(entry.ref) === "commit" && entry.result === "committed");
}

/** Plan `files[]` entries are `{ path, action }` objects (legacy: plain strings). */
function planFilePath(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const filePath = (entry as { path?: unknown }).path;
    if (typeof filePath === "string" && filePath) return filePath;
  }
  return null;
}

function loadPlanTask(
  workItemId: string,
  planPath: string | null | undefined,
  taskId: number,
): { title: string; files: string[] } | null {
  const resolved = planPath ?? path.join(devArtifactDirRel(workItemId), "plan.json");
  const plan = readJson<{ tasks?: Array<{ id: number; title?: string; files?: unknown[] }> }>(
    resolved,
  );
  if (!plan?.tasks) return null;
  const entry = plan.tasks.find((t) => t.id === taskId);
  if (!entry) return null;
  return {
    title: typeof entry.title === "string" ? entry.title : `Task ${String(taskId)}`,
    files: Array.isArray(entry.files)
      ? entry.files.map(planFilePath).filter((f): f is string => f !== null)
      : [],
  };
}

function candidatePathsForTask(
  workItemId: string,
  planFiles: string[],
  testFiles: string[],
): string[] {
  const devPrefix = `${devArtifactDirRel(workItemId)}/`;
  return [...new Set([...planFiles, ...testFiles, devPrefix])];
}

export function pathMatchesCandidate(statusPath: string, candidate: string): boolean {
  const normalized = candidate.replace(/^\.\//, "");
  if (normalized.endsWith("/")) {
    return (
      statusPath.startsWith(normalized) ||
      statusPath.includes(`/${normalized}`) ||
      statusPath === normalized.slice(0, -1)
    );
  }
  return statusPath === normalized || statusPath.endsWith(`/${normalized}`);
}

function resolveStagedFiles(statusPaths: string[], candidates: string[]): string[] {
  return statusPaths.filter(
    (p) =>
      p &&
      !isSecretFile(p) &&
      !p.split("/").includes(".tasks") &&
      candidates.some((c) => pathMatchesCandidate(p, c)),
  );
}

function buildCommitMessage(workItemId: string, taskId: number, title: string): string {
  const summary = title.length > 55 ? `${title.slice(0, 52)}...` : title;
  return `[${workItemId}] Task ${String(taskId)}: ${summary}`;
}

/**
 * Changed paths in the working tree. `--untracked-files=all` lists files inside new
 * directories individually (the default collapses them to `dir/`, which never matches a
 * task's file list — new modules were silently left out of task commits).
 */
async function workingTreePaths(root: string, signal?: AbortSignal): Promise<string[]> {
  const statusRaw = await git(["status", "--porcelain", "--untracked-files=all"], root, signal);
  return extractStatusPaths(statusRaw);
}

/**
 * When `orchestration.commit.on_task_done` is not `false`, commit a task that is `done` and
 * has no harness commit yet: task-scoped files (plan `files[]`, test files, recorded changes)
 * plus the refreshed `docs/dev/<ID>/trace.*`. Falls back to an empty commit so every done task
 * has an associated commit even when its changes were already committed.
 */
export async function tryCommitOnTaskDone(
  workItemId: string,
  taskId: number,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
  signal?: AbortSignal,
): Promise<CommitOnTaskDoneResult> {
  if (!commitOnTaskDoneFromDevConfig(devConfig)) {
    return { ok: true, skipped: true, reason: "commit.on_task_done explicitly disabled" };
  }

  const task = loadTaskV2(workItemId, String(taskId));
  if (!task) {
    return { ok: true, skipped: true, reason: "task file missing" };
  }
  if (task.control.status !== "done") {
    return { ok: true, skipped: true, reason: "task not done" };
  }
  if (taskHasHarnessCommit(task)) {
    return { ok: true, skipped: true, reason: "already committed for this task" };
  }

  let root: string;
  try {
    root = await gitRoot(cwd, signal);
  } catch {
    return { ok: true, skipped: true, reason: "not a git repository" };
  }

  const traced = writeWorkItemTrace(workItemId);
  if (!traced.ok) log.warn(`trace not written for ${workItemId}: ${traced.error}`);
  const cost = devPersistWorkflowCost(workItemId);
  if (!cost.ok) log.warn(`workflow cost not written for ${workItemId}: ${cost.error}`);

  const wi = loadWorkItem(workItemId);
  const planTask = loadPlanTask(workItemId, wi?.plan ?? null, taskId);
  const testFiles = [...new Set([...task.control.test_files, ...changedFiles(task)])];
  const candidates = candidatePathsForTask(workItemId, planTask?.files ?? [], testFiles);

  let statusPaths: string[];
  try {
    statusPaths = await workingTreePaths(root, signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `git status failed: ${msg}` };
  }

  const files = resolveStagedFiles(statusPaths, candidates);
  const empty = files.length === 0;
  const title = planTask?.title ?? task.title ?? "implementation";
  const message = empty
    ? `${buildCommitMessage(workItemId, taskId, title)}\n\nNo task-scoped file changes remained uncommitted; recorded to mark task completion.`
    : buildCommitMessage(workItemId, taskId, title);
  try {
    const { hash } = await commitWithMessage(root, files, message, signal, { allowEmpty: true });
    mutateTaskV2(workItemId, taskId, (fresh, at) => {
      appendLog(fresh, {
        ref: allocateRef(fresh, "commit"),
        at,
        result: "committed",
        note: `${hash} ${message.split("\n")[0] ?? ""} (${String(files.length)} file(s))`,
      });
      return true;
    });
    return { ok: true, hash, files, message, ...(empty ? { empty } : {}) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

export interface DoneTaskCommitOutcome extends CommitOnTaskDoneResult {
  task_id: number;
}

/**
 * Commit every `done` task of the work item that has no harness commit yet (lowest id first).
 * Idempotent: tasks with a `commit` log entry are skipped without touching git.
 */
export async function commitDoneTasks(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
  signal?: AbortSignal,
): Promise<DoneTaskCommitOutcome[]> {
  if (!commitOnTaskDoneFromDevConfig(devConfig)) return [];
  const outcomes: DoneTaskCommitOutcome[] = [];
  for (const taskId of listWorkItemTaskIds(workItemId, loadWorkItem(workItemId))) {
    const task = loadTaskV2(workItemId, taskId);
    if (task?.control.status !== "done" || taskHasHarnessCommit(task)) continue;
    const result = await tryCommitOnTaskDone(workItemId, taskId, devConfig, cwd, signal);
    outcomes.push({ task_id: taskId, ...result });
  }
  return outcomes;
}

/** Markdown lines describing {@link commitDoneTasks} outcomes (empty when nothing happened). */
export function formatDoneTaskCommits(outcomes: DoneTaskCommitOutcome[]): string {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    const label = `Task ${String(outcome.task_id)}`;
    if (outcome.ok && outcome.hash) {
      lines.push(
        `**Task commit:** \`${outcome.hash}\` — ${outcome.message?.split("\n")[0] ?? label}${outcome.empty ? " (no file changes)" : ""}`,
      );
    } else if (!outcome.ok) {
      lines.push(
        `**Task commit failed** (${label}): ${outcome.reason ?? "unknown error"} — retried on the next result.`,
      );
    }
  }
  return lines.length > 0 ? `\n\n${lines.join("\n")}` : "";
}

/** Agents whose post-result can mark a task `done` (commit hook trigger). */
export const TASK_DONE_AGENTS: ReadonlySet<string> = new Set(["review-code", "phase-verify-task"]);

export interface CommitWorkItemArtifactsResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hash?: string;
  files?: string[];
  task_commits: DoneTaskCommitOutcome[];
}

/**
 * Closeout commit: sweep uncommitted done tasks, then commit `docs/dev/<ID>/` (verify, trace,
 * workflow cost, …). Controlled by `orchestration.commit.on_finalize` (default true).
 */
export async function commitWorkItemArtifacts(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
  signal?: AbortSignal,
): Promise<CommitWorkItemArtifactsResult> {
  const taskCommits = await commitDoneTasks(workItemId, devConfig, cwd, signal);
  // Refresh trace + verify.md so they record the task commits made by the sweep above.
  const wi = loadWorkItem(workItemId);
  if (wi?.verify) {
    const summary = devVerifySummary(workItemId);
    if (!summary.ok) log.warn(`verify.md not refreshed for ${workItemId}: ${summary.error}`);
  } else {
    devPersistWorkflowCost(workItemId);
    const traced = writeWorkItemTrace(workItemId);
    if (!traced.ok) log.warn(`trace not written for ${workItemId}: ${traced.error}`);
  }
  if (!commitOnFinalizeFromDevConfig(devConfig)) {
    return {
      ok: true,
      skipped: true,
      reason: "commit.on_finalize explicitly disabled",
      task_commits: taskCommits,
    };
  }

  let root: string;
  try {
    root = await gitRoot(cwd, signal);
  } catch {
    return { ok: true, skipped: true, reason: "not a git repository", task_commits: taskCommits };
  }

  let files: string[];
  try {
    files = resolveStagedFiles(await workingTreePaths(root, signal), [
      `${devArtifactDirRel(workItemId)}/`,
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `git status failed: ${msg}`, task_commits: taskCommits };
  }
  if (files.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "no uncommitted closeout artifacts",
      task_commits: taskCommits,
    };
  }

  const message = `[${workItemId}] Closeout: verify report, implementation trace, workflow cost`;
  try {
    const { hash } = await commitWithMessage(root, files, message, signal);
    return { ok: true, hash, files, task_commits: taskCommits };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg, task_commits: taskCommits };
  }
}

/** One-paragraph markdown summary of {@link commitWorkItemArtifacts}. */
export function formatWorkItemArtifactsCommit(result: CommitWorkItemArtifactsResult): string {
  let text = formatDoneTaskCommits(result.task_commits);
  if (result.ok && result.hash) {
    text += `\n\n**Closeout commit:** \`${result.hash}\` (${String(result.files?.length ?? 0)} file(s) under docs/dev/)`;
  } else if (!result.ok) {
    text += `\n\n**Closeout commit failed:** ${result.reason ?? "unknown error"}`;
  }
  return text;
}
