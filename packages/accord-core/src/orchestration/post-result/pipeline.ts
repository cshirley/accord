/**
 * Shared helpers for the task-pipeline post-result handlers (v2 task file).
 */

import type { TaskFileV2 } from "../../tasks/types.js";
import type { WorkItem } from "../../work-items/types.js";

export interface PostResultContext {
  /** Prose analysis from the subagent (assistant text before the JSON fence). */
  analysis?: string;
}

export type PipelineLabel = "Quick-fix" | "Implement";

/** `Quick-fix` / `Implement` when the work item is on a task-pipeline coarse phase, else null. */
export function pipelineLabel(wi: WorkItem): PipelineLabel | null {
  if (wi.pattern === "quick_fix" && wi.phase === "fixing") return "Quick-fix";
  if (wi.pattern === "implement" && wi.phase === "implementing") return "Implement";
  return null;
}

export function analysisFrom(
  packet: Record<string, unknown>,
  context?: PostResultContext,
): string | undefined {
  if (typeof packet.analysis === "string" && packet.analysis.trim()) return packet.analysis.trim();
  const text = context?.analysis?.trim();
  return text ? text : undefined;
}

export function traceHint(task: TaskFileV2): string {
  return `Details: \`accord trace ${task.work_item} --task ${String(task.task)}\` (or the task file \`summary\`).`;
}

export function footer(lines: ReadonlyArray<string | false | undefined>): string {
  return ["", "", ...lines.filter((line): line is string => typeof line === "string")].join("\n");
}
