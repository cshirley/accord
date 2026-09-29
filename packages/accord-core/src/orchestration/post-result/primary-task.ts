/**
 * `advancePrimaryTask` — shared mutation for post-result handlers that touch the primary task file.
 *
 * Loads the work item + primary v2 task file under the work item's task lock, lets `mutate`
 * adjust both, recomputes the task snapshot (`refreshTask`), and writes both records.
 */

import { worktreeFingerprintSync } from "../../git/helpers.js";
import { refreshTask } from "../../tasks/model.js";
import { loadTaskResult, loadTaskV2 } from "../../tasks/store.js";
import type { TaskFileV2 } from "../../tasks/types.js";
import {
  loadWorkItem,
  now,
  taskLockPath,
  withJsonFileLock,
  workItemJsonPath,
  writeJson,
} from "../../work-items/io.js";
import type { WorkItem } from "../../work-items/types.js";

/**
 * First task in `task_ids` (sorted) that is not `done` or `blocked`, or `null` when every
 * known task file is terminal. Used by resume routing and post-result handlers so a
 * completed task does not keep respawning the same agent under orchestrator replans.
 */
export function resolveActivePrimaryTaskId(workItem: WorkItem): number | null {
  const sorted = [...(workItem.task_ids ?? [])].sort((a, b) => a - b);
  const candidates = sorted.length > 0 ? sorted : [1];

  for (const taskId of candidates) {
    const task = loadTaskV2(workItem.id, String(taskId));
    if (!task) {
      continue;
    }
    const status = task.control.status;
    if (status === "done" || status === "blocked") {
      continue;
    }
    return taskId;
  }
  return null;
}

/** Task id to use when mutating per-task state: active task, else `task_ids[0] ?? 1`. */
export function resolvePrimaryTaskIdForMutation(workItem: WorkItem): number {
  return resolveActivePrimaryTaskId(workItem) ?? workItem.task_ids[0] ?? 1;
}

export interface PrimaryTaskMutationContext {
  workItem: WorkItem;
  task: TaskFileV2;
  taskPath: string;
  primaryTaskId: number;
  timestamp: string;
}

/**
 * Loads the primary task and lets `mutate` adjust both records. Returns `true` iff state was
 * written. `mutate` returns `false` to abort without writing.
 */
export function advancePrimaryTask(
  workItemId: string,
  mutate: (ctx: PrimaryTaskMutationContext) => boolean | undefined,
): boolean {
  // Every caller in this pipeline does read → mutate → write of the SAME task file, often
  // several times for one subagent return. Hold the lock for the full cycle so overlapping
  // callers serialise instead of silently dropping each other's control/counter updates.
  return withJsonFileLock(taskLockPath(workItemId), () => {
    const wi = loadWorkItem(workItemId);
    if (!wi) {
      return false;
    }

    const primaryTaskId = resolvePrimaryTaskIdForMutation(wi);
    const loaded = loadTaskResult(workItemId, primaryTaskId);
    if (loaded.kind !== "ok") {
      return false;
    }

    const timestamp = now();
    const result = mutate({
      workItem: wi,
      task: loaded.task,
      taskPath: loaded.path,
      primaryTaskId,
      timestamp,
    });
    if (result === false) {
      return false;
    }

    const block = loaded.task.control.blocked;
    if (loaded.task.control.status === "blocked" && block && !block.fingerprint) {
      const fingerprint = worktreeFingerprintSync();
      if (fingerprint) block.fingerprint = fingerprint;
    }
    refreshTask(loaded.task, timestamp);
    writeJson(loaded.path, loaded.task);
    // Mutators such as `devPromoteEvents` may persist work-item side effects; reload so we
    // do not clobber decisions/deviations written during `mutate`.
    const wiToWrite = loadWorkItem(workItemId) ?? wi;
    wiToWrite.updated = timestamp;
    writeJson(workItemJsonPath(workItemId), wiToWrite);
    return true;
  });
}
