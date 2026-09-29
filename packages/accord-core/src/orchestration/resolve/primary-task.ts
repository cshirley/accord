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
import { loadTaskV2 } from "../../tasks/store.js";
import { isResumablePipelineTaskPhase } from "../../types/phases.js";
import {
  artifactFileName,
  artifactLooksComplete,
  bootstrapImplementTasksFromPlan,
  reconcileVerifyOnlyTasksFromPlan,
  resolveArtifactPath,
  resolveDevArtifactPathForId,
} from "../../work-items/artifact-discovery.js";
import { loadWorkItem } from "../../work-items/io.js";
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
 * Blocked tasks (retry cap hit, RGR cap, runner crash, `/dev block`) on a primary-task coarse
 * phase. A blocked task must halt the work item: skipping it lets resume run later tasks built
 * on it, and "all tasks done or blocked" used to read as ready-for-finish, so `accord drive
 * --finish` would ship past a cap that was supposed to stop the loop.
 *
 * @returns Human-readable block message, or `null` when no task is blocked.
 */
export function describeBlockedPrimaryTasks(workItemId: string): string | null {
  const wi = loadWorkItem(workItemId);
  if (!wi) return null;
  const coarseGate = PRIMARY_TASK_COARSE_PHASES[wi.pattern];
  if (!coarseGate || wi.phase !== coarseGate) return null;

  const sorted = [...(wi.task_ids ?? [])].sort((a, b) => a - b);
  const blocked: string[] = [];
  for (const taskId of sorted.length > 0 ? sorted : [1]) {
    const task = loadTaskV2(workItemId, String(taskId));
    if (task?.control.status !== "blocked") continue;
    const reason = task.control.blocked?.reason ?? task.summary.next.why;
    const blockers = task.summary.blockers.map((b) => b.finding);
    blocked.push(
      `- task ${String(taskId)} (phase \`${task.control.phase}\`, round ${task.control.round})${reason ? `: ${reason}` : ""}${blockers.length ? ` — blockers ${blockers.join(", ")}` : ""}`,
    );
  }
  if (blocked.length === 0) return null;

  return [
    `Work item ${workItemId} is halted: ${String(blocked.length)} task(s) **blocked**.`,
    "",
    ...blocked,
    "",
    `Read the task file \`summary\` (or \`accord trace ${workItemId}\`), decide each blocker, then \`accord unblock ${workItemId} --task <n> [--note|--fixed|--accept|--waive F-n "reason"]\` and resume.`,
  ].join("\n");
}

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
  const task = loadTaskV2(workItemId, String(primaryTaskId));
  if (!task || task.control.status === "blocked" || task.control.status === "done") {
    return null;
  }
  let phase: string = task.control.phase;
  if (!isResumablePipelineTaskPhase(phase)) {
    return null;
  }

  // Mandatory pre-impl review: never spawn phase-code until review-test has completed.
  if (phase === "phase-code" && task.control.pre_impl_gates !== "complete") {
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

  const blockedMessage = describeBlockedPrimaryTasks(workItemId);
  if (blockedMessage) {
    return blockedMessage;
  }

  const allDone = sorted.every(
    (taskId) => loadTaskV2(workItemId, String(taskId))?.control.status === "done",
  );
  if (allDone) {
    return [
      `All implementation tasks for ${workItemId} are **done**.`,
      "Run `/dev finish` for acceptance verification.",
    ].join(" ");
  }

  const activeId = resolveActivePrimaryTaskId(wi);
  if (activeId !== null) {
    const task = loadTaskV2(workItemId, String(activeId));
    const phase = task?.control.phase ?? "unknown";
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
