/**
 * Persist checked-in workflow cost artifacts under docs/dev/<ID>/.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  buildWorkflowCostReport,
  type WorkflowCostReport,
  type WorkflowCostRow,
} from "../queries/workflow-cost.js";
import { appendUsageLine, readUsageLines } from "../telemetry/usage.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, now, readJson, workItemJsonPath, writeJson } from "../work-items/io.js";
import { renderWorkflowCostMarkdown } from "./render-workflow-cost-markdown.js";

export interface WorkflowCostArtifact {
  schema_version: "1.0";
  work_item_id: string;
  generated_at: string;
  source_usage_file: string;
  summary: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cache_read_tokens?: number;
    total_cache_write_tokens?: number;
    total_calls?: number;
    usage_missing_calls?: number;
    carried_forward?: boolean;
    total_cost_usd: number;
  };
  rows: WorkflowCostRow[];
}

export function workflowCostJsonPath(workItemId: string): string {
  return path.join("docs", "dev", workItemId, "workflow-cost.json");
}

export function workflowCostMarkdownPath(workItemId: string): string {
  return path.join("docs", "dev", workItemId, "workflow-cost.md");
}

export function reportToWorkflowCostArtifact(
  report: WorkflowCostReport,
  generatedAt: string = new Date().toISOString(),
): WorkflowCostArtifact {
  return {
    schema_version: "1.0",
    work_item_id: report.work_item_id,
    generated_at: generatedAt,
    source_usage_file: path.join(".tasks", `${report.work_item_id}-usage.jsonl`),
    summary: {
      total_input_tokens: report.total_input_tokens,
      total_output_tokens: report.total_output_tokens,
      total_cache_read_tokens: report.total_cache_read_tokens,
      total_cache_write_tokens: report.total_cache_write_tokens,
      total_calls: report.total_calls,
      usage_missing_calls: report.usage_missing_calls,
      carried_forward: report.carried_forward,
      total_cost_usd: report.total_cost_usd,
    },
    rows: report.rows,
  };
}

export function syncWorkflowCostMarkdownFromJson(
  jsonPath: string,
): Result<{ markdownPath: string }> {
  const normalized = jsonPath.replace(/\\/g, "/");
  const match = /\/docs\/dev\/([^/]+)\/workflow-cost\.json$/i.exec(normalized);
  if (!match) {
    return err(`Not a workflow-cost.json path: ${jsonPath}`);
  }

  const artifact = readJson<WorkflowCostArtifact>(jsonPath);
  if (!artifact) {
    return err(`Cannot read workflow cost JSON: ${jsonPath}`);
  }

  const markdownPath = workflowCostMarkdownPath(artifact.work_item_id);
  writeFileSync(markdownPath, renderWorkflowCostMarkdown(artifact), "utf8");
  return ok({ markdownPath });
}

/** Write workflow-cost.json + workflow-cost.md and link on the work item. */
export function devPersistWorkflowCost(workItemId: string): Result<{
  json_path: string;
  markdown_path: string;
  artifact: WorkflowCostArtifact;
}> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const report = buildWorkflowCostReport(workItemId);
  if (!report) return err(`Cannot build workflow cost report for ${workItemId}`);

  const generatedAt = new Date().toISOString();
  const artifact = reportToWorkflowCostArtifact(report, generatedAt);
  const jsonPath = workflowCostJsonPath(workItemId);
  const markdownPath = workflowCostMarkdownPath(workItemId);

  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderWorkflowCostMarkdown(artifact), "utf8");

  wi.workflow_cost = jsonPath;
  wi.cost_usd = report.total_cost_usd;
  wi.updated = now();
  writeJson(workItemJsonPath(workItemId), wi);

  return ok({ json_path: jsonPath, markdown_path: markdownPath, artifact });
}

/**
 * After `.tasks/` is rebuilt (rehydrate), seed `<ID>-usage.jsonl` from the committed
 * `workflow-cost.json` so earlier spend is not silently dropped from reporting. One
 * `carried_forward` line per rollup row (with its `calls` count). No-op when usage lines
 * already exist or no committed rollup is present.
 * @returns number of lines written.
 */
export function carryForwardUsageFromCommittedRollup(workItemId: string): number {
  if (readUsageLines(workItemId).length > 0) return 0;
  const jsonPath = workflowCostJsonPath(workItemId);
  if (!existsSync(jsonPath)) return 0;
  const artifact = readJson<WorkflowCostArtifact>(jsonPath);
  if (!artifact?.rows?.length) return 0;

  let written = 0;
  for (const row of artifact.rows) {
    appendUsageLine(workItemId, {
      at: artifact.generated_at,
      work_item_id: workItemId,
      subagent_type: row.agent,
      ...(row.task_id != null ? { task_id: row.task_id } : {}),
      model: undefined,
      usage: {
        input: row.input_tokens,
        output: row.output_tokens,
        cacheRead: row.cache_read_tokens ?? 0,
        cacheWrite: row.cache_write_tokens ?? 0,
        cost: row.cost_usd,
        contextTokens: 0,
        turns: 0,
      },
      source: "carried_forward",
      calls: row.calls,
    });
    written++;
  }
  const wi = loadWorkItem(workItemId);
  if (wi) {
    wi.cost_usd = artifact.summary.total_cost_usd;
    wi.updated = now();
    writeJson(workItemJsonPath(workItemId), wi);
  }
  return written;
}
