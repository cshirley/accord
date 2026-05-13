/**
 * `advancePrimaryTask` — shared mutation for post-result handlers that touch the primary task file.
 *
 * Loads the work item + primary task file, lets `mutate` adjust both, appends a
 * single event to the task file, persists timestamps, and writes both records.
 * Returns `null` when the work item / task file isn't loadable so callers can
 * fall back to the "this path does not apply" return value.
 */

import * as path from "node:path";
import { loadWorkItem, now, readJson, TASKS_DIR, writeJson } from "../../work-items/io.js";
import type { WorkItem } from "../../work-items/types.js";

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

  const primaryTaskId = wi.task_ids[0] ?? 1;
  const taskPath = path.join(TASKS_DIR, `${workItemId}-task-${primaryTaskId}.json`);
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

  wi.updated = timestamp;
  writeJson(taskPath, task);
  writeJson(path.join(TASKS_DIR, `${workItemId}.json`), wi);
  return true;
}
