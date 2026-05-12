/**
 * Tasks dashboard — read-only overview of all work items.
 */

import * as path from "node:path";
import { listWorkItemFiles, readJson, TASKS_DIR } from "../work-items/io.js";
import type { TaskFile, WorkItem } from "../work-items/types.js";

export interface TasksDashboardRow {
  id: string;
  pattern: string;
  phase: string;
  terminal_outcome?: string;
  tasks_done: number;
  tasks_total: number;
  tasks_blocked: number;
  pending_decisions: number;
  deviations: number;
  cost_usd: number;
  updated: string;
}

export interface TasksDashboardResult {
  rows: TasksDashboardRow[];
  total_pending: number;
  total_cost: number;
  formatted: string;
}

export function devTasks(): TasksDashboardResult {
  const files = listWorkItemFiles();
  const rows: TasksDashboardRow[] = [];

  for (const file of files) {
    const wi = readJson<WorkItem>(path.join(TASKS_DIR, file));
    if (!wi) continue;

    let done = 0,
      total = 0,
      blocked = 0;
    for (const tid of wi.task_ids || []) {
      total++;
      const tf = readJson<TaskFile>(path.join(TASKS_DIR, `${wi.id}-task-${tid}.json`));
      if (tf?.status === "done") done++;
      else if (tf?.status === "blocked") blocked++;
    }

    rows.push({
      id: wi.id,
      pattern: wi.variant ? `${wi.pattern}/${wi.variant}` : wi.pattern,
      phase: wi.phase,
      terminal_outcome: wi.terminal_outcome,
      tasks_done: done,
      tasks_total: total,
      tasks_blocked: blocked,
      pending_decisions: (wi.decisions || []).filter((d) => d.status === "pending").length,
      deviations: (wi.deviations || []).length,
      cost_usd: wi.cost_usd || 0,
      updated: wi.updated,
    });
  }

  rows.sort((a, b) => b.updated.localeCompare(a.updated));

  const totalPending = rows.reduce((s, r) => s + r.pending_decisions, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost_usd, 0);

  const lines: string[] = [];
  if (rows.length === 0) {
    lines.push("No active work items.");
  } else {
    lines.push(
      "ID           PATTERN              PHASE/OUTCOME      TASKS        PENDING  DEV   COST",
    );
    for (const r of rows) {
      const tasks =
        r.tasks_total > 0
          ? `${r.tasks_done}/${r.tasks_total}${r.tasks_blocked > 0 ? ` (${r.tasks_blocked}b)` : ""}`
          : "—";
      const phase = r.terminal_outcome ? `${r.phase}/${r.terminal_outcome}` : r.phase;
      lines.push(
        `${r.id.padEnd(13)}${r.pattern.padEnd(21)}${phase.padEnd(19)}${tasks.padEnd(13)}${String(r.pending_decisions).padEnd(9)}${String(r.deviations).padEnd(6)}$${r.cost_usd.toFixed(2)}`,
      );
    }
    lines.push("");
    lines.push(
      `${rows.length} work items · ${totalPending} pending decisions · total cost $${totalCost.toFixed(2)}`,
    );
    if (totalPending > 0) lines.push("Run /dev review to work the queue.");
  }

  return { rows, total_pending: totalPending, total_cost: totalCost, formatted: lines.join("\n") };
}
