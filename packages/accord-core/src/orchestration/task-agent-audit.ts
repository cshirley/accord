/**
 * Agent-run audit for the v2 task file: in-flight protocol + raw packet sidecars.
 *
 * Write protocol per task-pipeline agent run (see plan §3.6):
 * 1. before spawn  — `markTaskAgentSpawned`   → `control.in_flight {stage: spawned}`
 * 2. on return     — `recordTaskAgentReturn`  → sidecar `<round>-<agent>.json`, stage `returned`
 * 3. post-result   — handler appends the log entry, mutates facts, clears `in_flight`
 * 4. finalize      — `finalizeTaskAgentReturn` logs returns no handler applied (stuck, …)
 *
 * Recovery re-runs step 3 from the sidecar when a crash left `in_flight.stage = returned`.
 */

import {
  extractAnalysisFromSubagentResult,
  extractReturnPacketFromSubagentResult,
} from "../subagent/result/packet.js";
import { hasLogRef } from "../tasks/model.js";
import { clearInFlight, markReturned, markSpawned, recordGeneric } from "../tasks/record.js";
import { mutateTaskV2, sidecarName, writeTaskSidecar } from "../tasks/store.js";
import { loadWorkItem } from "../work-items/io.js";
import { resolvePrimaryTaskIdForMutation } from "./post-result/primary-task.js";

/** Agents whose runs are tracked on the per-task file. */
export const TASK_PIPELINE_AGENTS: ReadonlySet<string> = new Set([
  "phase-test",
  "review-test",
  "phase-code",
  "review-security",
  "review-code",
  "phase-verify-task",
]);

export const ADVERSARIAL_REVIEW_AGENTS: ReadonlySet<string> = new Set([
  "review-test",
  "review-code",
  "review-security",
]);

function onPipelinePhase(workItemId: string): number | null {
  const wi = loadWorkItem(workItemId);
  if (!wi) return null;
  const onPipeline =
    (wi.pattern === "implement" && wi.phase === "implementing") ||
    (wi.pattern === "quick_fix" && wi.phase === "fixing");
  return onPipeline ? resolvePrimaryTaskIdForMutation(wi) : null;
}

/** Before spawn: pin the run's ref on `control.in_flight`. Returns the ref or null. */
export function markTaskAgentSpawned(
  workItemId: string,
  agent: string,
  taskId?: number,
): string | null {
  if (!TASK_PIPELINE_AGENTS.has(agent)) return null;
  const resolvedTaskId = taskId ?? onPipelinePhase(workItemId);
  if (resolvedTaskId === null) return null;
  let ref: string | null = null;
  mutateTaskV2(workItemId, resolvedTaskId, (task, at) => {
    ref = markSpawned(task, agent, at);
    return true;
  });
  return ref;
}

/**
 * On return (before post-result): write the raw packet sidecar and mark `in_flight` returned.
 * Returns the ref or null when the agent/work item is not on the task pipeline.
 */
export function recordTaskAgentReturn(
  workItemId: string,
  agent: string,
  packet: unknown,
  analysis?: string,
): string | null {
  if (!TASK_PIPELINE_AGENTS.has(agent)) return null;
  const taskId = onPipelinePhase(workItemId);
  if (taskId === null) return null;
  let ref: string | null = null;
  mutateTaskV2(workItemId, taskId, (task, at) => {
    const pinned = markReturned(task, agent, at);
    ref = pinned;
    writeTaskSidecar(
      workItemId,
      taskId,
      sidecarName(pinned, "json"),
      `${JSON.stringify({ agent, ref: pinned, at, packet, ...(analysis ? { analysis } : {}) }, null, 2)}\n`,
    );
    return true;
  });
  return ref;
}

/**
 * After the post-result handler: when the handler did not record this return (stuck packet,
 * guard no-op), log it generically and release `in_flight` so resume can proceed.
 */
export function finalizeTaskAgentReturn(
  workItemId: string,
  agent: string,
  packet: unknown,
  analysis?: string,
): void {
  if (!TASK_PIPELINE_AGENTS.has(agent)) return;
  const taskId = onPipelinePhase(workItemId);
  if (taskId === null) return;
  mutateTaskV2(workItemId, taskId, (task, at) => {
    const inFlight = task.control.in_flight;
    if (!inFlight || inFlight.agent !== agent) return false;
    if (!hasLogRef(task, inFlight.ref)) {
      const record =
        packet && typeof packet === "object" ? (packet as Record<string, unknown>) : {};
      recordGeneric(task, inFlight.ref, record, at, { analysis });
    }
    clearInFlight(task, agent);
    if (task.control.status === "in_progress") task.control.status = "pending";
    return true;
  });
}

/** Extract analysis + packet from a raw subagent tool result row. */
export function extractSubagentReturnAudit(result: unknown): {
  packet: Record<string, unknown> | null;
  analysisText?: string;
} {
  const packet = extractReturnPacketFromSubagentResult(result);
  const analysisText = extractAnalysisFromSubagentResult(result);
  return {
    packet,
    ...(analysisText ? { analysisText } : {}),
  };
}
