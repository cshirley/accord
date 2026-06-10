import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DevHarnessConfig } from "../src/core/config/index.js";
import {
  commitOnTaskDoneFromDevConfig,
  defaultResumeReplanPolicy,
  resumeAllowsAutoReplanToAgent,
  resumeReplanPolicyFromDevConfig,
  runResumeOrchestrationWithReplans,
} from "../src/core/orchestration/index.js";

function minimalDevConfig(overrides?: DevHarnessConfig["orchestration"]): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
    orchestration: overrides,
  };
}

function writeWorkItem(id: string, body: Record<string, unknown>): void {
  mkdirSync(".tasks", { recursive: true });
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body)}\n`, "utf8");
}

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-resume-policy-"));
  process.chdir(tempCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

describe("resume replan policy", () => {
  test("defaults pause before phase-code", () => {
    const p = defaultResumeReplanPolicy();
    expect(p.maxSequentialSpawns).toBe(8);
    expect(resumeAllowsAutoReplanToAgent("phase-test", null)).toBe(true);
    expect(resumeAllowsAutoReplanToAgent("phase-code", null)).toBe(false);
  });

  test("empty no_auto_chain_agents allows phase-code", () => {
    const config = minimalDevConfig({ resume: { no_auto_chain_agents: [] } });
    expect(resumeAllowsAutoReplanToAgent("phase-code", config)).toBe(true);
    expect(resumeReplanPolicyFromDevConfig(config).maxSequentialSpawns).toBe(8);
  });

  test("max_sequential_spawns from config", () => {
    const config = minimalDevConfig({ resume: { max_sequential_spawns: 24 } });
    expect(resumeReplanPolicyFromDevConfig(config).maxSequentialSpawns).toBe(24);
  });

  test("commit.on_task_done flag", () => {
    expect(commitOnTaskDoneFromDevConfig(null)).toBe(false);
    expect(
      commitOnTaskDoneFromDevConfig(minimalDevConfig({ commit: { on_task_done: true } })),
    ).toBe(true);
  });
});

describe("runResumeOrchestrationWithReplans auto-chains phase-code when configured", () => {
  test("spawns review-test then phase-code in one command", async () => {
    mkdirSync(join("docs", "dev", "ACCORD-AUTO"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "ACCORD-AUTO", "spec.json"),
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
      join("docs", "dev", "ACCORD-AUTO", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "Implement feature",
            covers_ac: ["AC-1"],
            challenge: false,
            files: ["src/a.ts"],
            steps: [],
          },
        ],
        guidance: [],
      })}\n`,
      "utf8",
    );
    writeWorkItem("ACCORD-AUTO", {
      schema_version: "1.0",
      id: "ACCORD-AUTO",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/ACCORD-AUTO/spec.json",
      plan: "docs/dev/ACCORD-AUTO/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const taskPath = join(".tasks", "ACCORD-AUTO-task-1.json");
    writeFileSync(
      taskPath,
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "ACCORD-AUTO",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "complete",
        test_files: ["src/a.test.ts"],
        quick_fix_loop: { test_review_cycles_used: 0 },
        events: [],
      })}\n`,
      "utf8",
    );

    const agents: string[] = [];
    const host = {
      notify: () => {},
      spawnSubagent: async (input: { agent: string }) => {
        agents.push(input.agent);
        if (input.agent === "review-test") {
          const raw = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;
          raw.phase = "phase-code";
          writeFileSync(taskPath, `${JSON.stringify(raw)}\n`, "utf8");
        }
        return { exitCode: 0 };
      },
    };

    const config = minimalDevConfig({ resume: { no_auto_chain_agents: [] } });
    const out = await runResumeOrchestrationWithReplans("ACCORD-AUTO", config, host);
    expect(agents).toEqual(["review-test", "phase-code"]);
    expect(out.iterations).toBe(2);
    expect(out.lastRun.lastSpawn?.agent).toBe("phase-code");
  });
});
