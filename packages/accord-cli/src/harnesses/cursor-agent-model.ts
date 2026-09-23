/**
 * Map resolved subagent model + thinking to Cursor Agent CLI `--model` value.
 *
 * Agent markdown frontmatter (`tier`, `model`, `thinking`) is resolved via
 * `subagent.json` profiles before this formatter runs. Frontmatter is control
 * plane only — never passed as CLI flags or prompt text.
 */

import type { ResolvedModel, ThinkingLevel } from "@clive.shirley/accord-core/agents/types.js";

const THINKING_SUFFIX_PATTERN = /-thinking-(minimal|low|medium|high|xhigh|max)$/;

function stripProviderPrefix(model: string): string {
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(slash + 1) : model;
}

function mapThinkingToBracketEffort(thinking: ThinkingLevel): string {
  if (thinking === "xhigh" || thinking === "max") return "high";
  if (thinking === "minimal") return "low";
  return thinking;
}

/** Format a resolved spawn model for `agent --model`. */
export function formatCursorAgentCliModel(resolved: ResolvedModel): string {
  let model = stripProviderPrefix(resolved.model);
  const thinking = resolved.thinking;
  if (!thinking || thinking === "off") {
    return model;
  }
  if (model.includes("[")) {
    return model;
  }
  if (THINKING_SUFFIX_PATTERN.test(model)) {
    return model;
  }
  if (model.endsWith("-thinking")) {
    if (thinking === "high" || thinking === "medium") {
      return model;
    }
    return `${model}-${thinking}`;
  }
  if (resolved.thinkingMode === "reasoning_effort" || /^gpt-/i.test(model)) {
    return `${model}[effort=${mapThinkingToBracketEffort(thinking)}]`;
  }
  if (/^claude-/i.test(model) && (thinking === "high" || thinking === "xhigh" || thinking === "max")) {
    const base = model.replace(/-thinking(?:-.*)?$/, "");
    const level = thinking === "max" ? "xhigh" : thinking;
    return `${base}-thinking-${level}`;
  }
  if (thinking !== "medium") {
    return `${model}[effort=${mapThinkingToBracketEffort(thinking)}]`;
  }
  return model;
}
