import { reseedTask } from "@clive.shirley/accord-core/queries/task-reseed.js";

export function runTaskReseedCommand(
  workItemId: string,
  args: string[],
  options: { json?: boolean },
): number {
  let taskId: number | undefined;
  let from: "test" | "code" | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--task") {
      taskId = Number.parseInt(args[index + 1] ?? "", 10);
      index += 1;
      if (!Number.isFinite(taskId)) {
        console.error("--task needs a number.");
        return 1;
      }
    } else if (token === "--from") {
      const value = args[index + 1];
      index += 1;
      if (value !== "test" && value !== "code") {
        console.error("--from must be test or code.");
        return 1;
      }
      from = value;
    } else {
      console.error(`Unknown argument: ${token}`);
      return 1;
    }
  }
  const result = reseedTask(workItemId, {
    ...(taskId !== undefined ? { taskId } : {}),
    ...(from ? { from } : {}),
  });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  console.log(options.json ? JSON.stringify(result.value, null, 2) : result.value.formatted);
  return 0;
}
