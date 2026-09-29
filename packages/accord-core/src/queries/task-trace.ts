/**
 * `accord trace` / `/dev trace` / `dev_trace` — render per-task v2 files for humans.
 */

import { renderTaskTrace } from "../tasks/render.js";
import { legacyTaskFileMessage, loadTaskResult } from "../tasks/store.js";
import type { TaskFileV2 } from "../tasks/types.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem } from "../work-items/io.js";

export interface TaskTraceResult {
  work_item_id: string;
  tasks: TaskFileV2[];
  formatted: string;
}

export function devTaskTrace(
  workItemId: string,
  options: { taskId?: number; openOnly?: boolean } = {},
): Result<TaskTraceResult> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);
  const ids =
    options.taskId !== undefined
      ? [options.taskId]
      : [...(wi.task_ids ?? [])].sort((left, right) => left - right);
  if (ids.length === 0) return err(`Work item ${workItemId} has no task files yet.`);

  const tasks: TaskFileV2[] = [];
  const sections: string[] = [];
  for (const taskId of ids) {
    const loaded = loadTaskResult(workItemId, taskId);
    if (loaded.kind === "missing") {
      if (options.taskId !== undefined) {
        return err(`Task ${String(taskId)} not found on ${workItemId}.`);
      }
      continue;
    }
    if (loaded.kind === "legacy") {
      sections.push(legacyTaskFileMessage(workItemId, taskId));
      continue;
    }
    if (options.openOnly && loaded.task.control.status === "done") continue;
    tasks.push(loaded.task);
    sections.push(renderTaskTrace(loaded.task, { openOnly: options.openOnly }));
  }
  const formatted = sections.length
    ? sections.join("\n\n---\n\n")
    : `${workItemId}: no ${options.openOnly ? "open " : ""}tasks to show.`;
  return ok({ work_item_id: workItemId, tasks, formatted });
}

/** `/dev trace <ID> [--task n] [--open]` argument parsing. */
export function parseTraceArgs(tokens: string[]): {
  workItemId?: string;
  taskId?: number;
  openOnly: boolean;
  error?: string;
} {
  const out: { workItemId?: string; taskId?: number; openOnly: boolean; error?: string } = {
    openOnly: false,
  };
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--open") out.openOnly = true;
    else if (token === "--task") {
      const value = Number.parseInt(tokens[index + 1] ?? "", 10);
      if (!Number.isFinite(value)) out.error = "--task needs a number.";
      else out.taskId = value;
      index += 1;
    } else positional.push(token);
  }
  if (positional[0]) out.workItemId = positional[0];
  if (positional[1] !== undefined && out.taskId === undefined) {
    const value = Number.parseInt(positional[1], 10);
    if (Number.isFinite(value)) out.taskId = value;
  }
  return out;
}
