/**
 * Unified primary-task resume resolver.
 *
 * When the work item is on a coarse pipeline phase (`fixing` for quick_fix,
 * `implementing` for implement), the next harness subagent comes from the
 * primary task file `phase` field — provided it's in
 * `RESUMABLE_PIPELINE_TASK_PHASES` and the agent is in the registry.
 *
 * Replaces the older per-pattern resolvers (`resolveQuickFixResumeAgentId`,
 * `resolveImplementResumeAgentId`).
 */

import { getAgentMeta } from "../../agents/registry.js";
import { isResumablePipelineTaskPhase } from "../../types/phases.js";
import { loadTaskFile, loadWorkItem } from "../../work-items/io.js";
import type { WorkItemPattern } from "../../work-items/types.js";
import { resolveActivePrimaryTaskId } from "../post-result/primary-task.js";

/** Coarse pipeline phases that defer routing to the primary task file. */
const PRIMARY_TASK_COARSE_PHASES: Readonly<Record<WorkItemPattern, string | null>> = {
  quick_fix: "fixing",
  implement: "implementing",
  investigate: null,
  infra: null,
  analyse: null,
};

/**
 * @returns The harness subagent id to resume, or `null` when the work item
 * isn't on a primary-task coarse phase or the per-task phase is non-resumable.
 */
export function resolvePrimaryTaskResumeAgentId(workItemId: string): string | null {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return null;
  }
  const coarseGate = PRIMARY_TASK_COARSE_PHASES[wi.pattern];
  if (!coarseGate || wi.phase !== coarseGate) {
    return null;
  }
  const primaryTaskId = resolveActivePrimaryTaskId(wi);
  if (primaryTaskId === null) {
    return null;
  }
  const task = loadTaskFile(workItemId, String(primaryTaskId));
  if (!task || task.status === "blocked" || task.status === "done") {
    return null;
  }
  let phase = task.phase;
  if (typeof phase !== "string" || !isResumablePipelineTaskPhase(phase)) {
    return null;
  }

  // Mandatory pre-impl review: never spawn phase-code until review-test has completed.
  if (phase === "phase-code" && task.pre_impl_gates !== "complete") {
    phase = "review-test";
  }

  if (!getAgentMeta(phase)) {
    return null;
  }
  return phase;
}
