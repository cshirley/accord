/**
 * Workflow cost rollup from `.tasks/<ID>-usage.jsonl` for finish / retro reporting.
 */

import {
  computeLineCost,
  loadPricing,
  type PricingConfig,
  readUsageLines,
  recomputeCost,
  type UsageLine,
} from "../telemetry/usage.js";
import { loadWorkItem } from "../work-items/io.js";

const PIPELINE_AGENTS = new Set([
  "phase-gather",
  "phase-align",
  "phase-spec",
  "phase-plan",
  "phase-verify-acceptance",
  "phase-gaps",
  "review-spec",
]);

const PIPELINE_ORDER = [
  "phase-gather",
  "phase-align",
  "phase-spec",
  "phase-plan",
  "phase-verify-acceptance",
  "phase-gaps",
  "review-spec",
];

export interface WorkflowCostRow {
  scope: string;
  agent: string;
  task_id?: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface WorkflowCostReport {
  work_item_id: string;
  rows: WorkflowCostRow[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  formatted: string;
}

function scopeLabel(line: UsageLine): string {
  if (line.subagent_type === "orchestrator") return "Orchestrator";
  if (line.task_id != null) return `Task ${String(line.task_id)}`;
  if (PIPELINE_AGENTS.has(line.subagent_type)) return "Pipeline";
  return "Other";
}

function rowKey(scope: string, agent: string, taskId?: number): string {
  return `${scope}\u0000${agent}\u0000${taskId ?? ""}`;
}

function sortRows(rows: WorkflowCostRow[]): WorkflowCostRow[] {
  const scopeRank = (scope: string): number => {
    if (scope === "Pipeline") return 0;
    if (scope.startsWith("Task ")) return 1;
    if (scope === "Orchestrator") return 2;
    return 3;
  };
  const taskNum = (scope: string): number => {
    const m = /^Task (\d+)$/.exec(scope);
    return m ? Number(m[1]) : 0;
  };
  const agentRank = (agent: string): number => {
    const p = PIPELINE_ORDER.indexOf(agent);
    return p >= 0 ? p : 100;
  };

  return [...rows].sort((a, b) => {
    const sd = scopeRank(a.scope) - scopeRank(b.scope);
    if (sd !== 0) return sd;
    if (a.scope.startsWith("Task ") && b.scope.startsWith("Task ")) {
      const td = taskNum(a.scope) - taskNum(b.scope);
      if (td !== 0) return td;
    }
    const ad = agentRank(a.agent) - agentRank(b.agent);
    if (ad !== 0) return ad;
    return a.agent.localeCompare(b.agent);
  });
}

function formatTokenCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function buildWorkflowCostReport(
  workItemId: string,
  pricing: PricingConfig = loadPricing(),
): WorkflowCostReport | null {
  if (!loadWorkItem(workItemId)) return null;

  const usageLines = readUsageLines(workItemId);
  const aggregated = new Map<string, WorkflowCostRow>();

  for (const line of usageLines) {
    const scope = scopeLabel(line);
    const agent = line.subagent_type || "unknown";
    const key = rowKey(scope, agent, line.task_id);
    const cost = computeLineCost(line, pricing);
    const input = line.usage.input || 0;
    const output = line.usage.output || 0;

    const existing = aggregated.get(key);
    if (existing) {
      existing.calls += 1;
      existing.input_tokens += input;
      existing.output_tokens += output;
      existing.cost_usd += cost;
    } else {
      aggregated.set(key, {
        scope,
        agent,
        ...(line.task_id != null ? { task_id: line.task_id } : {}),
        calls: 1,
        input_tokens: input,
        output_tokens: output,
        cost_usd: cost,
      });
    }
  }

  const rows = sortRows([...aggregated.values()]).map((r) => ({
    ...r,
    cost_usd: Math.round(r.cost_usd * 10000) / 10000,
  }));

  let totalInput = 0;
  let totalOutput = 0;
  let totalCost = 0;
  for (const r of rows) {
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
    totalCost += r.cost_usd;
  }

  const rolledUp = recomputeCost(workItemId, pricing);
  const totalCostUsd = rolledUp > 0 ? rolledUp : Math.round(totalCost * 10000) / 10000;

  const lines: string[] = [
    `## Workflow cost — ${workItemId}`,
    "",
    "| Scope | Agent | Calls | Input | Output | Est. $ |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];

  if (rows.length === 0) {
    lines.push("| — | — | — | — | — | — |");
    lines.push("");
    lines.push("_No billable usage recorded for this work item._");
  } else {
    for (const r of rows) {
      lines.push(
        `| ${r.scope} | ${r.agent} | ${String(r.calls)} | ${formatTokenCount(r.input_tokens)} | ${formatTokenCount(r.output_tokens)} | ${formatUsd(r.cost_usd)} |`,
      );
    }
    lines.push(
      `| **Total** | | | **${formatTokenCount(totalInput)}** | **${formatTokenCount(totalOutput)}** | **${formatUsd(totalCostUsd)}** |`,
    );
  }

  return {
    work_item_id: workItemId,
    rows,
    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cost_usd: totalCostUsd,
    formatted: lines.join("\n"),
  };
}

/** Formatted markdown for UI notify / finish closeout (empty when work item missing). */
export function formatWorkflowCostForFinish(workItemId: string): string {
  return buildWorkflowCostReport(workItemId)?.formatted ?? "";
}
