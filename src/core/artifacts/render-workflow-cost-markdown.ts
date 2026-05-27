/**
 * Render workflow-cost.md from workflow-cost.json payload.
 */

import type { WorkflowCostArtifact } from "./workflow-cost-artifact.js";

function formatTokenCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function renderWorkflowCostMarkdown(artifact: WorkflowCostArtifact): string {
  const { work_item_id, generated_at, source_usage_file, summary, rows } = artifact;

  const lines: string[] = [
    `# Workflow cost: ${work_item_id}`,
    "",
    `- Generated: ${generated_at}`,
    `- Source: \`${source_usage_file}\``,
    `- Total input tokens: **${formatTokenCount(summary.total_input_tokens)}**`,
    `- Total output tokens: **${formatTokenCount(summary.total_output_tokens)}**`,
    `- Estimated cost (USD): **${formatUsd(summary.total_cost_usd)}**`,
    "",
    "## By scope and agent",
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
      `| **Total** | | | **${formatTokenCount(summary.total_input_tokens)}** | **${formatTokenCount(summary.total_output_tokens)}** | **${formatUsd(summary.total_cost_usd)}** |`,
    );
  }

  lines.push(
    "",
    "Pricing is estimated from model rates in the harness config; see `.tasks/<ID>-usage.jsonl` for per-call detail.",
  );

  return `${lines.join("\n")}\n`;
}
