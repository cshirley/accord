/**
 * Persist `owner_nonce` on the per-task file before phase-test / phase-code spawn
 * so brief payloads and on-disk state cannot drift.
 */

import { type PlanTaskStep, planTaskPipelineProfile } from "../plan/task-pipeline-profile.js";
import { isTaskFileV2 } from "../tasks/model.js";
import { seedTaskFromDisk } from "../tasks/seed.js";
import { legacyTaskFileMessage } from "../tasks/store.js";
import type { TaskFileV2 } from "../tasks/types.js";
import { err, ok, type Result } from "../types/result.js";
import { readJson, taskJsonPath, writeJson } from "../work-items/io.js";
import { devNonce } from "./nonce.js";

const OWNER_NONCE_RE = /^[0-9a-f]{6}$/;

/** Spawn agents that require brief ↔ per-task file nonce alignment before subagent start. */
export const NONCE_SYNC_SPAWN_AGENTS = new Set(["phase-test", "phase-code"]);

export function isValidOwnerNonce(value: string): boolean {
  return OWNER_NONCE_RE.test(value);
}

export function resolveOwnerNonce(raw: string): { ownerNonce: string; minted: boolean } {
  if (isValidOwnerNonce(raw)) {
    return { ownerNonce: raw, minted: false };
  }
  return { ownerNonce: devNonce(), minted: true };
}

function bootstrapTaskFileForSpawn(input: {
  workItemId: string;
  taskId: number;
  ownerNonce: string;
  dispatchAgent: "phase-test" | "phase-code";
  planTaskSteps?: PlanTaskStep[];
}): TaskFileV2 {
  const profile = planTaskPipelineProfile(input.planTaskSteps);
  return seedTaskFromDisk({
    workItemId: input.workItemId,
    taskId: input.taskId,
    ownerNonce: input.ownerNonce,
    ...(input.dispatchAgent === "phase-test"
      ? { initialPhase: profile.initialPhase, preImplGates: profile.preImplGates }
      : { initialPhase: "phase-code" as const, preImplGates: "complete" as const }),
  });
}

function ownerNonceOf(taskFile: Record<string, unknown> | null): string {
  const control = taskFile?.control as { owner_nonce?: unknown } | undefined;
  return typeof control?.owner_nonce === "string" ? control.owner_nonce : "";
}

/**
 * When a new nonce was minted (or the per-task file is missing), write once before spawn.
 * Blocks when a valid on-disk nonce disagrees with the assigned spawn nonce, or when
 * read-back after write does not match.
 */
export function syncTaskFileOwnerNonceForSpawn(input: {
  workItemId: string;
  taskId: number;
  ownerNonce: string;
  minted: boolean;
  dispatchAgent: "phase-test" | "phase-code";
  planTaskSteps?: PlanTaskStep[];
  taskFile?: Record<string, unknown> | null;
}): Result<{ ownerNonce: string; taskFilePath: string }> {
  const taskFilePath = taskJsonPath(input.workItemId, String(input.taskId));
  const taskFile = input.taskFile ?? readJson<Record<string, unknown>>(taskFilePath);
  if (taskFile && !isTaskFileV2(taskFile)) {
    return err(legacyTaskFileMessage(input.workItemId, input.taskId));
  }
  const onDisk = ownerNonceOf(taskFile);

  if (isValidOwnerNonce(onDisk) && onDisk !== input.ownerNonce) {
    return err(
      `owner_nonce drift on ${taskFilePath}: per-task file has ${onDisk}, spawn brief assigned ${input.ownerNonce}. Re-run dev_code_brief or /dev resume.`,
    );
  }

  const needsWrite = input.minted || taskFile === null;

  if (needsWrite) {
    const next = taskFile
      ? {
          ...taskFile,
          control: {
            ...(taskFile.control as unknown as Record<string, unknown>),
            owner_nonce: input.ownerNonce,
          },
        }
      : bootstrapTaskFileForSpawn({
          workItemId: input.workItemId,
          taskId: input.taskId,
          ownerNonce: input.ownerNonce,
          dispatchAgent: input.dispatchAgent,
          planTaskSteps: input.planTaskSteps,
        });
    writeJson(taskFilePath, next);
  }

  const verify = readJson<Record<string, unknown>>(taskFilePath);
  const verifyNonce = ownerNonceOf(verify);
  if (verifyNonce !== input.ownerNonce) {
    return err(
      `owner_nonce drift on ${taskFilePath}: expected ${input.ownerNonce} after sync, found ${verifyNonce || "(missing)"}`,
    );
  }

  return ok({ ownerNonce: input.ownerNonce, taskFilePath });
}
