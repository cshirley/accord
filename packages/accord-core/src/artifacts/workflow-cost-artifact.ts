/**
 * Persist checked-in workflow cost artifacts under docs/dev/<ID>/.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  buildWorkflowCostReport,
  type WorkflowCostReport,
  type WorkflowCostRow,
} from "../queries/workflow-cost.js";
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
