/**
 * Task file v2 persistence: load (with legacy detection), locked mutate + refresh, sidecars.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  loadWorkItem,
  now,
  readJson,
  taskJsonPath,
  taskLockPath,
  withJsonFileLock,
  workItemJsonPath,
  writeJson,
} from "../work-items/io.js";
import type { WorkItem } from "../work-items/types.js";
import { isTaskFileV2, refreshTask } from "./model.js";
import type { TaskFileV2 } from "./types.js";

export type TaskLoadResult =
  | { kind: "ok"; task: TaskFileV2; path: string }
  | { kind: "missing"; path: string }
  | { kind: "legacy"; path: string; version: string };

export function loadTaskResult(
  workItemId: string,
  taskId: string | number,
  cwd?: string,
): TaskLoadResult {
  const filePath = taskJsonPath(workItemId, String(taskId), cwd);
  const raw = readJson<Record<string, unknown>>(filePath);
  if (!raw) return { kind: "missing", path: filePath };
  if (!isTaskFileV2(raw)) {
    return {
      kind: "legacy",
      path: filePath,
      version: typeof raw.schema_version === "string" ? raw.schema_version : "unknown",
    };
  }
  return { kind: "ok", task: raw, path: filePath };
}

/** v2 task file or `null` (missing or legacy — see `legacyTaskFileMessage`). */
export function loadTaskV2(
  workItemId: string,
  taskId: string | number,
  cwd?: string,
): TaskFileV2 | null {
  const result = loadTaskResult(workItemId, taskId, cwd);
  return result.kind === "ok" ? result.task : null;
}

export function legacyTaskFileMessage(workItemId: string, taskId: string | number): string {
  return [
    `Task file ${workItemId} task ${String(taskId)} uses the v1 format, which is no longer supported.`,
    `Run \`accord task reseed ${workItemId} --task ${String(taskId)}\` to re-seed it from the plan`,
    "(code already in git is kept; loop history and counters reset).",
  ].join(" ");
}

/** First legacy task file on a work item, if any. */
export function findLegacyTaskFile(workItem: WorkItem): number | null {
  for (const taskId of workItem.task_ids ?? []) {
    if (loadTaskResult(workItem.id, taskId).kind === "legacy") return taskId;
  }
  return null;
}

export function writeTaskV2(task: TaskFileV2, at: string = now(), cwd?: string): void {
  refreshTask(task, at);
  writeJson(taskJsonPath(task.work_item, String(task.task), cwd), task);
}

/**
 * Locked read → mutate → refresh → write for one task file. Returns `false` when the file is
 * missing/legacy or `mutate` returns `false`.
 */
export function mutateTaskV2(
  workItemId: string,
  taskId: string | number,
  mutate: (task: TaskFileV2, at: string) => boolean | undefined,
): boolean {
  return withJsonFileLock(taskLockPath(workItemId), () => {
    const loaded = loadTaskResult(workItemId, taskId);
    if (loaded.kind !== "ok") return false;
    const at = now();
    const result = mutate(loaded.task, at);
    if (result === false) return false;
    refreshTask(loaded.task, at);
    writeJson(loaded.path, loaded.task);
    const wi = loadWorkItem(workItemId);
    if (wi) {
      wi.updated = at;
      writeJson(workItemJsonPath(workItemId), wi);
    }
    return true;
  });
}

// ── Sidecars ────────────────────────────────────────────────────────

/** `.tasks/<ID>-task-<N>/` — write-once raw packets and test/verify output. */
export function taskSidecarDir(workItemId: string, taskId: string | number, cwd?: string): string {
  return taskJsonPath(workItemId, String(taskId), cwd).replace(/\.json$/, "");
}

/** Sidecar file name for a log ref: `T2/phase-test` → `T2-phase-test.<suffix>`. */
export function sidecarName(ref: string, suffix: "json" | "output.txt" | "no-packet.txt"): string {
  return `${ref.replace(/\//g, "-")}.${suffix}`;
}

export function writeTaskSidecar(
  workItemId: string,
  taskId: string | number,
  name: string,
  content: string,
  cwd?: string,
): string {
  const dir = taskSidecarDir(workItemId, taskId, cwd);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  const tmp = `${filePath}.tmp-${String(process.pid)}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
  return filePath;
}

export function readTaskSidecar(
  workItemId: string,
  taskId: string | number,
  name: string,
  cwd?: string,
): string | null {
  try {
    return fs.readFileSync(path.join(taskSidecarDir(workItemId, taskId, cwd), name), "utf8");
  } catch {
    return null;
  }
}

export interface SidecarPacket {
  agent: string;
  ref: string;
  at: string;
  packet: Record<string, unknown>;
  analysis?: string;
  /**
   * `false` while the packet is persisted but not yet schema-validated, or when validation
   * failed. Absent on sidecars written before validation state was tracked (treated as valid).
   */
  validated?: boolean;
  validation_errors?: string[];
  /** `events[]` entries removed because they failed the event schema. */
  dropped_events?: unknown[];
}

export function readSidecarPacket(
  workItemId: string,
  taskId: string | number,
  ref: string,
): SidecarPacket | null {
  const raw = readTaskSidecar(workItemId, taskId, sidecarName(ref, "json"));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SidecarPacket;
  } catch {
    return null;
  }
}

/** Latest test output text for the task (phase-test RED run), or `""`. */
export function readLastTestOutput(task: TaskFileV2): string {
  const name = task.control.last_test_run?.output;
  if (!name) return "";
  return readTaskSidecar(task.work_item, task.task, name) ?? "";
}
