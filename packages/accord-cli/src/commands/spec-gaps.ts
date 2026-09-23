import { devSpecGaps } from "@clive.shirley/accord-core/queries/spec-gaps.js";

export function runSpecGapsCommand(workItemId: string, options: { json?: boolean }): number {
  const result = devSpecGaps(workItemId);
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
    return 0;
  }

  console.log(result.value.formatted);
  return 0;
}
