import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  carryForwardUsageFromCommittedRollup,
  devPersistWorkflowCost,
} from "@clive.shirley/accord-core/artifacts/workflow-cost-artifact.js";
import { processSubagentToolResult } from "@clive.shirley/accord-core/harness/index.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/harness/types.js";
import { buildWorkflowCostReport } from "@clive.shirley/accord-core/queries/workflow-cost.js";
import {
  extractWorkItemId,
  loadPricing,
  readUsageLines,
  type UsageLine,
} from "@clive.shirley/accord-core/telemetry/usage.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { writeTaskFixture } from "./helpers/task-fixture.js";

const WI = "USE-1";
let project: string;
let originalCwd: string;

function state(): HarnessMutableState {
  return { devConfig: null, costCache: new Map(), sessionCost: 0, activeWorkItem: null };
}

async function processResult(result: Record<string, unknown>): Promise<string> {
  return processSubagentToolResult({
    details: { results: [result] },
    state: state(),
    pricing: loadPricing(),
  });
}

function fenced(payload: unknown): string {
  return `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
}

function setTaskIds(ids: number[]): void {
  const wiPath = join(".tasks", `${WI}.json`);
  const wi = JSON.parse(readFileSync(wiPath, "utf8")) as { task_ids: number[] };
  wi.task_ids = ids;
  writeFileSync(wiPath, JSON.stringify(wi));
}

function usageLine(overrides: Partial<UsageLine>): UsageLine {
  return {
    at: "2026-01-01T00:00:00.000Z",
    work_item_id: WI,
    subagent_type: "phase-test",
    model: "m",
    usage: {
      input: 10,
      output: 20,
      cacheRead: 1000,
      cacheWrite: 100,
      cost: 0.5,
      contextTokens: 0,
      turns: 1,
    },
    source: "subagent",
    ...overrides,
  };
}

beforeEach(() => {
  originalCwd = process.cwd();
  project = mkdtempSync(join(tmpdir(), "accord-usage-"));
  process.chdir(project);
  devBootstrap(WI, "usage accounting", "implement", "standard");
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(project, { recursive: true, force: true });
});

describe("extractWorkItemId", () => {
  test("an explicit work_item_id wins over earlier ticket mentions", () => {
    devBootstrap("CLD-4171", "other", "implement", "standard");
    const brief = `Context: follows CLD-4171.\n\nwork_item_id: ${WI}\n`;
    expect(extractWorkItemId(brief, { mustExist: true })).toBe(WI);
  });

  test("skips mentioned ids that have no work item", () => {
    const brief = `Depends on CLD-9999 and OPS-12 — implementing ${WI}.`;
    expect(extractWorkItemId(brief, { mustExist: true })).toBe(WI);
    expect(extractWorkItemId(brief)).toBe("CLD-9999");
  });
});

describe("subagent usage logging", () => {
  test("logs a spawn that returned no usage block as a usage_missing call", async () => {
    await processResult({
      agent: "phase-verify-acceptance",
      task: `work_item_id: ${WI}`,
      exitCode: 1,
      messages: [],
    });
    const [line] = readUsageLines(WI);
    expect(line).toMatchObject({
      subagent_type: "phase-verify-acceptance",
      source: "subagent",
      usage_missing: true,
      exit_code: 1,
    });
  });

  test("falls back to the packet's self-reported usage", async () => {
    await processResult({
      agent: "phase-verify-acceptance",
      task: `work_item_id: ${WI}`,
      exitCode: 0,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: fenced({
                status: "stuck",
                question: "q",
                context: "c",
                usage: { prompt_tokens: 1200, completion_tokens: 300 },
              }),
            },
          ],
        },
      ],
    });
    const [line] = readUsageLines(WI);
    expect(line?.usage.input).toBe(1200);
    expect(line?.usage.output).toBe(300);
    expect(line?.usage_self_reported).toBe(true);
    expect(line?.usage_missing).toBeUndefined();
  });

  test("attributes a brief without task_id to the task whose spawn is in flight", async () => {
    setTaskIds([1, 2]);
    writeTaskFixture({ workItemId: WI, taskId: 1, phase: "phase-test" }, project);
    const task2 = writeTaskFixture({ workItemId: WI, taskId: 2, phase: "phase-test" }, project);
    task2.control.in_flight = {
      ref: "T1/phase-test",
      agent: "phase-test",
      stage: "spawned",
      at: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(join(".tasks", `${WI}-task-2.json`), JSON.stringify(task2));

    await processResult({
      agent: "phase-test",
      task: `## phase-test\n\n**work_item_id:** ${WI}\n`,
      exitCode: 0,
      usage: { input: 5, output: 7, cost: 0.01 },
      messages: [],
    });
    expect(readUsageLines(WI)[0]?.task_id).toBe(2);
  });

  test("every re-run is a separate call in the workflow-cost report", async () => {
    for (let run = 0; run < 3; run++) {
      await processResult({
        agent: "phase-verify-acceptance",
        task: `work_item_id: ${WI}`,
        exitCode: 0,
        usage: { input: 10, output: 100, cacheRead: 5000, cacheWrite: 50, cost: 0.2 },
        messages: [],
      });
    }
    const report = buildWorkflowCostReport(WI);
    const row = report?.rows.find((candidate) => candidate.agent === "phase-verify-acceptance");
    expect(row?.calls).toBe(3);
    expect(row?.cache_read_tokens).toBe(15000);
    expect(report?.total_calls).toBe(3);
  });
});

describe("workflow cost report", () => {
  test("counts carried-forward calls, cache tokens, and missing-usage calls", () => {
    const jsonl = join(".tasks", `${WI}-usage.jsonl`);
    const lines = [
      usageLine({ source: "carried_forward", calls: 4, subagent_type: "phase-align" }),
      usageLine({ usage_missing: true, usage: { ...usageLine({}).usage, cost: 0 } }),
      usageLine({ subagent_type: "orchestration-judgment", source: "judgment" }),
    ];
    writeFileSync(jsonl, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

    const report = buildWorkflowCostReport(WI);
    expect(report?.total_calls).toBe(6);
    expect(report?.usage_missing_calls).toBe(1);
    expect(report?.carried_forward).toBe(true);
    expect(report?.total_cache_read_tokens).toBe(3000);
    expect(report?.rows.find((row) => row.agent === "orchestration-judgment")?.scope).toBe(
      "Orchestrator",
    );
    expect(report?.formatted).toContain("1 call(s) reported no usage");
  });
});

describe("carryForwardUsageFromCommittedRollup", () => {
  test("seeds an empty usage log from the committed workflow-cost.json", () => {
    writeFileSync(
      join(".tasks", `${WI}-usage.jsonl`),
      `${JSON.stringify(usageLine({ subagent_type: "phase-spec", calls: 1 }))}\n`,
    );
    const persisted = devPersistWorkflowCost(WI);
    if (!persisted.ok) throw new Error(persisted.error);
    rmSync(join(".tasks", `${WI}-usage.jsonl`));

    expect(carryForwardUsageFromCommittedRollup(WI)).toBe(1);
    const [carried] = readUsageLines(WI);
    expect(carried).toMatchObject({ source: "carried_forward", subagent_type: "phase-spec" });
    expect(buildWorkflowCostReport(WI)?.total_cost_usd).toBe(0.5);
    // Idempotent: usage exists now.
    expect(carryForwardUsageFromCommittedRollup(WI)).toBe(0);
  });

  test("is a no-op without a committed rollup", () => {
    mkdirSync(join("docs", "dev", WI), { recursive: true });
    expect(carryForwardUsageFromCommittedRollup(WI)).toBe(0);
  });
});
