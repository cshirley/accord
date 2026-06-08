/**
 * Persist `owner_nonce` on the per-task file before phase-test / phase-code spawn
 * so brief payloads and on-disk state cannot drift.
 */

import * as path from "node:path";
import {
  planTaskPipelineProfile,
  type PlanTaskStep,
} from "../plan/task-pipeline-profile.js";
import { err, ok, type Result } from "../types/result.js";
import { readJson, workItemJsonPath, taskJsonPath, writeJson } from "../work-items/io.js";
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
}): Record<string, unknown> {
  const profile = planTaskPipelineProfile(input.planTaskSteps);
  if (input.dispatchAgent === "phase-test") {
    return {
      schema_version: "1.0",
      work_item_id: input.workItemId,
      task_id: input.taskId,
      owner_nonce: input.ownerNonce,
      phase: profile.initialPhase,
      status: "pending",
      pre_impl_gates: profile.preImplGates,
      test_files: [],
      events: [],
    };
  }

  return {
    schema_version: "1.0",
    work_item_id: input.workItemId,
    task_id: input.taskId,
    owner_nonce: input.ownerNonce,
    phase: "phase-code",
    status: "pending",
    pre_impl_gates: "complete",
    test_files: [],
    events: [],
  };
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
  const onDisk =
    taskFile && typeof taskFile.owner_nonce === "string" ? taskFile.owner_nonce : "";

  if (isValidOwnerNonce(onDisk) && onDisk !== input.ownerNonce) {
    return err(
      `owner_nonce drift on ${taskFilePath}: per-task file has ${onDisk}, spawn brief assigned ${input.ownerNonce}. Re-run dev_code_brief or /dev resume.`,
    );
  }

  const needsWrite = input.minted || taskFile === null;

  if (needsWrite) {
    const next = taskFile
      ? { ...taskFile, owner_nonce: input.ownerNonce }
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
  const verifyNonce =
    verify && typeof verify.owner_nonce === "string" ? verify.owner_nonce : "";
  if (verifyNonce !== input.ownerNonce) {
    return err(
      `owner_nonce drift on ${taskFilePath}: expected ${input.ownerNonce} after sync, found ${verifyNonce || "(missing)"}`,
    );
  }

  return ok({ ownerNonce: input.ownerNonce, taskFilePath });
}
