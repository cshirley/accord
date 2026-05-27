import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { validateArtifact } from "../src/core/artifacts/validation.js";
import {
  devPersistWorkflowCost,
  syncWorkflowCostMarkdownFromJson,
  workflowCostJsonPath,
} from "../src/core/artifacts/workflow-cost-artifact.js";
import {
  buildWorkflowCostReport,
  formatWorkflowCostForFinish,
} from "../src/core/queries/workflow-cost.js";
import { extractTaskIdFromTaskText } from "../src/core/telemetry/usage.js";
import { loadWorkItem } from "../src/core/work-items/io.js";
import { devBootstrap } from "../src/core/work-items/lifecycle.js";

let tempRoot: string;
let cwdBefore: string;

function tempProject(): string {
  return join(tempRoot, `proj-${String(Date.now())}-${Math.random().toString(36).slice(2)}`);
}

beforeEach(() => {
  cwdBefore = process.cwd();
  tempRoot = join(import.meta.dir, ".tmp-workflow-cost");
  mkdirSync(tempRoot, { recursive: true });
});

afterEach(() => {
  process.chdir(cwdBefore);
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("extractTaskIdFromTaskText", () => {
  test("parses markdown and plain task_id lines", () => {
    expect(extractTaskIdFromTaskText("work_item_id: X-1\n**task_id:** 2\n")).toBe(2);
    expect(extractTaskIdFromTaskText("task_id: 3")).toBe(3);
    expect(extractTaskIdFromTaskText("no id here")).toBeNull();
  });
});

describe("buildWorkflowCostReport", () => {
  test("aggregates by task and pipeline with token totals", () => {
    const project = tempProject();
    mkdirSync(join(project, ".tasks"), { recursive: true });
    process.chdir(project);
    devBootstrap("COST-1", "Cost rollup", "implement", "standard");

    const jsonl = join(project, ".tasks", "COST-1-usage.jsonl");
    const lines = [
      {
        at: "2026-01-01T00:00:00.000Z",
        work_item_id: "COST-1",
        subagent_type: "phase-align",
        usage: {
          input: 1000,
          output: 200,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 1,
        },
        source: "subagent",
      },
      {
        at: "2026-01-01T00:01:00.000Z",
        work_item_id: "COST-1",
        subagent_type: "phase-test",
        task_id: 1,
        usage: {
          input: 5000,
          output: 800,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 1,
        },
        source: "subagent",
      },
      {
        at: "2026-01-01T00:02:00.000Z",
        work_item_id: "COST-1",
        subagent_type: "phase-code",
        task_id: 1,
        usage: {
          input: 8000,
          output: 1200,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 1,
        },
        source: "subagent",
      },
      {
        at: "2026-01-01T00:03:00.000Z",
        work_item_id: "COST-1",
        subagent_type: "orchestrator",
        usage: {
          input: 300,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 1,
        },
        source: "orchestrator",
      },
    ];
    for (const row of lines) {
      appendFileSync(jsonl, `${JSON.stringify(row)}\n`, "utf8");
    }

    const report = buildWorkflowCostReport("COST-1");
    expect(report).not.toBeNull();
    if (!report) throw new Error("expected report");

    expect(report.rows.some((r) => r.scope === "Pipeline" && r.agent === "phase-align")).toBe(true);
    expect(report.rows.some((r) => r.scope === "Task 1" && r.agent === "phase-test")).toBe(true);
    expect(report.rows.some((r) => r.scope === "Task 1" && r.agent === "phase-code")).toBe(true);
    expect(report.rows.some((r) => r.scope === "Orchestrator")).toBe(true);

    expect(report.total_input_tokens).toBe(1000 + 5000 + 8000 + 300);
    expect(report.total_output_tokens).toBe(200 + 800 + 1200 + 100);
    expect(report.total_cost_usd).toBeGreaterThan(0);

    expect(report.formatted).toContain("## Workflow cost — COST-1");
    expect(report.formatted).toContain("| **Total** |");
    expect(formatWorkflowCostForFinish("COST-1")).toBe(report.formatted);
  });

  test("returns null when work item missing", () => {
    const project = tempProject();
    mkdirSync(join(project, ".tasks"), { recursive: true });
    process.chdir(project);
    expect(buildWorkflowCostReport("MISSING-9")).toBeNull();
  });
});

describe("devPersistWorkflowCost", () => {
  test("writes workflow-cost.json, workflow-cost.md, and links work item", async () => {
    const project = tempProject();
    mkdirSync(join(project, ".tasks"), { recursive: true });
    process.chdir(project);
    devBootstrap("COST-2", "Persist cost", "implement", "standard");

    const jsonl = join(project, ".tasks", "COST-2-usage.jsonl");
    appendFileSync(
      jsonl,
      `${JSON.stringify({
        at: "2026-01-01T00:00:00.000Z",
        work_item_id: "COST-2",
        subagent_type: "phase-align",
        usage: {
          input: 2000,
          output: 400,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 1,
        },
        source: "subagent",
      })}\n`,
      "utf8",
    );

    const result = devPersistWorkflowCost("COST-2");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const jsonPath = workflowCostJsonPath("COST-2");
    const mdPath = join(project, "docs", "dev", "COST-2", "workflow-cost.md");
    expect(existsSync(join(project, jsonPath))).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const wi = loadWorkItem("COST-2");
    expect(wi?.workflow_cost).toBe(jsonPath);
    expect(wi?.cost_usd).toBeGreaterThan(0);

    const validation = await validateArtifact(join(project, jsonPath));
    expect(validation.valid).toBe(true);

    const sync = syncWorkflowCostMarkdownFromJson(join(project, jsonPath));
    expect(sync.ok).toBe(true);
    expect(readFileSync(mdPath, "utf8")).toContain("# Workflow cost: COST-2");
  });
});
