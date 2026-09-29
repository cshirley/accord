/**
 * `accord task reseed <ID> [--task n] [--from test|code]` — replace a v1 (or broken) task file
 * with a fresh v2 file seeded from the plan. The old file is archived under `.tasks/archive/`.
 * Code already in git is untouched; loop history and counters reset.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { devNonce } from "../briefing/nonce.js";
import { seedTaskFromDisk } from "../tasks/seed.js";
import { loadTaskResult, writeTaskV2 } from "../tasks/store.js";
import type { TaskPipelinePhase } from "../tasks/types.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, now, readJson, taskLockPath, withJsonFileLock } from "../work-items/io.js";

export interface TaskReseedResult {
  work_item_id: string;
  reseeded: Array<{ task_id: number; archived?: string; phase: string }>;
  formatted: string;
}

export function reseedTask(
  workItemId: string,
  options: { taskId?: number; from?: "test" | "code"; onlyLegacy?: boolean } = {},
): Result<TaskReseedResult> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);
  const ids = options.taskId !== undefined ? [options.taskId] : [...(wi.task_ids ?? [])];
  const reseeded: TaskReseedResult["reseeded"] = [];

  for (const taskId of ids) {
    const loaded = loadTaskResult(workItemId, taskId);
    if (options.onlyLegacy !== false && options.taskId === undefined && loaded.kind !== "legacy") {
      continue;
    }
    const previous =
      loaded.kind === "missing" ? null : readJson<Record<string, unknown>>(loaded.path);
    const previousNonce =
      (previous?.control as { owner_nonce?: unknown } | undefined)?.owner_nonce ??
      previous?.owner_nonce;
    const ownerNonce =
      typeof previousNonce === "string" && /^[0-9a-f]{6}$/.test(previousNonce)
        ? previousNonce
        : devNonce();
    const initialPhase: TaskPipelinePhase | undefined =
      options.from === "code" ? "phase-code" : options.from === "test" ? "phase-test" : undefined;

    const result = withJsonFileLock(taskLockPath(workItemId), () => {
      let archived: string | undefined;
      if (loaded.kind !== "missing") {
        const archiveDir = path.join(path.dirname(loaded.path), "archive");
        fs.mkdirSync(archiveDir, { recursive: true });
        archived = path.join(
          archiveDir,
          `${path.basename(loaded.path, ".json")}.${now().replace(/[:.]/g, "-")}.json`,
        );
        fs.copyFileSync(loaded.path, archived);
      }
      const task = seedTaskFromDisk({
        workItemId,
        taskId,
        ownerNonce,
        ...(initialPhase
          ? {
              initialPhase,
              preImplGates:
                initialPhase === "phase-code" ? ("complete" as const) : ("pending" as const),
            }
          : {}),
      });
      writeTaskV2(task);
      return { task_id: taskId, ...(archived ? { archived } : {}), phase: task.control.phase };
    });
    reseeded.push(result);
  }

  const formatted = reseeded.length
    ? [
        `${workItemId}: re-seeded ${String(reseeded.length)} task file(s).`,
        ...reseeded.map(
          (entry) =>
            `  task ${String(entry.task_id)} → ${entry.phase}${entry.archived ? ` (old file archived: ${entry.archived})` : ""}`,
        ),
        "",
        `Run \`accord resume ${workItemId}\` to continue.`,
      ].join("\n")
    : `${workItemId}: no v1 task files to re-seed (pass --task n to force one).`;
  return ok({ work_item_id: workItemId, reseeded, formatted });
}
