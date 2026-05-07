import { extractWorkItemId } from "../telemetry/usage.js";
import { loadWorkItem } from "../work-items/io.js";

export function formatIntentContractForTask(task: string): string {
  const workItemId = extractWorkItemId(task);
  if (!workItemId) return "";
  const wi = loadWorkItem(workItemId);
  if (!wi) return "";
  if (!wi.intent_mode && !wi.escalation_ceiling && !wi.target_paths?.length && !wi.out_of_scope?.length && !wi.expected_finish) return "";

  const lines = ["", "", "## Intent Contract (ACCORD)", ""];
  if (wi.intent_mode) lines.push(`- intent_mode: ${wi.intent_mode}`);
  if (wi.escalation_ceiling) lines.push(`- escalation_ceiling: ${wi.escalation_ceiling}`);
  if (wi.target_paths?.length) lines.push(`- target_paths: ${wi.target_paths.join(", ")}`);
  if (wi.out_of_scope?.length) lines.push(`- out_of_scope: ${wi.out_of_scope.join(", ")}`);
  if (wi.expected_finish) lines.push(`- expected_finish: ${wi.expected_finish}`);
  lines.push("", "Do not exceed the escalation ceiling without an explicit user confirmation or pending decision.");
  return lines.join("\n");
}
