/**
 * Low-level JSON file I/O and .tasks/ directory operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { listWorkItemFileRefs, taskJsonPath, workItemJsonPath } from "./tasks-dir.js";
import type { TaskFile, WorkItem } from "./types.js";

export {
  checkpointJsonPath,
  enrichmentsDirForWorkItem,
  enrichmentsDirRelForWorkItem,
  listTasksDirCandidates,
  listWorkItemFileRefs,
  resolveTasksDir,
  resolveWorkItemFilePath,
  taskJsonPath,
  workItemJsonPath,
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
 * Cross-process advisory lock for a JSON file's read-modify-write cycle.
 *
 * `writeJson` alone is atomic per-write (rename-over-destination), but a bare
 * read \u2192 mutate \u2192 write round trip is not: two processes (or two overlapping
 * subagent-result batches in the same process) that each read before the other
 * writes will race, and the loser's write silently clobbers the winner's mutation
 * \u2014 scalar/object fields like `review_loop`, `quick_fix_loop`, or `phase` revert
 * to the loser's stale snapshot while append-only arrays (`agent_returns`,
 * `events`) still visibly grow, masking the lost update. `withJsonFileLock` closes
 * that window with an exclusive lockfile (`fs.openSync(..., "wx")`), so callers
 * that need read-modify-write semantics (see `mutateJson`, `advancePrimaryTask`)
 * hold the lock for the full cycle instead of racing on the bare file.
 */
export function withJsonFileLock<T>(filePath: string, fn: () => T): T {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + JSON_FILE_LOCK_TIMEOUT_MS;
  let fd: number | null = null;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
      if (Date.now() >= deadline) {
        // Stale lock (crashed holder) or genuine long-held lock \u2014 steal it rather
        // than deadlocking forever; the atomic writeJson underneath still prevents
        // torn files even if this races once more.
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Another waiter may have already removed/recreated it; retry the loop.
        }
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, JSON_FILE_LOCK_POLL_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
    } catch {
      // already closed
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // already removed by a stale-lock steal elsewhere
    }
  }
}

const JSON_FILE_LOCK_TIMEOUT_MS = 10_000;
const JSON_FILE_LOCK_POLL_MS = 25;

/**
 * Stable lock key shared by every caller that mutates *any* per-task JSON file for a work
 * item (`advancePrimaryTask`, `bumpQuickFixTestReviewCycle`, `unblockTask`, ...). Keying on
 * the work item's lowest task id \u2014 rather than whichever task id a given caller happens to be
 * touching \u2014 means all of them lock on the exact same path and therefore actually serialise
 * against each other, instead of each holding a lock on a different file that provides no
 * mutual exclusion at all.
 */
export function taskLockPath(workItemId: string, cwd?: string): string {
  const wi = readJson<WorkItem>(workItemJsonPath(workItemId, cwd));
  const sorted = [...(wi?.task_ids ?? [])].sort((a, b) => a - b);
  const lockTaskId = sorted[0] ?? 1;
  return taskJsonPath(workItemId, lockTaskId, cwd);
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
 * Concurrency: the full read → mutate → write cycle runs under
 * `withJsonFileLock`, so two overlapping callers (separate processes, or
 * overlapping subagent-result batches in the same process) serialise instead
 * of racing — the loser sees the winner's write rather than clobbering it.
 */
export function mutateJson<T>(filePath: string, mutator: (current: T | null) => T | undefined): T {
  return withJsonFileLock(filePath, () => {
    const current = readJson<T>(filePath);
    const result = mutator(current);
    const next = (result === undefined ? current : result) as T;
    writeJson(filePath, next);
    return next;
  });
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

export function loadTaskFile(workItemId: string, taskId: string, cwd?: string): TaskFile | null {
  return readJson<TaskFile>(taskJsonPath(workItemId, taskId, cwd));
}
