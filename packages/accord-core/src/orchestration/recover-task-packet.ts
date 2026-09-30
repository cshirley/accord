/**
 * Recover the task pipeline from the v2 task file's `control.in_flight` state.
 *
 * - `stage: returned` → the return packet was saved to the sidecar but post-result never ran
 *   (crash between receive and apply). Re-apply it; handlers are idempotent by log ref.
 * - `stage: spawned` → the agent never returned (session died, exit without packet). Resume
 *   respawns the same ref (`markSpawned` reuses it) — no round or retry is consumed.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { loadTaskV2, readSidecarPacket } from "../tasks/store.js";
import { loadWorkItem } from "../work-items/io.js";
import { resolvePrimaryTaskIdForMutation } from "./post-result/primary-task.js";
import { runPostResultHandlerForAgent } from "./post-result/registry.js";
import { finalizeTaskAgentReturn, TASK_PIPELINE_AGENTS } from "./task-agent-audit.js";

/** Re-apply a saved-but-unapplied return for the primary task. Returns markdown or `""`. */
export function recoverReturnedInFlight(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
  taskId?: number,
): string {
  const wi = loadWorkItem(workItemId);
  if (!wi) return "";
  const resolvedTaskId = taskId ?? resolvePrimaryTaskIdForMutation(wi);
  const task = loadTaskV2(workItemId, resolvedTaskId);
  const inFlight = task?.control.in_flight;
  if (!task || !inFlight || inFlight.stage !== "returned") return "";
  if (!TASK_PIPELINE_AGENTS.has(inFlight.agent)) return "";
  const saved = readSidecarPacket(workItemId, resolvedTaskId, inFlight.ref);
  if (!saved) return "";
  // Persisted before schema validation and never confirmed valid — do not apply an unchecked
  // packet. Resume respawns the agent under the same ref (`markSpawned` reuses it).
  if (saved.validated === false) return "";

  const post = runPostResultHandlerForAgent(
    inFlight.agent,
    workItemId,
    saved.packet,
    devConfig,
    saved.analysis ? { analysis: saved.analysis } : undefined,
  );
  finalizeTaskAgentReturn(workItemId, inFlight.agent, saved.packet, saved.analysis);
  return [
    "",
    `✓ Recovered **${inFlight.ref}**: return packet was saved but not applied — re-applied from the task sidecar.`,
    post ? post.trimStart() : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Subagent exited 0 without a return packet: recover from a saved packet when one exists,
 * otherwise report that resume will respawn the same run.
 */
export async function tryRecoverMissingReturnPacketFromTaskFile(
  workItemId: string,
  agentName: string,
  taskId: number | null,
  devConfig: DevHarnessConfig | null,
): Promise<string> {
  if (!TASK_PIPELINE_AGENTS.has(agentName) || taskId === null) return "";
  const recovered = recoverReturnedInFlight(workItemId, devConfig, taskId);
  if (recovered) return recovered;
  const task = loadTaskV2(workItemId, taskId);
  const inFlight = task?.control.in_flight;
  if (inFlight?.agent === agentName && inFlight.stage === "spawned") {
    return [
      "",
      `⚠ **${inFlight.ref}** exited without a return packet. \`/dev resume ${workItemId}\` respawns the same run (no retry consumed).`,
    ].join("\n");
  }
  return "";
}
