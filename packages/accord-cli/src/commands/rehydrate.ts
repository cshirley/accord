import { devRehydrateWorkItem } from "@clive.shirley/accord-core/work-items/rehydrate.js";

export function runRehydrateCommand(workItemId: string, options: { json?: boolean }): number {
  const result = devRehydrateWorkItem(workItemId);
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
    return 0;
  }

  console.log(result.value.message);
  return 0;
}
