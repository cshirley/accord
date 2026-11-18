/**
 * Format a {@link SubagentResponseContract} appendix for outbound task text.
 */

import { formatResponseContractAppendix } from "../agents/response-contract.js";
import type { SubagentResponseContract } from "../types/subagent-spawn.js";

// One formatter for every backend (pi and exec): schemas and examples are injected minified.
export { formatResponseContractAppendix };

/** Build full outbound task text with optional response contract appendix. */
export function buildOutboundTaskText(task: string, response?: SubagentResponseContract): string {
  const base = task.trim();
  if (!response) return base;
  return base + formatResponseContractAppendix(response);
}
