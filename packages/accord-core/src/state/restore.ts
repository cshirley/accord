import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../types/result.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { readJson, writeJson } from "../work-items/io.js";
import { taskJsonPath, workItemJsonPath } from "../work-items/tasks-dir.js";

export interface RestoreStateResult {
  restored: boolean;
  task_ids: number[];
}

/**
 * Rebuilds `.tasks/<ID>.json` and `.tasks/<ID>-task-<N>.json` from the committed
 * `docs/dev/<ID>/state/` snapshot. Never overwrites an existing live file.
 */
export function restoreStateFromTree(
  workItemId: string,
  cwd: string = process.cwd(),
): Result<RestoreStateResult> {
  const stateDir = join(cwd, devArtifactDirRel(workItemId), "state");
  if (!existsSync(stateDir)) return ok({ restored: false, task_ids: [] });

  let restored = false;
  const taskIds: number[] = [];
  try {
    const workItemSnapshot = readJson<Record<string, unknown>>(join(stateDir, "work-item.json"));
    const workItemPath = workItemJsonPath(workItemId, cwd);
    if (workItemSnapshot && !existsSync(workItemPath)) {
      writeJson(workItemPath, workItemSnapshot);
      restored = true;
    }
    for (const entry of readdirSync(stateDir, { withFileTypes: true })) {
      const match = entry.isDirectory() ? /^task-(\d+)$/.exec(entry.name) : null;
      if (!match) continue;
      const taskId = Number(match[1]);
      const snapshot = readJson<Record<string, unknown>>(join(stateDir, entry.name, "task.json"));
      if (!snapshot) continue;
      const taskPath = taskJsonPath(workItemId, taskId, cwd);
      if (!existsSync(taskPath)) {
        writeJson(taskPath, snapshot);
        restored = true;
      }
      taskIds.push(taskId);
    }
  } catch (error) {
    return err(`restore state for ${workItemId}: ${(error as Error).message}`);
  }
  return ok({ restored, task_ids: taskIds.sort((a, b) => a - b) });
}
