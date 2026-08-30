/**
 * Single work-item status — tasks, next resume agent, finish nudge.
 */

import { getAgentMeta } from "../agents/registry.js";
import type { DevHarnessConfig } from "../config/index.js";
import { isWorkItemPattern, resolveResumeAgentId } from "../orchestration/phase-coarse-routing.js";
import {
  describeImplementingResumeBlocked,
  resolveImplementingResumeAgentId,
} from "../orchestration/resolve/primary-task.js";
import { resolveResumeOrchestration } from "../orchestration/resolve/resume.js";
import { devCheckpointRead } from "../work-items/checkpoint.js";
import { loadTaskFile, loadWorkItem } from "../work-items/io.js";
import { ensureWorkItemHydrated } from "../work-items/rehydrate.js";

export interface WorkItemTaskStatusRow {
  task_id: number;
  status: string;
  phase: string;
  pre_impl_gates?: string;
}

export interface WorkItemStatusResult {
  id: string;
  phase: string;
  pattern: string;
  variant?: string;
  terminal_outcome?: string;
  completed_at?: string;
  has_checkpoint: boolean;
  checkpoint_phase?: string;
  reconcile_steps?: number;
  tasks: WorkItemTaskStatusRow[];
  next_resume_agent: string | null;
  finish_nudge: string | null;
  blocked_hint: string | null;
  formatted: string;
}

export function devWorkItemStatus(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): { ok: true; value: WorkItemStatusResult } | { ok: false; error: string } {
  const hydrated = ensureWorkItemHydrated(workItemId);
  if (!hydrated.ok) {
    return { ok: false, error: hydrated.error };
  }

  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return { ok: false, error: `Work item not found: ${workItemId}` };
  }

  const cp = devCheckpointRead(workItemId);
  const tasks: WorkItemTaskStatusRow[] = [];
  for (const tid of [...(wi.task_ids ?? [])].sort((a, b) => a - b)) {
    const tf = loadTaskFile(workItemId, String(tid));
    if (!tf) continue;
    tasks.push({
      task_id: tf.task_id,
      status: tf.status,
      phase: tf.phase,
      ...(typeof tf.pre_impl_gates === "string" ? { pre_impl_gates: tf.pre_impl_gates } : {}),
    });
  }

  let nextResumeAgent: string | null = null;
  if (!wi.completed_at) {
    const resolution = resolveResumeOrchestration(workItemId, devConfig);
    if (resolution.outcome === "spawn") {
      nextResumeAgent = resolution.agent;
    }
  }

  const finishNudge = describeImplementingResumeBlocked(workItemId);
  let blockedHint: string | null = null;
  if (!nextResumeAgent && !wi.completed_at && isWorkItemPattern(wi.pattern)) {
    const coarseAgent = resolveResumeAgentId(wi.phase, wi.pattern);
    if (!coarseAgent && wi.phase === "implementing" && wi.pattern === "implement") {
      blockedHint = finishNudge;
    } else if (!coarseAgent) {
      blockedHint = `Phase "${wi.phase}" has no harness resume mapping.`;
    } else if (wi.phase === "implementing") {
      const impl = resolveImplementingResumeAgentId(workItemId);
      if (!impl) {
        blockedHint = finishNudge ?? describeImplementingResumeBlocked(workItemId);
      }
    }
  }

  const lines: string[] = [
    `# ${workItemId}`,
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| pattern | ${wi.pattern}${wi.variant ? ` / ${wi.variant}` : ""} |`,
    `| phase | ${wi.phase} |`,
    ...(wi.terminal_outcome ? [`| terminal_outcome | ${wi.terminal_outcome} |`] : []),
    ...(wi.completed_at ? [`| completed_at | ${wi.completed_at} |`] : []),
    `| checkpoint | ${cp ? `yes (${cp.phase})` : "no"} |`,
    ...(hydrated.value.reconcile_steps
      ? [`| reconcile (this call) | ${String(hydrated.value.reconcile_steps)} step(s) |`]
      : []),
    `| next_resume_agent | ${nextResumeAgent ?? "—"} |`,
  ];

  if (tasks.length > 0) {
    lines.push(
      "",
      "## Tasks",
      "",
      "| task | status | phase | gates |",
      "| --- | --- | --- | --- |",
    );
    for (const t of tasks) {
      const gates = t.pre_impl_gates ?? "—";
      const agentOk = getAgentMeta(t.phase) ? "" : " ⚠";
      lines.push(`| ${String(t.task_id)} | ${t.status} | \`${t.phase}\`${agentOk} | ${gates} |`);
    }
  }

  if (finishNudge) {
    lines.push("", "## Finish nudge", "", finishNudge);
  }
  if (blockedHint && blockedHint !== finishNudge) {
    lines.push("", "## Blocked", "", blockedHint);
  }

  return {
    ok: true,
    value: {
      id: workItemId,
      phase: wi.phase,
      pattern: wi.pattern,
      variant: wi.variant,
      terminal_outcome: wi.terminal_outcome,
      completed_at: wi.completed_at,
      has_checkpoint: !!cp,
      checkpoint_phase: cp?.phase,
      reconcile_steps: hydrated.value.reconcile_steps,
      tasks,
      next_resume_agent: nextResumeAgent,
      finish_nudge: finishNudge,
      blocked_hint: blockedHint,
      formatted: lines.join("\n"),
    },
  };
}
