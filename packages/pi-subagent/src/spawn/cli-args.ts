/**
 * Pi CLI argument helpers for subagent child processes.
 */

import type { ResolvedModel, ThinkingLevel } from "../agents.js";

/** Append `--thinking` / `--reasoning-effort` flags from a resolved spawn model. */
export function appendThinkingCliArgs(
  args: string[],
  modelResolved: ResolvedModel | null,
  fallbackThinking?: ThinkingLevel,
): void {
  if (modelResolved) {
    switch (modelResolved.thinkingMode) {
      case "flag":
        if (modelResolved.thinking) args.push("--thinking", modelResolved.thinking);
        break;
      case "reasoning_effort":
        if (modelResolved.reasoningEffort) {
          args.push("--reasoning-effort", modelResolved.reasoningEffort);
        }
        break;
      case "embedded":
      case "none":
        break;
    }
    return;
  }
  if (fallbackThinking) {
    args.push("--thinking", fallbackThinking);
  }
}
