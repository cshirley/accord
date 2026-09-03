/**
 * Optional per-task git commit after **review-code** marks a plan task `done`.
 */

import * as path from "node:path";
import type { DevHarnessConfig } from "../config/types.js";
import {
  commitWithMessage,
  extractStatusPaths,
  git,
  gitRoot,
  isSecretFile,
} from "../git/helpers.js";
import { loadTaskFile, loadWorkItem, readJson, taskJsonPath, writeJson } from "../work-items/io.js";
import { commitOnTaskDoneFromDevConfig } from "./policy.js";

export interface CommitOnTaskDoneResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hash?: string;
  files?: string[];
  message?: string;
}

function taskHasHarnessCommit(task: Record<string, unknown>): boolean {
  const events = task.events;
  if (!Array.isArray(events)) return false;
  return events.some(
    (e) => e && typeof e === "object" && (e as { type?: string }).type === "harness_task_commit",
  );
}

function loadPlanTask(
  workItemId: string,
  planPath: string | null | undefined,
  taskId: number,
): { title: string; files: string[] } | null {
  const resolved = planPath ?? path.join("docs", "dev", workItemId, "plan.json");
  const plan = readJson<{ tasks?: Array<{ id: number; title?: string; files?: string[] }> }>(
    resolved,
  );
  if (!plan?.tasks) return null;
  const entry = plan.tasks.find((t) => t.id === taskId);
  if (!entry) return null;
  return {
    title: typeof entry.title === "string" ? entry.title : `Task ${String(taskId)}`,
    files: Array.isArray(entry.files)
      ? entry.files.filter((f): f is string => typeof f === "string")
      : [],
  };
}

function candidatePathsForTask(
  workItemId: string,
  planFiles: string[],
  testFiles: string[],
): string[] {
  const devPrefix = `docs/dev/${workItemId}/`;
  return [...new Set([...planFiles, ...testFiles, devPrefix])];
}

function pathMatchesCandidate(statusPath: string, candidate: string): boolean {
  if (candidate.endsWith("/")) {
    return statusPath.startsWith(candidate) || statusPath === candidate.slice(0, -1);
  }
  return statusPath === candidate || statusPath.endsWith(`/${candidate}`);
}

function resolveStagedFiles(statusPaths: string[], candidates: string[]): string[] {
  const safe = statusPaths.filter((p) => p && !isSecretFile(p));
  if (candidates.length === 0) {
    return safe;
  }
  return safe.filter((p) => candidates.some((c) => pathMatchesCandidate(p, c)));
}

function buildCommitMessage(workItemId: string, taskId: number, title: string): string {
  const summary = title.length > 55 ? `${title.slice(0, 52)}...` : title;
  return `[${workItemId}] Task ${String(taskId)}: ${summary}`;
}

/**
 * When `orchestration.commit.on_task_done` is true, commit task-scoped changes after
 * **review-code** completes with `status: done` on the task file.
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

  const task = loadTaskFile(workItemId, String(taskId));
  if (!task) {
    return { ok: true, skipped: true, reason: "task file missing" };
  }
  if (task.status !== "done") {
    return { ok: true, skipped: true, reason: "task not done" };
  }
  if (taskHasHarnessCommit(task)) {
    return { ok: true, skipped: true, reason: "already committed for this task" };
  }

  const wi = loadWorkItem(workItemId);
  const planTask = loadPlanTask(workItemId, wi?.plan ?? null, taskId);
  const testFiles = Array.isArray(task.test_files)
    ? (task.test_files as unknown[]).filter((f): f is string => typeof f === "string")
    : [];
  const candidates = candidatePathsForTask(workItemId, planTask?.files ?? [], testFiles);

  let root: string;
  try {
    root = await gitRoot(cwd, signal);
  } catch {
    return { ok: true, skipped: true, reason: "not a git repository" };
  }

  let statusRaw: string;
  try {
    statusRaw = await git(["status", "--porcelain"], root, signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `git status failed: ${msg}` };
  }

  const statusPaths = extractStatusPaths(statusRaw);
  const files = resolveStagedFiles(statusPaths, candidates);
  if (files.length === 0) {
    return { ok: true, skipped: true, reason: "no committable changes for this task" };
  }

  const message = buildCommitMessage(workItemId, taskId, planTask?.title ?? "implementation");
  try {
    const { hash } = await commitWithMessage(root, files, message, signal);
    const taskPath = taskJsonPath(workItemId, String(taskId));
    const fresh = readJson<Record<string, unknown>>(taskPath);
    if (fresh) {
      const events = Array.isArray(fresh.events) ? [...(fresh.events as unknown[])] : [];
      fresh.events = [
        ...events,
        {
          at: new Date().toISOString(),
          type: "harness_task_commit",
          hash,
          files,
          message,
        },
      ];
      writeJson(taskPath, fresh);
    }
    return { ok: true, hash, files, message };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}
