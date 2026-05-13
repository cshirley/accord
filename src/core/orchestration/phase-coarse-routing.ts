/**
 * Map persisted work-item **coarse** phases to canonical subagent ids for resume.
 * When `phase` is already a registry agent name, it passes through unchanged
 * (handled by the caller).
 */

import { getAgentMeta } from "../agents/registry.js";
import type { WorkItemPattern } from "../work-items/types.js";

const PATTERNS: WorkItemPattern[] = ["implement", "quick_fix", "investigate", "infra", "analyse"];

/** Coarse WI phases → agent ids (used by graph validation). */
const COARSE_PHASE_TO_AGENT: Record<string, string> = {
  aligning: "phase-align",
  speccing: "phase-spec",
  planning: "phase-plan",
  gathering: "phase-gather",
  exploring: "phase-explore",
};

/** Distinct agent ids referenced by coarse resume routing (registry-checked). */
export const COARSE_RESUME_AGENT_IDS: readonly string[] = Array.from(
  new Set(Object.values(COARSE_PHASE_TO_AGENT)),
);

export function isWorkItemPattern(value: string): value is WorkItemPattern {
  return (PATTERNS as readonly string[]).includes(value);
}

/**
 * Returns a registry agent id to spawn, or `null` when the harness should
 * forward to the accord skill (ambiguous or not yet modelled).
 *
 * `implementing` / `fixing` return `null` here; `resolve/resume.ts` then uses
 * `resolvePrimaryTaskResumeAgentId` (`resolve/primary-task.ts`) from the primary task file.
 */
export function resolveResumeAgentId(phase: string, pattern: WorkItemPattern): string | null {
  if (getAgentMeta(phase)) return phase;

  if (phase === "implementing" || phase === "fixing") {
    return null;
  }

  const coarse = COARSE_PHASE_TO_AGENT[phase];
  if (coarse) return coarse;

  if (phase === "researching" && pattern === "analyse") {
    return "phase-gather";
  }

  return null;
}
