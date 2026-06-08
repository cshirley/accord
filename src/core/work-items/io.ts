/**
 * Low-level JSON file I/O and .tasks/ directory operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskFile, WorkItem } from "./types.js";
import {
  listWorkItemFileRefs,
  resolveTasksDir,
  workItemJsonPath,
  taskJsonPath,
} from "./tasks-dir.js";

export {
  enrichmentsDirForWorkItem,
  enrichmentsDirRelForWorkItem,
  listTasksDirCandidates,
  listWorkItemFileRefs,
  resolveTasksDir,
  resolveWorkItemFilePath,
  workItemJsonPath,
  taskJsonPath,
  checkpointJsonPath,
} from "./tasks-dir.js";

export const TASKS_DIR = ".tasks";

/** Canonical pattern for work item IDs (e.g. ACCORD-1234, MY_TEAM_123, MYTEAM_42, MY-TEAM-123). */
export const WORK_ITEM_ID_PATTERN = /[A-Z]+([_-][A-Z]+)*[_-]\d+/;

/** Matches a `.tasks/<ID>.json` filename. */
export const WORK_ITEM_FILE_PATTERN = /^[A-Z]+([_-][A-Z]+)*[_-]\d+\.json$/;

export function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Atomic JSON write: serialise to a sibling temp file, fsync, then rename
 * over the destination. The rename is atomic on POSIX, so readers either
 * see the previous value or the new one — never a partial write — even if
 * the process is killed mid-write.
 */
export function writeJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  // Use process.pid + a counter to make collisions between concurrent
  // writers in the same process impossible.
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${tmpCounter++}`);
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeFileSync(fd, payload);
    try {
      fs.fsyncSync(fd);
    } catch {
      // fsync can fail on some filesystems (e.g. tmpfs in CI); ignore.
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

let tmpCounter = 0;

/**
 * Read-modify-write a JSON file in a single helper so callers don't have to
 * remember to load then write. The mutator may either mutate `current` in
 * place and return void, or return a replacement value.
 *
 * Concurrency note: this is not a cross-process lock — the underlying
 * `writeJson` is atomic per-write, but interleaved read/modify/write cycles
 * on the same file from separate processes can still lose updates. For the
 * `.tasks/` work-item case that's acceptable: the harness is single-writer
 * within a phase, and atomic writes prevent torn files.
 */
export function mutateJson<T>(filePath: string, mutator: (current: T | null) => T | undefined): T {
  const current = readJson<T>(filePath);
  const result = mutator(current);
  const next = (result === undefined ? current : result) as T;
  writeJson(filePath, next);
  return next;
}

export function now(): string {
  return new Date().toISOString();
}

export function isWorkItemFile(name: string): boolean {
  return WORK_ITEM_FILE_PATTERN.test(name);
}

export function listWorkItemFiles(cwd?: string): string[] {
  return listWorkItemFileRefs(cwd).map((ref) => ref.fileName);
}

export function loadWorkItem(id: string, cwd?: string): WorkItem | null {
  return readJson<WorkItem>(workItemJsonPath(id, cwd));
}

export function loadTaskFile(
  workItemId: string,
  taskId: string,
  cwd?: string,
): TaskFile | null {
  return readJson<TaskFile>(taskJsonPath(workItemId, taskId, cwd));
}
