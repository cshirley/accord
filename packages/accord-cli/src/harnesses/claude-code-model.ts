/**
 * Map resolved subagent model + thinking to Claude Code CLI flags.
 *
 * Frontmatter (`tier`, `model`, `thinking`) resolves through `subagent.json`
 * profiles. Use an Anthropic-direct profile (e.g. `anthropic-direct`) when the
 * exec backend is `claude` — Cursor-shaped model ids are not valid here.
 */

import type { ResolvedModel, ThinkingLevel } from "@clive.shirley/accord-core/agents/types.js";

function stripProviderPrefix(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(slash + 1) : model;
}

function mapReasoningEffortToEffort(
  effort: NonNullable<ResolvedModel["reasoningEffort"]>,
): ThinkingLevel {
  return effort;
}

/** Format `--model` for `claude -p`. */
export function formatClaudeCodeCliModel(resolved: ResolvedModel): string {
  return stripProviderPrefix(resolved.model);
}

/** Format `--effort` for `claude -p` when thinking is configured. */
export function formatClaudeCodeCliEffort(resolved: ResolvedModel): ThinkingLevel | undefined {
  if (resolved.thinking && resolved.thinking !== "off") {
    return resolved.thinking;
  }
  if (resolved.thinkingMode === "reasoning_effort" && resolved.reasoningEffort) {
    return mapReasoningEffortToEffort(resolved.reasoningEffort);
  }
  return undefined;
}
