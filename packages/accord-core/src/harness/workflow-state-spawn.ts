/**
 * Orchestrator-owned workflow state before subagent spawn.
 */

import {
  NONCE_SYNC_SPAWN_AGENTS,
  resolveOwnerNonce,
  syncTaskFileOwnerNonceForSpawn,
} from "../briefing/sync-task-owner-nonce.js";
import { sliceTaskRequirements } from "../briefing/task-requirements.js";
import type { DevHarnessConfig } from "../config/index.js";
import { markTaskAgentSpawned, TASK_PIPELINE_AGENTS } from "../orchestration/task-agent-audit.js";
import { extractTaskIdFromTaskText, extractWorkItemId } from "../telemetry/usage.js";

function extractOwnerNonceFromTaskText(task: string): string | null {
  const match =
    task.match(/\*\*owner_nonce:\*\*\s*([0-9a-f]{6})/i) ??
    task.match(/(?:^|\n)owner_nonce:\s*([0-9a-f]{6})/i);
  return match?.[1] ?? null;
}

/**
 * Ensure per-task nonce alignment and pin `control.in_flight` (status `in_progress`) before
 * task-pipeline spawns.
 * Idempotent when `buildImplementSpawnTaskBrief` already synced the file.
 */
export function prepareWorkflowStateBeforeSpawn(input: {
  agent: string;
  task: string;
  devConfig: DevHarnessConfig | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!TASK_PIPELINE_AGENTS.has(input.agent)) {
    return { ok: true };
  }
  const workItemId = extractWorkItemId(input.task, { mustExist: true });
  if (!workItemId) {
    return { ok: true };
  }
  if (!NONCE_SYNC_SPAWN_AGENTS.has(input.agent)) {
    // Reviewers / verify: record the run we are about to start (crash recovery).
    const taskId = extractTaskIdFromTaskText(input.task);
    markTaskAgentSpawned(workItemId, input.agent, taskId ?? undefined);
    return { ok: true };
  }

  const dispatchAgent = input.agent as "phase-test" | "phase-code";

  const taskId = extractTaskIdFromTaskText(input.task);
  if (taskId === null) {
    const sliced = sliceTaskRequirements(workItemId, 1, input.devConfig, {
      syncBeforeSpawn: { dispatchAgent },
    });
    if (!sliced.ok) {
      return { ok: false, reason: sliced.error };
    }
    markTaskAgentSpawned(workItemId, input.agent, sliced.value.task_id);
    return { ok: true };
  }

  const rawNonce = extractOwnerNonceFromTaskText(input.task) ?? "";
  const { ownerNonce, minted } = resolveOwnerNonce(rawNonce);
  const sync = syncTaskFileOwnerNonceForSpawn({
    workItemId,
    taskId,
    ownerNonce,
    minted,
    dispatchAgent,
  });
  if (!sync.ok) {
    return { ok: false, reason: sync.error };
  }

  markTaskAgentSpawned(workItemId, input.agent, taskId);
  return { ok: true };
}
