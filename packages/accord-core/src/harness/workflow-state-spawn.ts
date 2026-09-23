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
import { extractTaskIdFromTaskText, extractWorkItemId } from "../telemetry/usage.js";
import { readJson, taskJsonPath, writeJson } from "../work-items/io.js";

function extractOwnerNonceFromTaskText(task: string): string | null {
  const match =
    task.match(/\*\*owner_nonce:\*\*\s*([0-9a-f]{6})/i) ??
    task.match(/(?:^|\n)owner_nonce:\s*([0-9a-f]{6})/i);
  return match?.[1] ?? null;
}

function markTaskInProgress(workItemId: string, taskId: number): void {
  const taskPath = taskJsonPath(workItemId, String(taskId));
  const task = readJson<Record<string, unknown>>(taskPath);
  if (!task) {
    return;
  }
  task.status = "in_progress";
  writeJson(taskPath, task);
}

/**
 * Ensure per-task nonce alignment and `in_progress` status before implement spawns.
 * Idempotent when `buildImplementSpawnTaskBrief` already synced the file.
 */
export function prepareWorkflowStateBeforeSpawn(input: {
  agent: string;
  task: string;
  devConfig: DevHarnessConfig | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!NONCE_SYNC_SPAWN_AGENTS.has(input.agent)) {
    return { ok: true };
  }

  const dispatchAgent = input.agent as "phase-test" | "phase-code";
  const workItemId = extractWorkItemId(input.task, { mustExist: true });
  if (!workItemId) {
    return { ok: true };
  }

  const taskId = extractTaskIdFromTaskText(input.task);
  if (taskId === null) {
    const sliced = sliceTaskRequirements(workItemId, 1, input.devConfig, {
      syncBeforeSpawn: { dispatchAgent },
    });
    if (!sliced.ok) {
      return { ok: false, reason: sliced.error };
    }
    markTaskInProgress(workItemId, sliced.value.task_id);
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

  markTaskInProgress(workItemId, taskId);
  return { ok: true };
}
