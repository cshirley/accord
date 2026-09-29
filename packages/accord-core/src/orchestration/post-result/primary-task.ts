/**
 * `advancePrimaryTask` — shared mutation for post-result handlers that touch the primary task file.
 *
 * Loads the work item + primary task file, lets `mutate` adjust both, appends a
 * single event to the task file, persists timestamps, and writes both records.
 * Returns `null` when the work item / task file isn't loadable so callers can
 * fall back to the "this path does not apply" return value.
 */

import {
  loadTaskFile,
  loadWorkItem,
  now,
  readJson,
  taskJsonPath,
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
    const task = loadTaskFile(workItem.id, String(taskId));
    if (!task) {
      continue;
    }
    const status = task.status;
    if (status === "done" || status === "blocked") {
      continue;
    }
    return taskId;
  }
  return null;
}

/** Task id to use when mutating per-task state: active task, else legacy `task_ids[0] ?? 1`. */
export function resolvePrimaryTaskIdForMutation(workItem: WorkItem): number {
  return resolveActivePrimaryTaskId(workItem) ?? workItem.task_ids[0] ?? 1;
}

export interface PrimaryTaskMutationContext {
  workItem: WorkItem;
  task: Record<string, unknown>;
  taskPath: string;
  primaryTaskId: number;
  timestamp: string;
}

export interface PrimaryTaskMutationResult {
  /** Event to append to `task.events[]`. When omitted, no event is recorded. */
  event?: Record<string, unknown>;
}

/**
 * Loads the primary task and lets `mutate` adjust both records. Returns `true`
 * iff state was written.
 */
export function advancePrimaryTask(
  workItemId: string,
  mutate: (ctx: PrimaryTaskMutationContext) => PrimaryTaskMutationResult | false,
): boolean {
  // Every caller in this pipeline (`applyTaskEventsFromPacket`, `persistValidatedAgentReturn`,
  // and each `apply<Agent>PostResult` handler) does its own bare read \u2192 mutate \u2192 write of the
  // SAME task file, often several times in a row for one subagent return. Without a lock, two
  // overlapping calls (concurrent subagent-result batches, or an overlapping harness process on
  // the same work item) can interleave: both read the pre-mutation task, both write back, and
  // the second write silently discards the first mutation. That is invisible for append-only
  // fields (`agent_returns`, `events` \u2014 both writers' appends usually survive across the two
  // writes) but drops scalar/object fields like `review_loop.test_review_retries_used` or
  // `phase`, which is exactly the failure mode that let the review-test\u2194phase-test retry cap
  // run well past its configured limit without ever tripping. Hold the lock (keyed on the task
  // path) for the full read-mutate-write cycle so callers serialise instead of racing.
  return withJsonFileLock(taskLockPath(workItemId), () => {
    const wi = loadWorkItem(workItemId);
    if (!wi) {
      return false;
    }

    const primaryTaskId = resolvePrimaryTaskIdForMutation(wi);
    const resolvedTaskPath = taskJsonPath(workItemId, primaryTaskId);
    const task = readJson<Record<string, unknown>>(resolvedTaskPath);
    if (!task) {
      return false;
    }

    const timestamp = now();
    const result = mutate({
      workItem: wi,
      task,
      taskPath: resolvedTaskPath,
      primaryTaskId,
      timestamp,
    });
    if (result === false) {
      return false;
    }

    if (result.event) {
      const events = Array.isArray(task.events) ? [...(task.events as unknown[])] : [];
      task.events = [...events, { at: timestamp, ...result.event }];
    }

    writeJson(resolvedTaskPath, task);
    // Mutators such as `devPromoteEvents` may persist work-item side effects; reload so we
    // do not clobber decisions/deviations written during `mutate`.
    const wiToWrite = loadWorkItem(workItemId) ?? wi;
    wiToWrite.updated = timestamp;
    writeJson(workItemJsonPath(workItemId), wiToWrite);
    return true;
  });
}
