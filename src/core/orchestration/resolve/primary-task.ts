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
import { RESUMABLE_PIPELINE_TASK_PHASES } from "../../types/phases.js";
import { loadTaskFile, loadWorkItem } from "../../work-items/io.js";
import type { WorkItemPattern } from "../../work-items/types.js";

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
  const primaryTaskId = wi.task_ids[0] ?? 1;
  const task = loadTaskFile(workItemId, String(primaryTaskId));
  if (!task || task.status === "blocked") {
    return null;
  }
  const phase = task.phase;
  if (typeof phase !== "string" || !RESUMABLE_PIPELINE_TASK_PHASES.has(phase)) {
    return null;
  }
  if (!getAgentMeta(phase)) {
    return null;
  }
  return phase;
}
