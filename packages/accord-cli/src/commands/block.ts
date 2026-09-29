import { blockTask } from "@clive.shirley/accord-core/queries/block-task.js";

export function runBlockCommand(
  workItemId: string,
  rawArgs: string,
  options: { json?: boolean },
): number {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  const taskRaw = tokens[0];
  const taskId = taskRaw ? Number.parseInt(taskRaw, 10) : Number.NaN;
  if (!taskRaw || !Number.isFinite(taskId)) {
    console.error(
      `Usage: accord block ${workItemId} <task_id> <reason...> \u2014 task_id must be a number.`,
    );
    return 1;
  }
  const reason = tokens.slice(1).join(" ");

  const result = blockTask(workItemId, taskId, reason);
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value.formatted);
  }

  return 0;
}
