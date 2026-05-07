/**
 * Review queue — collect pending decisions and deviations.
 */

import * as path from "node:path";
import type { WorkItem, Decision, Deviation } from "../work-items/types.js";
import { TASKS_DIR, readJson, listWorkItemFiles } from "../work-items/io.js";

export interface ReviewQueueItem {
  work_item_id: string;
  decision: Decision;
}

export interface ReviewQueueResult {
  pending_decisions: ReviewQueueItem[];
  deviations: { work_item_id: string; deviation: Deviation }[];
  formatted: string;
}

export function devReviewQueue(): ReviewQueueResult {
  const files = listWorkItemFiles();
  const pendingDecisions: ReviewQueueItem[] = [];
  const deviations: { work_item_id: string; deviation: Deviation }[] = [];

  for (const file of files) {
    const wi = readJson<WorkItem>(path.join(TASKS_DIR, file));
    if (!wi) continue;

    for (const d of (wi.decisions || [])) {
      if (d.status === "pending") {
        pendingDecisions.push({ work_item_id: wi.id, decision: d });
      }
    }
    for (const dev of (wi.deviations || [])) {
      if (!dev.status || dev.status === "pending") {
        deviations.push({ work_item_id: wi.id, deviation: dev });
      }
    }
  }

  pendingDecisions.sort((a, b) => a.decision.asked_at.localeCompare(b.decision.asked_at));
  deviations.sort((a, b) => a.deviation.at.localeCompare(b.deviation.at));

  const lines: string[] = [];
  if (pendingDecisions.length === 0 && deviations.length === 0) {
    lines.push("Review queue clean — no pending decisions or deviations.");
  } else {
    if (pendingDecisions.length > 0) {
      lines.push(`${pendingDecisions.length} pending decision(s):\n`);
      for (const item of pendingDecisions) {
        lines.push(`[${item.work_item_id}/${item.decision.id}] source=${item.decision.source} phase=${item.decision.phase || "—"} asked=${item.decision.asked_at}`);
        lines.push(`  Q: ${item.decision.question}`);
        if (item.decision.context) lines.push(`  Context: ${item.decision.context}`);
        lines.push("");
      }
    }
    if (deviations.length > 0) {
      lines.push(`${deviations.length} deviation(s):\n`);
      for (const item of deviations) {
        lines.push(`[${item.work_item_id}/task-${item.deviation.task_id}] at=${item.deviation.at}`);
        lines.push(`  ${item.deviation.description}`);
        lines.push(`  Why: ${item.deviation.reason}`);
        lines.push("");
      }
    }
  }

  return { pending_decisions: pendingDecisions, deviations, formatted: lines.join("\n") };
}
