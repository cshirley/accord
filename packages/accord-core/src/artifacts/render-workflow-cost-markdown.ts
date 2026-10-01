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
  const cacheRead = summary.total_cache_read_tokens ?? 0;
  const cacheWrite = summary.total_cache_write_tokens ?? 0;
  const totalCalls = summary.total_calls ?? rows.reduce((sum, row) => sum + row.calls, 0);

  const lines: string[] = [
    `# Workflow cost: ${work_item_id}`,
    "",
    `- Generated: ${generated_at}`,
    `- Source: \`${source_usage_file}\``,
    `- Calls: **${String(totalCalls)}**`,
    `- Input tokens: **${formatTokenCount(summary.total_input_tokens)}** (+ cache read **${formatTokenCount(cacheRead)}**, cache write **${formatTokenCount(cacheWrite)}**)`,
    `- Output tokens: **${formatTokenCount(summary.total_output_tokens)}**`,
    `- Estimated cost (USD): **${formatUsd(summary.total_cost_usd)}**`,
  ];
  if ((summary.usage_missing_calls ?? 0) > 0) {
    lines.push(
      `- ⚠ ${String(summary.usage_missing_calls)} call(s) reported no usage — counted, tokens/cost unknown`,
    );
  }
  if (summary.carried_forward) {
    lines.push("- Includes usage carried forward from a previous rollup (`.tasks/` was rebuilt)");
  }
  lines.push(
    "",
    "## By scope and agent",
    "",
    "| Scope | Agent | Calls | Input | Cache read | Cache write | Output | Est. $ |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  if (rows.length === 0) {
    lines.push("| — | — | — | — | — | — | — | — |");
    lines.push("");
    lines.push("_No billable usage recorded for this work item._");
  } else {
    for (const r of rows) {
      const missing =
        (r.usage_missing_calls ?? 0) > 0 ? ` (${String(r.usage_missing_calls)} no usage)` : "";
      lines.push(
        `| ${r.scope} | ${r.agent} | ${String(r.calls)}${missing} | ${formatTokenCount(r.input_tokens)} | ${formatTokenCount(r.cache_read_tokens ?? 0)} | ${formatTokenCount(r.cache_write_tokens ?? 0)} | ${formatTokenCount(r.output_tokens)} | ${formatUsd(r.cost_usd)} |`,
      );
    }
    lines.push(
      `| **Total** | | **${String(totalCalls)}** | **${formatTokenCount(summary.total_input_tokens)}** | **${formatTokenCount(cacheRead)}** | **${formatTokenCount(cacheWrite)}** | **${formatTokenCount(summary.total_output_tokens)}** | **${formatUsd(summary.total_cost_usd)}** |`,
    );
  }

  lines.push(
    "",
    "Pricing is estimated from model rates in the harness config; see `.tasks/<ID>-usage.jsonl` for per-call detail.",
  );

  return `${lines.join("\n")}\n`;
}
