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
import {
  artifactFileName,
  artifactLooksComplete,
  bootstrapImplementTasksFromPlan,
  reconcileVerifyOnlyTasksFromPlan,
  resolveArtifactPath,
  resolveDevArtifactPathForId,
} from "../../work-items/artifact-discovery.js";
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
  if (wi.pattern === "implement" && wi.phase === "implementing") {
    const planPath = resolvePlanPathForBootstrap(workItemId);
    if (planPath) {
      reconcileVerifyOnlyTasksFromPlan(workItemId, planPath);
    }
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

function resolvePlanPathForBootstrap(workItemId: string): string | null {
  const wi = loadWorkItem(workItemId);
  if (!wi) return null;
  const configured = wi.plan?.trim();
  const planPath = configured
    ? resolveArtifactPath(wi, "plan", artifactFileName("plan"))
    : resolveDevArtifactPathForId(workItemId, "plan");
  return artifactLooksComplete("plan", planPath, workItemId) ? planPath : null;
}

/**
 * Resume routing for coarse `implementing`: use the primary task file, bootstrapping
 * task files from `plan.json` when the work item advanced without task files (e.g.
 * manual phase transition or stale `.tasks/`).
 */
export function resolveImplementingResumeAgentId(workItemId: string): string | null {
  const direct = resolvePrimaryTaskResumeAgentId(workItemId);
  if (direct) {
    return direct;
  }

  const wi = loadWorkItem(workItemId);
  if (wi?.pattern !== "implement" || wi.phase !== "implementing") {
    return null;
  }

  const planPath = resolvePlanPathForBootstrap(workItemId);
  if (!planPath) {
    return null;
  }

  reconcileVerifyOnlyTasksFromPlan(workItemId, planPath);
  const bootstrapped = bootstrapImplementTasksFromPlan(workItemId, planPath);
  if (bootstrapped > 0) {
    return resolvePrimaryTaskResumeAgentId(workItemId);
  }

  const reconciled = reconcileVerifyOnlyTasksFromPlan(workItemId, planPath);
  if (reconciled > 0) {
    return resolvePrimaryTaskResumeAgentId(workItemId);
  }

  return null;
}

/** Actionable blocked message when `implementing` has no resumable primary task. */
export function describeImplementingResumeBlocked(workItemId: string): string | null {
  const wi = loadWorkItem(workItemId);
  if (wi?.pattern !== "implement" || wi.phase !== "implementing") {
    return null;
  }

  const planPath = resolvePlanPathForBootstrap(workItemId);
  if (!planPath) {
    return [
      `Work item ${workItemId} is in **implementing** but has no complete plan on disk.`,
      "Run `/dev plan` (or complete phase-plan) before resuming implementation.",
    ].join(" ");
  }

  const sorted = [...(wi.task_ids ?? [])].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return [
      `Work item ${workItemId} is in **implementing** but has no task files under \`.tasks/\`.`,
      "Run `/dev rehydrate` or re-run phase-plan until task files are bootstrapped, then `/dev resume` again.",
    ].join(" ");
  }

  const allTerminal = sorted.every((taskId) => {
    const task = loadTaskFile(workItemId, String(taskId));
    return task?.status === "done" || task?.status === "blocked";
  });
  if (allTerminal) {
    return [
      `All implementation tasks for ${workItemId} are **done** or **blocked**.`,
      "Run `/dev finish` for acceptance verification, or inspect task files under `.tasks/`.",
    ].join(" ");
  }

  const activeId = resolveActivePrimaryTaskId(wi);
  if (activeId !== null) {
    const task = loadTaskFile(workItemId, String(activeId));
    const phase = typeof task?.phase === "string" ? task.phase : "unknown";
    return [
      `Work item ${workItemId} is in **implementing** but task ${String(activeId)} phase \`${phase}\` is not resumable via /dev resume.`,
      "Update the task file phase or spawn the next pipeline agent from the accord skill.",
    ].join(" ");
  }

  return [
    `Work item ${workItemId} is in **implementing** but no active task could be resolved.`,
    "Check `.tasks/` task files and `plan.json`, or run `/dev rehydrate`.",
  ].join(" ");
}
