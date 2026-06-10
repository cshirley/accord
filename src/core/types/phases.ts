/**
 * Canonical phase identifiers used across the orchestration runner,
 * post-result handlers, and the agent registry. Kept distinct from
 * `WorkItem.phase` (coarse) and per-task `phase` (per-agent step).
 */

/**
 * Per-task `phase` values that map 1:1 to harness subagent registry ids for resume
 * (`implement` / `quick_fix` coarse phases that defer to the primary task file).
 */
export const RESUMABLE_PIPELINE_TASK_PHASES: ReadonlySet<string> = new Set([
  "phase-test",
  "review-test",
  "phase-code",
  "review-code",
  "phase-verify-code",
  "phase-verify-task",
  "phase-verify-acceptance",
]);

export function isResumablePipelineTaskPhase(value: string): boolean {
  return RESUMABLE_PIPELINE_TASK_PHASES.has(value);
}
