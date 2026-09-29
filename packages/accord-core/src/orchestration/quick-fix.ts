/**
 * Quick-fix orchestration helpers — severity-gate predicate and the pre-impl review-test brief.
 *
 * Loop counters and decisions live on the v2 task file (`src/tasks/decide.ts`); post-result
 * side-effects live in `post-result/*.ts`.
 */

import { buildImplementSpawnTaskBrief } from "../briefing/task-requirements.js";
import type { DevHarnessConfig } from "../config/types.js";
import type { PolicySeverityGate } from "./policy.js";
import { findingsTriggerReviewRetry } from "./policy.js";

export { RESUMABLE_PIPELINE_TASK_PHASES } from "../types/phases.js";
export { findingsTriggerReviewRetry, maxFindingSeverityRank } from "./policy.js";
export type { ReviewTestVerdict } from "./review-feedback.js";

/**
 * When `review-test` verdict is `issues`, only findings at or above `severityGate`
 * consume a quick-fix retry slot (see `QuickFixLoopPolicy.severityGate`).
 */
export function reviewIssuesConsumeQuickFixRetrySlot(
  findings: ReadonlyArray<{ severity?: string }>,
  gate: PolicySeverityGate,
): boolean {
  return findingsTriggerReviewRetry(findings, gate);
}

/**
 * Rich `review-test` task body for **quick_fix** or **implement** pre-impl (after `phase-test` wrote `test_files`).
 * Returns `null` when stubs or `test_files` are missing — caller should fall back to a generic resume brief.
 */
export function buildQuickFixPreImplReviewTestBrief(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
  devConfig?: DevHarnessConfig | null;
}): string | null {
  if (input.dispatchAgent !== "review-test") {
    return null;
  }
  const brief = buildImplementSpawnTaskBrief({
    workItemId: input.workItemId,
    dispatchAgent: input.dispatchAgent,
    phase: input.phase,
    title: input.title,
    pattern: input.pattern,
    variant: input.variant,
    devConfig: input.devConfig ?? null,
  });
  if (!brief.ok) {
    return null;
  }
  return brief.value;
}
