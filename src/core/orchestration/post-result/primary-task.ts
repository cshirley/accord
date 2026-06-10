/**
 * `advancePrimaryTask` — shared mutation for post-result handlers that touch the primary task file.
 *
 * Loads the work item + primary task file, lets `mutate` adjust both, appends a
 * single event to the task file, persists timestamps, and writes both records.
 * Returns `null` when the work item / task file isn't loadable so callers can
 * fall back to the "this path does not apply" return value.
 */

import * as path from "node:path";
import {
  loadTaskFile,
  loadWorkItem,
  now,
  readJson,
  taskJsonPath,
  writeJson,
  workItemJsonPath,
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
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return false;
  }

  const primaryTaskId = resolvePrimaryTaskIdForMutation(wi);
  const taskPath = taskJsonPath(workItemId, primaryTaskId);
  const task = readJson<Record<string, unknown>>(taskPath);
  if (!task) {
    return false;
  }

  const timestamp = now();
  const result = mutate({ workItem: wi, task, taskPath, primaryTaskId, timestamp });
  if (result === false) {
    return false;
  }

  if (result.event) {
    const events = Array.isArray(task.events) ? [...(task.events as unknown[])] : [];
    task.events = [...events, { at: timestamp, ...result.event }];
  }

  writeJson(taskPath, task);
  // Mutators such as `devPromoteEvents` may persist work-item side effects; reload so we
  // do not clobber decisions/deviations written during `mutate`.
  const wiToWrite = loadWorkItem(workItemId) ?? wi;
  wiToWrite.updated = timestamp;
  writeJson(workItemJsonPath(workItemId), wiToWrite);
  return true;
}
