import { unblockTask } from "@clive.shirley/accord-core/queries/unblock-task.js";

export function runUnblockCommand(
  workItemId: string,
  rawArgs: string,
  options: { json?: boolean },
): number {
  const taskRaw = rawArgs.trim().split(/\s+/)[0];
  const taskId = taskRaw ? Number.parseInt(taskRaw, 10) : undefined;
  if (taskRaw && !Number.isFinite(taskId)) {
    console.error(`Usage: accord unblock ${workItemId} [task_id] \u2014 task_id must be a number.`);
    return 1;
  }

  const result = unblockTask(workItemId, taskId);
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value.formatted);
  }

  return result.value.unblocked.length > 0 ? 0 : 1;
}
