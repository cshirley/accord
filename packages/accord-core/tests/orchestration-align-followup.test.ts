import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  planSpawnFollowUp,
  postSpawnReplanDecision,
  runResumeOrchestrationWithReplans,
} from "@clive.shirley/accord-core/orchestration/index.js";

function minimalDevConfig(): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
  };
}

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-align-followup-"));
  process.chdir(tempCwd);
  mkdirSync(join(tempCwd, ".tasks"), { recursive: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function writeWorkItem(id: string, body: Record<string, unknown>) {
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

describe("align gather spawn follow-up", () => {
  test("planSpawnFollowUp chains align needs_gather to phase-gather", () => {
    const plan = planSpawnFollowUp({
      workItemId: "STEP-1",
      agent: "phase-align",
      exitCode: 0,
      parsedReturn: {
        status: "needs_gather",
        gather_hint: { ticket_id: "STEP-1", reason: "ticket context required" },
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      phase: "aligning",
      title: "t",
      pattern: "implement",
      devConfig: minimalDevConfig(),
    });
    expect(plan?.agent).toBe("phase-gather");
    expect(plan?.task).toContain("STEP-1");
    expect(plan?.task).toContain("phase-gather");
  });

  test("planSpawnFollowUp chains gather done to phase-align with gather_result", () => {
    const plan = planSpawnFollowUp({
      workItemId: "STEP-2",
      agent: "phase-gather",
      exitCode: 0,
      parsedReturn: {
        status: "done",
        context: "Ticket summary",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      phase: "aligning",
      title: "t",
      pattern: "implement",
      devConfig: minimalDevConfig(),
    });
    expect(plan?.agent).toBe("phase-align");
    expect(plan?.task).toContain("gather_result:");
    expect(plan?.task).toContain("Ticket summary");
  });

  test("postSpawnReplanDecision stops on phase-align needs_input", () => {
    expect(
      postSpawnReplanDecision(
        { status: "needs_input", usage: { prompt_tokens: 1, completion_tokens: 1 } },
        "phase-align",
      ),
    ).toBe("stop");
  });

  test("runResumeOrchestrationWithReplans chains align→gather→align in one resume", async () => {
    writeWorkItem("STEP-CHAIN", {
      schema_version: "1.0",
      id: "STEP-CHAIN",
      title: "chain test",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "aligning",
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });

    const spawns: string[] = [];
    const host = {
      notify: () => {},
      spawnSubagent: async (input: { agent: string; task: string }) => {
        spawns.push(input.agent);
        if (
          input.agent === "phase-align" &&
          spawns.filter((a) => a === "phase-align").length === 1
        ) {
          return {
            exitCode: 0,
            parsedReturn: {
              status: "needs_gather",
              gather_hint: { ticket_id: "STEP-CHAIN", reason: "need ticket" },
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            },
          };
        }
        if (input.agent === "phase-gather") {
          return {
            exitCode: 0,
            parsedReturn: {
              status: "done",
              context: "gathered",
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            },
          };
        }
        return {
          exitCode: 0,
          parsedReturn: {
            status: "needs_input",
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          },
        };
      },
    };

    const out = await runResumeOrchestrationWithReplans("STEP-CHAIN", minimalDevConfig(), host);
    expect(spawns).toEqual(["phase-align", "phase-gather", "phase-align"]);
    expect(out.stalledReason).toBe("needs_input");
    expect(out.iterations).toBe(1);
    expect(out.lastRun.lastSpawn?.agent).toBe("phase-align");
  });
});
