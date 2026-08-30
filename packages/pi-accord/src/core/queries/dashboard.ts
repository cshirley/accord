/**
 * Tasks dashboard — read-only overview of all work items.
 */

import * as path from "node:path";
import { devCheckpointRead } from "../work-items/checkpoint.js";
import { listWorkItemFileRefs, readJson, taskJsonPath } from "../work-items/io.js";
import type { Deviation, TaskFile, WorkItem } from "../work-items/types.js";
import { formatTasksDashboard } from "./dashboard-format.js";
import {
  missingArtifactsForWorkItem,
  resolveDashboardActionHint,
  resolveUsageCostUsd,
} from "./dashboard-hints.js";

export interface TasksDashboardRow {
  id: string;
  title: string;
  pattern: string;
  phase: string;
  terminal_outcome?: string;
  completed_at?: string;
  tasks_done: number;
  tasks_total: number;
  tasks_blocked: number;
  tasks_in_progress: number;
  tasks_pending: number;
  pending_decisions: number;
  pending_deviations: number;
  deviations_total: number;
  has_checkpoint: boolean;
  missing_artifacts: string[];
  action_hint: string | null;
  cost_usd: number;
  usage_cost_usd: number | null;
  display_cost_usd: number;
  cost_from_usage: boolean;
  updated: string;
  updated_relative: string;
}

export interface TasksDashboardResult {
  rows: TasksDashboardRow[];
  total_pending: number;
  total_pending_deviations: number;
  total_blocked_tasks: number;
  finish_ready_count: number;
  total_cost: number;
  total_usage_cost: number;
  attention_summary: string;
  formatted: string;
}

function countPendingDeviations(deviations: Deviation[] | undefined): number {
  return (deviations || []).filter((d) => {
    if (d.resolution === "accepted" || d.resolution === "mechanical") return false;
    if (d.status === "resolved") return false;
    return true;
  }).length;
}

function formatRelativeUpdated(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return "just now";
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${String(hr)}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${String(day)}d ago`;
  return iso.slice(0, 10);
}

function buildAttentionSummary(
  rows: TasksDashboardRow[],
  totalPending: number,
  totalPendingDeviations: number,
  totalBlockedTasks: number,
  finishReadyCount: number,
): string {
  const checkpoints = rows.filter((r) => r.has_checkpoint && !r.completed_at).length;
  const missingArtifactItems = rows.filter(
    (r) => r.missing_artifacts.length > 0 && !r.completed_at,
  ).length;
  const parts: string[] = [];
  if (totalPending > 0) parts.push(`${String(totalPending)} pending decision(s)`);
  if (totalPendingDeviations > 0) {
    parts.push(`${String(totalPendingDeviations)} pending deviation(s)`);
  }
  if (totalBlockedTasks > 0) parts.push(`${String(totalBlockedTasks)} blocked task(s)`);
  if (finishReadyCount > 0) {
    parts.push(`${String(finishReadyCount)} ready for /dev finish`);
  }
  if (checkpoints > 0) parts.push(`${String(checkpoints)} checkpoint(s)`);
  if (missingArtifactItems > 0) {
    parts.push(`${String(missingArtifactItems)} missing artifact(s)`);
  }
  if (parts.length === 0) return "No items need review attention.";
  return `Needs attention: ${parts.join(" · ")}`;
}

export function devTasks(): TasksDashboardResult {
  const rows: TasksDashboardRow[] = [];

  for (const ref of listWorkItemFileRefs()) {
    const wi = readJson<WorkItem>(path.join(ref.tasksDir, ref.fileName));
    if (!wi) continue;

    let done = 0,
      total = 0,
      blocked = 0,
      inProgress = 0,
      pending = 0;
    for (const tid of wi.task_ids || []) {
      total++;
      const tf = readJson<TaskFile>(taskJsonPath(wi.id, tid));
      if (tf?.status === "done") done++;
      else if (tf?.status === "blocked") blocked++;
      else if (tf?.status === "in_progress") inProgress++;
      else if (tf?.status === "pending") pending++;
    }

    const pendingDeviations = countPendingDeviations(wi.deviations);
    const pendingDecisions = (wi.decisions || []).filter((d) => d.status === "pending").length;
    const missingArtifacts = missingArtifactsForWorkItem(wi);
    const actionHint = resolveDashboardActionHint(wi.id, wi, {
      pending_decisions: pendingDecisions,
      pending_deviations: pendingDeviations,
    });
    const storedCost = wi.cost_usd || 0;
    const usageCost = resolveUsageCostUsd(wi.id);
    const displayCost = usageCost ?? storedCost;
    const costFromUsage = usageCost !== null && Math.abs(usageCost - storedCost) > 0.005;

    rows.push({
      id: wi.id,
      title: wi.title,
      pattern: wi.variant ? `${wi.pattern}/${wi.variant}` : wi.pattern,
      phase: wi.phase,
      terminal_outcome: wi.terminal_outcome,
      completed_at: wi.completed_at,
      tasks_done: done,
      tasks_total: total,
      tasks_blocked: blocked,
      tasks_in_progress: inProgress,
      tasks_pending: pending,
      pending_decisions: pendingDecisions,
      pending_deviations: pendingDeviations,
      deviations_total: (wi.deviations || []).length,
      has_checkpoint: !!devCheckpointRead(wi.id),
      missing_artifacts: missingArtifacts,
      action_hint: actionHint,
      cost_usd: storedCost,
      usage_cost_usd: usageCost,
      display_cost_usd: displayCost,
      cost_from_usage: costFromUsage,
      updated: wi.updated,
      updated_relative: formatRelativeUpdated(wi.updated),
    });
  }

  rows.sort((a, b) => b.updated.localeCompare(a.updated));

  const totalPending = rows.reduce((s, r) => s + r.pending_decisions, 0);
  const totalPendingDeviations = rows.reduce((s, r) => s + r.pending_deviations, 0);
  const totalBlockedTasks = rows.reduce((s, r) => s + r.tasks_blocked, 0);
  const finishReadyCount = rows.filter((r) => r.action_hint === "→ finish").length;
  const totalCost = rows.reduce((s, r) => s + r.display_cost_usd, 0);
  const totalUsageCost = rows.reduce((s, r) => s + (r.usage_cost_usd ?? r.cost_usd), 0);
  const attentionSummary = buildAttentionSummary(
    rows,
    totalPending,
    totalPendingDeviations,
    totalBlockedTasks,
    finishReadyCount,
  );

  const formatted = formatTasksDashboard({
    rows,
    total_pending: totalPending,
    total_pending_deviations: totalPendingDeviations,
    total_blocked_tasks: totalBlockedTasks,
    finish_ready_count: finishReadyCount,
    total_cost: totalCost,
    attention_summary: attentionSummary,
  });

  return {
    rows,
    total_pending: totalPending,
    total_pending_deviations: totalPendingDeviations,
    total_blocked_tasks: totalBlockedTasks,
    finish_ready_count: finishReadyCount,
    total_cost: totalCost,
    total_usage_cost: totalUsageCost,
    attention_summary: attentionSummary,
    formatted,
  };
}
