import { runAnswer } from "@clive.shirley/accord-core/queries/answer-decision.js";

/** `accord answer <ID> [<decision-id> "answer"]… [--force]` — no answers lists pending decisions. */
export function runAnswerCommand(
  workItemId: string,
  args: string[],
  options: { json?: boolean },
): number {
  const result = runAnswer([workItemId, ...args]);
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value.value, null, 2));
  } else {
    console.log(result.value.value.formatted);
  }

  return 0;
}
