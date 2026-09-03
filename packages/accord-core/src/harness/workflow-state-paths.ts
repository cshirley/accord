/**
 * Classify `.tasks/` paths the orchestrator owns (not phase agents).
 */

import { WORK_ITEM_FILE_PATTERN } from "../work-items/io.js";
import { normalizeHarnessRelativePath } from "./paths.js";

export type WorkflowStatePathKind =
  | "work_item"
  | "task"
  | "checkpoint"
  | "allowed_runtime"
  | "not_tasks";

const TASK_FILE_PATTERN = /^[A-Z]+([_-][A-Z]+)*[_-]\d+-task-\d+\.json$/;
const CHECKPOINT_FILE_PATTERN = /^[A-Z]+([_-][A-Z]+)*[_-]\d+-checkpoint\.json$/;

/** Paths agents may still write under `.tasks/` (caches, receipts, usage). */
const ALLOWED_RUNTIME_PATTERNS = [
  /^[A-Z]+([_-][A-Z]+)*[_-]\d+-enrichments\//,
  /^[A-Z]+([_-][A-Z]+)*[_-]\d+-gaps\.json$/,
  /^\.verify-preflight-[A-Z]+([_-][A-Z]+)*[_-]\d+\.json$/,
  /^[A-Z]+([_-][A-Z]+)*[_-]\d+-usage\.jsonl$/,
  /^\.exec-spawn\//,
];

export function classifyWorkflowStatePath(filePath: string): WorkflowStatePathKind {
  const norm = normalizeHarnessRelativePath(filePath);
  if (!norm.startsWith(".tasks/")) {
    return "not_tasks";
  }

  const relative = norm.slice(".tasks/".length);
  const basename = relative.includes("/") ? (relative.split("/").pop() ?? relative) : relative;

  if (WORK_ITEM_FILE_PATTERN.test(basename)) {
    return "work_item";
  }
  if (TASK_FILE_PATTERN.test(basename)) {
    return "task";
  }
  if (CHECKPOINT_FILE_PATTERN.test(basename)) {
    return "checkpoint";
  }

  for (const pattern of ALLOWED_RUNTIME_PATTERNS) {
    if (pattern.test(relative)) {
      return "allowed_runtime";
    }
  }

  return "allowed_runtime";
}

export function isOrchestratorOwnedWorkflowStatePath(filePath: string): boolean {
  const kind = classifyWorkflowStatePath(filePath);
  return kind === "work_item" || kind === "task" || kind === "checkpoint";
}
