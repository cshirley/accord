import { devTaskTrace, parseTraceArgs } from "@clive.shirley/accord-core/queries/task-trace.js";

export function runTraceCommand(
  workItemId: string,
  args: string[],
  options: { json?: boolean },
): number {
  const parsed = parseTraceArgs([workItemId, ...args]);
  if (parsed.error) {
    console.error(`${parsed.error}\nUsage: accord trace ${workItemId} [--task n] [--open]`);
    return 1;
  }
  const result = devTaskTrace(workItemId, {
    ...(parsed.taskId !== undefined ? { taskId: parsed.taskId } : {}),
    openOnly: parsed.openOnly,
  });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  if (options.json) {
    console.log(JSON.stringify(result.value.tasks, null, 2));
  } else {
    console.log(result.value.formatted);
  }
  return 0;
}
