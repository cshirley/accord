/**
 * Low-level JSON file I/O and .tasks/ directory operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkItem, TaskFile } from "./types.js";

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

export function writeJson(filePath: string, data: any): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

export function now(): string {
  return new Date().toISOString();
}

export function isWorkItemFile(name: string): boolean {
  return WORK_ITEM_FILE_PATTERN.test(name);
}

export function listWorkItemFiles(): string[] {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR).filter(isWorkItemFile);
}

export function loadWorkItem(id: string): WorkItem | null {
  return readJson<WorkItem>(path.join(TASKS_DIR, `${id}.json`));
}

export function loadTaskFile(workItemId: string, taskId: string): TaskFile | null {
  return readJson<TaskFile>(path.join(TASKS_DIR, `${workItemId}-task-${taskId}.json`));
}
