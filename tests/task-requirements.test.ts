import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildImplementSpawnTaskBrief,
  filterTestCasesForAcIds,
  formatAcceptanceCriterionLine,
  sliceTaskRequirements,
} from "../src/core/briefing/task-requirements.js";
import type { DevHarnessConfig } from "../src/core/config/index.js";
import { resolveResumeOrchestration } from "../src/core/orchestration/resolve/resume.js";

function minimalDevConfig(): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: ["bun test"],
  };
}

let tempCwd: string;
let originalCwd: string;

function writeWorkItem(id: string, body: Record<string, unknown>): void {
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body)}\n`, "utf8");
}

describe("task-requirements", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(join(tmpdir(), "accord-task-req-"));
    process.chdir(tempCwd);
    mkdirSync(".tasks", { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempCwd)) rmSync(tempCwd, { recursive: true, force: true });
  });

  test("formatAcceptanceCriterionLine prefers scenario text", () => {
    const line = formatAcceptanceCriterionLine({
      id: "AC-1",
      type: "scenario",
      scenario: "User can log in",
    });
    expect(line).toContain("User can log in");
    expect(line).not.toContain("undefined");
  });

  test("filterTestCasesForAcIds filters by covers", () => {
    const cases = filterTestCasesForAcIds(
      {
        verification: {
          test_cases: [
            { id: "TC-1", covers: "AC-1", scenario: "a", tier: "unit" },
            { id: "TC-2", covers: "AC-2", scenario: "b", tier: "unit" },
          ],
        },
      },
      ["AC-1"],
    );
    expect(cases).toHaveLength(1);
    expect((cases[0] as { id: string }).id).toBe("TC-1");
  });

  test("buildImplementSpawnTaskBrief inlines test_cases for phase-test", () => {
    mkdirSync(join("docs", "dev", "TR-1"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "TR-1", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "does thing" },
        ],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "does thing", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "TR-1", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [{ path: "src/a.test.ts", action: "modify" }],
            steps: [{ tag: "test", description: "red" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeWorkItem("TR-1", {
      schema_version: "1.0",
      id: "TR-1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/TR-1/spec.json",
      plan: "docs/dev/TR-1/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeFileSync(
      join(".tasks", "TR-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "TR-1",
        task_id: 1,
        owner_nonce: "aabbcc",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: [],
        events: [],
      })}\n`,
      "utf8",
    );

    const brief = buildImplementSpawnTaskBrief({
      workItemId: "TR-1",
      dispatchAgent: "phase-test",
      phase: "implementing",
      title: "t",
      pattern: "implement",
      devConfig: minimalDevConfig(),
    });
    expect(brief).not.toBeNull();
    expect(brief).toContain("Task requirements");
    expect(brief).toContain('"test_cases"');
    expect(brief).toContain("aabbcc");
    expect(brief).toContain("does thing");

    const sliced = sliceTaskRequirements("TR-1", 1, minimalDevConfig());
    expect(sliced.ok).toBe(true);
    if (sliced.ok) {
      expect(sliced.value.owner_nonce).toBe("aabbcc");
      expect(sliced.value.test_cases).toHaveLength(1);
    }
  });

  test("buildImplementSpawnTaskBrief passes test_output and spec contract fields to review-test", () => {
    mkdirSync(join("docs", "dev", "TR-RT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "TR-RT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "does thing" },
        ],
        constraints: ["no real network"],
        scope: { out: [{ item: "legacy API", reason: "deprecated" }] },
        rejected_alternatives: [{ name: "polling", reason: "too slow" }],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "does thing", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "TR-RT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [{ path: "src/a.test.ts", action: "modify" }],
            steps: [{ tag: "test", description: "red" }],
          },
        ],
        guidance: [{ directive: "use colocated tests", source: "convention" }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("TR-RT", {
      schema_version: "1.0",
      id: "TR-RT",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/TR-RT/spec.json",
      plan: "docs/dev/TR-RT/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeFileSync(
      join(".tasks", "TR-RT-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "TR-RT",
        task_id: 1,
        owner_nonce: "ddeeff",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: ["src/a.test.ts"],
        red_confirmed: true,
        test_output: "FAIL: expected 401",
        ac_covered: ["AC-1"],
        events: [],
      })}\n`,
      "utf8",
    );

    const brief = buildImplementSpawnTaskBrief({
      workItemId: "TR-RT",
      dispatchAgent: "review-test",
      phase: "implementing",
      title: "t",
      pattern: "implement",
      devConfig: minimalDevConfig(),
    });
    expect(brief).not.toBeNull();
    expect(brief).toContain('"test_output": "FAIL: expected 401"');
    expect(brief).toContain('"constraints"');
    expect(brief).toContain('"scope_out"');
    expect(brief).toContain('"rejected_alternatives"');
    expect(brief).toContain('"ac_covered"');
    expect(brief).toContain("convention");
  });

  test("resolveResumeOrchestration uses rich brief for implementing phase-test", () => {
    mkdirSync(join("docs", "dev", "WI-RT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "WI-RT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "scenario", scenario: "s" }],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "s", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "WI-RT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [{ tag: "test", description: "t" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeWorkItem("WI-RT", {
      schema_version: "1.0",
      id: "WI-RT",
      title: "rt",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/WI-RT/spec.json",
      plan: "docs/dev/WI-RT/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeFileSync(
      join(".tasks", "WI-RT-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "WI-RT",
        task_id: 1,
        owner_nonce: "112233",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        events: [],
      })}\n`,
      "utf8",
    );

    const r = resolveResumeOrchestration("WI-RT", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("phase-test");
      expect(r.task).toContain("Task requirements");
      expect(r.task).not.toContain("Read the work item JSON under `.tasks/`");
    }
  });
});
