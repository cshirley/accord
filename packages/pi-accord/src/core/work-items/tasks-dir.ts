/**
 * Resolve `.tasks/` for nested monorepo layouts (e.g. `apps/partner-portal/.tasks`)
 * when the harness cwd is the git root or another package.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { findGitRoot } from "../config/git.js";

export const TASKS_DIR_NAME = ".tasks";

/** Matches a `.tasks/<ID>.json` filename. */
const WORK_ITEM_FILE_PATTERN = /^[A-Z]+([_-][A-Z]+)*[_-]\d+\.json$/;

const MONOREPO_PACKAGE_ROOTS = ["apps", "packages", "libs", "services", "modules"] as const;
const MAX_MONOREPO_SCAN_DEPTH = 6;
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".nx",
  "target",
  "vendor",
]);

function uniqueResolved(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = path.resolve(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function tasksDirsWalkUpFrom(cwd: string): string[] {
  const out: string[] = [];
  let dir = path.resolve(cwd);
  const gitRoot = findGitRoot(dir);
  const stopAt = gitRoot ? path.resolve(gitRoot) : null;

  while (true) {
    out.push(path.join(dir, TASKS_DIR_NAME));
    if (stopAt && dir === stopAt) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

function nestedTasksDirsUnderGitRoot(gitRoot: string): string[] {
  const out: string[] = [];
  const root = path.resolve(gitRoot);

  for (const segment of MONOREPO_PACKAGE_ROOTS) {
    const base = path.join(root, segment);
    if (!fs.existsSync(base)) continue;
    let children: string[];
    try {
      children = fs.readdirSync(base);
    } catch {
      continue;
    }
    for (const name of children) {
      const tasksPath = path.join(base, name, TASKS_DIR_NAME);
      if (fs.existsSync(tasksPath)) out.push(tasksPath);
    }
  }

  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_MONOREPO_SCAN_DEPTH) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (!ent.isDirectory() || SKIP_DIR_NAMES.has(ent.name)) continue;
      const child = path.join(dir, ent.name);
      if (MONOREPO_PACKAGE_ROOTS.includes(ent.name as (typeof MONOREPO_PACKAGE_ROOTS)[number])) {
        continue;
      }
      const tasksPath = path.join(child, TASKS_DIR_NAME);
      if (fs.existsSync(tasksPath)) out.push(tasksPath);
      if (depth < MAX_MONOREPO_SCAN_DEPTH) {
        queue.push({ dir: child, depth: depth + 1 });
      }
    }
  }

  return out;
}

export function listTasksDirCandidates(cwd: string = process.cwd()): string[] {
  const resolvedCwd = path.resolve(cwd);
  const walkUp = tasksDirsWalkUpFrom(resolvedCwd);
  const gitRoot = findGitRoot(resolvedCwd);
  const nested = gitRoot ? nestedTasksDirsUnderGitRoot(gitRoot) : [];
  return uniqueResolved([...walkUp, ...nested]);
}

export function resolveWorkItemFilePath(
  workItemId: string,
  cwd: string = process.cwd(),
): string | null {
  const fileName = `${workItemId}.json`;
  for (const tasksDir of listTasksDirCandidates(cwd)) {
    const candidate = path.join(tasksDir, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveTasksDir(workItemId?: string, cwd: string = process.cwd()): string {
  if (workItemId) {
    const existing = resolveWorkItemFilePath(workItemId, cwd);
    if (existing) return path.dirname(existing);
  }
  return path.join(path.resolve(cwd), TASKS_DIR_NAME);
}

export function workItemJsonPath(workItemId: string, cwd?: string): string {
  return path.join(resolveTasksDir(workItemId, cwd), `${workItemId}.json`);
}

export function taskJsonPath(workItemId: string, taskId: string | number, cwd?: string): string {
  return path.join(resolveTasksDir(workItemId, cwd), `${workItemId}-task-${taskId}.json`);
}

export function checkpointJsonPath(workItemId: string, cwd?: string): string {
  return path.join(resolveTasksDir(workItemId, cwd), `${workItemId}-checkpoint.json`);
}

export function enrichmentsDirForWorkItem(workItemId: string, cwd?: string): string {
  return path.join(resolveTasksDir(workItemId, cwd), `${workItemId}-enrichments`);
}

export function enrichmentsDirRelForWorkItem(
  workItemId: string,
  cwd: string = process.cwd(),
): string {
  const rel = path.relative(path.resolve(cwd), enrichmentsDirForWorkItem(workItemId, cwd));
  if (!rel) return enrichmentsDirForWorkItem(workItemId, cwd);
  return rel.split(path.sep).join("/");
}

export interface WorkItemFileRef {
  id: string;
  fileName: string;
  tasksDir: string;
}

export function listWorkItemFileRefs(cwd: string = process.cwd()): WorkItemFileRef[] {
  const refs: WorkItemFileRef[] = [];
  const seenIds = new Set<string>();

  for (const tasksDir of listTasksDirCandidates(cwd)) {
    if (!fs.existsSync(tasksDir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(tasksDir);
    } catch {
      continue;
    }
    for (const fileName of names) {
      if (!WORK_ITEM_FILE_PATTERN.test(fileName)) continue;
      const id = fileName.replace(/\.json$/, "");
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      refs.push({ id, fileName, tasksDir });
    }
  }
  return refs;
}
