import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  applyPhaseCodePostResult,
  applyPhaseTestPostResult,
  applyReviewTestPostResult,
  buildDevOrchestratePayload,
  defaultQuickFixLoopPolicy,
  parseLeadingWorkItemId,
  quickFixLoopPolicyFromDevConfig,
  REFERENCE_ORCHESTRATION_GRAPH,
  resolveFinishOrchestration,
  resolveResumeAgentId,
  resolveResumeOrchestration,
  resumeResolutionToNextSteps,
  reviewRetryPolicyForAgent,
  runFinishOrchestrationFromResolution,
  runResumeOrchestrationWithReplans,
  runUntilStop,
  selectOrchestrationEdge,
  transitionOrchestrationGraph,
  validateOrchestrationGraph,
} from "@clive.shirley/accord-core/orchestration/index.js";
import type { OrchestrationGraphDefinition } from "@clive.shirley/accord-core/orchestration/types.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

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
  tempCwd = mkdtempSync(join(tmpdir(), "accord-orch-"));
  process.chdir(tempCwd);
  mkdirSync(join(tempCwd, ".tasks"), { recursive: true });
  // accord-core's preflight dispatch is a process-wide singleton (see subagent-preflight-shared.ts).
  // When this suite runs alongside pi-accord's tests in the same bun process, pi-accord's real
  // backend can end up registered here too, making these host-neutral orchestration tests
  // depend on the local machine's actual credentials/subagent.json. Reset to the deterministic
  // permissive default for hermetic, host-agnostic assertions.
  resetSpawnPreflightCheckForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function writeWorkItem(id: string, body: Record<string, unknown>) {
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

function readTaskRaw(workItemId: string, taskId = 1): TaskFileV2 {
  return readTaskFixture(workItemId, taskId);
}

describe("orchestration graph", () => {
  test("validateOrchestrationGraph succeeds for bundled reference graph + resume routing agents", () => {
    expect(validateOrchestrationGraph()).toEqual({ ok: true });
  });

  test("validateOrchestrationGraph reports unreachable nodes", () => {
    const orphanGraph: OrchestrationGraphDefinition = {
      entryNodeId: "only",
      nodes: [{ id: "only" }, { id: "lonely", agentId: "phase-gather" }],
      edges: [],
    };
    const result = validateOrchestrationGraph(orphanGraph);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((line) => line.includes("unreachable"))).toBe(true);
    }
  });

  test("selectOrchestrationEdge and transition follow reference graph", () => {
    const edge = selectOrchestrationEdge(REFERENCE_ORCHESTRATION_GRAPH, "idle", {
      type: "tap_gather",
    });
    expect(edge?.to).toBe("awaiting_gather");
    expect(
      transitionOrchestrationGraph(REFERENCE_ORCHESTRATION_GRAPH, "idle", { type: "tap_gather" }),
    ).toBe("awaiting_gather");
  });
});

describe("resume orchestration", () => {
  test("parseLeadingWorkItemId reads first token", () => {
    expect(parseLeadingWorkItemId("  ABC-1  rest ")).toBe("ABC-1");
    expect(parseLeadingWorkItemId("")).toBeNull();
  });

  test("resolveResumeAgentId maps coarse phases and passes through registry ids", () => {
    expect(resolveResumeAgentId("speccing", "implement")).toBe("phase-spec");
    expect(resolveResumeAgentId("aligning", "implement")).toBe("phase-align");
    expect(resolveResumeAgentId("gathering", "quick_fix")).toBe("phase-gather");
    expect(resolveResumeAgentId("researching", "analyse")).toBe("phase-gather");
    expect(resolveResumeAgentId("researching", "implement")).toBeNull();
    expect(resolveResumeAgentId("implementing", "implement")).toBeNull();
    expect(resolveResumeAgentId("phase-gather", "implement")).toBe("phase-gather");
  });

  test("resolveResumeOrchestration spawns phase-spec for speccing when devConfig present", () => {
    writeWorkItem("WI-1", {
      schema_version: "1.0",
      id: "WI-1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "speccing",
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const blocked = resolveResumeOrchestration("WI-1", null);
    expect(blocked.outcome).toBe("blocked");

    const r = resolveResumeOrchestration("WI-1", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("phase-spec");
      expect(r.task).toContain("ACCORD harness — phase-spec");
      expect(r.task).toContain("work_item_phase: speccing");
      expect(r.task).toContain("draft:");
      expect(r.task).toContain("answered:");
    }
  });

  test("resolveResumeOrchestration forwards for unknown pattern", () => {
    writeWorkItem("WI-1b", {
      schema_version: "1.0",
      id: "WI-1b",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "not-a-pattern",
      phase: "speccing",
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const r = resolveResumeOrchestration("WI-1b", minimalDevConfig());
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") {
      expect(r.messages[0]?.text).toContain("Unknown work item pattern");
    }
  });

  test("resolveResumeOrchestration blocks implementing when plan and tasks are missing", () => {
    writeWorkItem("WI-1c", {
      schema_version: "1.0",
      id: "WI-1c",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const r = resolveResumeOrchestration("WI-1c", minimalDevConfig());
    expect(r.outcome).toBe("blocked");
    if (r.outcome === "blocked") {
      expect(r.messages[0]?.text).toContain("implementing");
      expect(r.messages[0]?.text).toContain("plan");
    }
  });

  test("resolveResumeOrchestration spawns for registered agent phase (e.g. phase-gather)", () => {
    writeWorkItem("WI-2", {
      schema_version: "1.0",
      id: "WI-2",
      title: "gather test",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "investigate",
      phase: "phase-gather",
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const r = resolveResumeOrchestration("WI-2", null);
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("phase-gather");
      expect(r.task).toContain("work_item_id: WI-2");
    }
  });

  test("resolveResumeOrchestration completes for terminal work items", () => {
    writeWorkItem("WI-3", {
      schema_version: "1.0",
      id: "WI-3",
      title: "done",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
      terminal_outcome: "done",
      completed_at: "2026-01-02T00:00:00.000Z",
    });
    const r = resolveResumeOrchestration("WI-3", null);
    expect(r.outcome).toBe("complete");
  });

  test("resumeResolutionToNextSteps + runUntilStop executes spawn then stops", async () => {
    const spawns: Array<{ agent: string; task: string }> = [];
    const host = {
      notify: () => {},
      spawnSubagent: async (input: { agent: string; task: string }) => {
        spawns.push(input);
        return { exitCode: 0 };
      },
    };
    const steps = resumeResolutionToNextSteps({
      outcome: "spawn",
      workItemId: "WI-X",
      agent: "phase-gather",
      task: "resume body",
    });
    const done = await runUntilStop(steps, host);
    expect(done.stopReason).toBe("spawned_subagent");
    expect(done.lastSpawn).toEqual({ agent: "phase-gather", exitCode: 0 });
    expect(spawns).toEqual([{ agent: "phase-gather", task: "resume body" }]);
  });

  test("resolveResumeOrchestration uses primary task phase for implement implementing resume", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "IMP-RES-1"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "IMP-RES-1", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "scenario", scenario: "s" }],
        verification: { commands: ["bun test"] },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "IMP-RES-1", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [{ path: "src/a.ts", action: "modify" }],
            steps: [{ tag: "impl", description: "impl" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeWorkItem("IMP-RES-1", {
      schema_version: "1.0",
      id: "IMP-RES-1",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/IMP-RES-1/spec.json",
      plan: "docs/dev/IMP-RES-1/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "IMP-RES-1",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-code",
      preImplGates: "complete",
      coversAc: ["AC-1"],
    });
    const blocked = resolveResumeOrchestration("IMP-RES-1", null);
    expect(blocked.outcome).toBe("blocked");
    const spawned = resolveResumeOrchestration("IMP-RES-1", minimalDevConfig());
    expect(spawned.outcome).toBe("spawn");
    if (spawned.outcome === "spawn") {
      expect(spawned.agent).toBe("phase-code");
      expect(spawned.task).toContain("Task requirements");
      expect(spawned.task).toContain("abcdef");
    }
  });

  test("runResumeOrchestrationWithReplans chains spawns when disk state advances between plans", async () => {
    mkdirSync(join(tempCwd, "docs", "dev", "ACCORD-990"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "ACCORD-990", "spec.json"),
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
      join("docs", "dev", "ACCORD-990", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [],
          },
        ],
        guidance: [{ source: "engineer", directive: "check boundaries" }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("ACCORD-990", {
      schema_version: "1.0",
      id: "ACCORD-990",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/ACCORD-990/spec.json",
      plan: "docs/dev/ACCORD-990/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "ACCORD-990",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
      },
    });

    let spawnCount = 0;
    const host = {
      notify: () => {},
      spawnSubagent: async (input: { agent: string; task: string }) => {
        spawnCount += 1;
        // first spawn (phase-test) transitions task to review-test
        if (spawnCount === 1) {
          expect(input.agent).toBe("phase-test");
          const task = readTaskRaw("ACCORD-990", 1);
          task.control.phase = "review-test";
          task.control.test_files = ["pkg/x.test.ts"];
          writeFileSync(
            join(".tasks", "ACCORD-990-task-1.json"),
            `${JSON.stringify(task)}\n`,
            "utf8",
          );
        } else {
          expect(input.agent).toBe("review-test");
        }
        return { exitCode: 0 };
      },
    };

    const out = await runResumeOrchestrationWithReplans("ACCORD-990", minimalDevConfig(), host);
    expect(spawnCount).toBe(2);
    expect(out.iterations).toBe(2);
    expect(out.stalledReason).toBe("repeat_spawn");
    expect(out.lastRun.lastSpawn?.agent).toBe("review-test");
  });

  test("runResumeOrchestrationWithReplans does not auto-chain into phase-code in one command", async () => {
    mkdirSync(join(tempCwd, "docs", "dev", "ACCORD-991"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "ACCORD-991", "spec.json"),
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
      join("docs", "dev", "ACCORD-991", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [],
          },
        ],
        guidance: [],
      })}\n`,
      "utf8",
    );
    writeWorkItem("ACCORD-991", {
      schema_version: "1.0",
      id: "ACCORD-991",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/ACCORD-991/spec.json",
      plan: "docs/dev/ACCORD-991/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "ACCORD-991",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "complete",
      testFiles: ["pkg/x.test.ts"],
    });

    let spawnCount = 0;
    const notices: string[] = [];
    const host = {
      notify: (_level: string, text: string) => {
        notices.push(text);
      },
      spawnSubagent: async (input: { agent: string }) => {
        spawnCount += 1;
        expect(input.agent).toBe("review-test");
        const task = readTaskRaw("ACCORD-991", 1);
        task.control.phase = "phase-code";
        writeFileSync(
          join(".tasks", "ACCORD-991-task-1.json"),
          `${JSON.stringify(task)}\n`,
          "utf8",
        );
        return { exitCode: 0 };
      },
    };

    const out = await runResumeOrchestrationWithReplans("ACCORD-991", minimalDevConfig(), host);
    expect(spawnCount).toBe(1);
    expect(out.iterations).toBe(1);
    expect(out.lastRun.lastSpawn?.agent).toBe("review-test");
    expect(notices.some((n) => n.includes("phase-code"))).toBe(true);
  });
});

describe("quick-fix orchestration", () => {
  // NOTE: decideQuickFixAfterReviewTest / decideQuickFixAfterReviewPacket / bumpQuickFixTestReviewCycle
  // were removed — the quick_fix test-review loop now goes through the shared v2 loop machinery
  // (`decideLoop` / `capForKey` in `src/tasks/decide.ts`, exercised end-to-end below via
  // `applyReviewTestPostResult`, and fully in `tests/task-trace-v2.test.ts`). Direct unit tests of
  // the removed policy functions are gone; the severity-gate / cap behaviour they covered is
  // asserted through the real post-result handlers instead (see tests below and
  // `quickFixLoopPolicyFromDevConfig` / `reviewRetryPolicyForAgent`, which are unchanged).

  test("applyPhaseTestPostResult advances new_red_test task to review-test", () => {
    writeWorkItem("QAP-PT", {
      schema_version: "1.0",
      id: "QAP-PT",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/QAP-PT/spec.json",
      plan: "docs/dev/QAP-PT/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    mkdirSync(join(tempCwd, "docs", "dev", "QAP-PT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "QAP-PT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "scenario", scenario: "x" }],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "x", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "QAP-PT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [{ id: 1, title: "t", covers_ac: ["AC-1"], challenge: false, files: [], steps: [] }],
        guidance: [],
      })}\n`,
      "utf8",
    );
    writeTaskFixture({
      workItemId: "QAP-PT",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
      },
    });
    const note = applyPhaseTestPostResult("QAP-PT", {
      status: "done",
      test_files: ["src/foo.test.ts"],
      red_confirmed: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("review-test");
    const task = readTaskRaw("QAP-PT");
    expect(task.control.phase).toBe("review-test");
    expect(task.control.test_files).toEqual(["src/foo.test.ts"]);
  });

  test("applyPhaseTestPostResult advances implement implementing task to review-test", () => {
    writeWorkItem("QAP-IMP", {
      schema_version: "1.0",
      id: "QAP-IMP",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/QAP-IMP/spec.json",
      plan: "docs/dev/QAP-IMP/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    mkdirSync(join(tempCwd, "docs", "dev", "QAP-IMP"), { recursive: true });
    writeFileSync(join("docs", "dev", "QAP-IMP", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "QAP-IMP", "plan.json"), "{}\n", "utf8");
    writeTaskFixture({
      workItemId: "QAP-IMP",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      coversAc: ["AC-1"],
    });
    const note = applyPhaseTestPostResult("QAP-IMP", {
      status: "done",
      test_files: ["src/imp.test.ts"],
      red_confirmed: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("Implement (phase-test)");
    expect(note).toContain("review-test");
    const task = readTaskRaw("QAP-IMP");
    expect(task.control.phase).toBe("review-test");
    expect(task.control.test_files).toEqual(["src/imp.test.ts"]);
  });

  test("applyPhaseTestPostResult blocks (does not advance) when test_output shows a crashed runner despite red_confirmed:true", () => {
    writeWorkItem("QAP-CRASH", {
      schema_version: "1.0",
      id: "QAP-CRASH",
      title: "crash",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/QAP-CRASH/spec.json",
      plan: "docs/dev/QAP-CRASH/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    mkdirSync(join(tempCwd, "docs", "dev", "QAP-CRASH"), { recursive: true });
    writeFileSync(join("docs", "dev", "QAP-CRASH", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "QAP-CRASH", "plan.json"), "{}\n", "utf8");
    writeTaskFixture({
      workItemId: "QAP-CRASH",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      coversAc: ["AC-1"],
    });
    const note = applyPhaseTestPostResult("QAP-CRASH", {
      status: "done",
      test_files: ["src/servers.unit.test.ts"],
      red_confirmed: true,
      test_output:
        "node:internal/process/promises:394\n" +
        "    triggerUncaughtException(err, true /* fromPromise */);\n" +
        "Error: listen EADDRINUSE: address already in use :::3052\n" +
        "Node.js v24.21.0\n",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("CRASH detected");
    expect(note).toContain("blocked");
    // Must NOT advance to review-test on a crashed run, and must not trust the self-reported
    // red_confirmed:true (v2: recorded as `control.blocked = {kind: "crash", ...}`, not a
    // top-level `test_runner_crash` field / `red_confirmed` field).
    const task = readTaskRaw("QAP-CRASH");
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.status).toBe("blocked");
    expect(task.control.last_test_run?.confirmed).toBe(false);
    expect(task.control.blocked?.kind).toBe("crash");
    expect(task.control.blocked?.reason).toContain("uncaught exception");
    expect(
      task.log.some(
        (entry) => entry.result === "blocked" && entry.note.includes("uncaught exception"),
      ),
    ).toBe(true);
  });

  test("resolveResumeOrchestration uses pre-impl brief when resuming review-test on quick_fix", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "QF-RT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "QF-RT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "finish" },
        ],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "finish", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "QF-RT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "qf task",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [],
          },
        ],
        guidance: [{ source: "engineer", directive: "add edge case tests" }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("QF-RT", {
      schema_version: "1.0",
      id: "QF-RT",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/QF-RT/spec.json",
      plan: "docs/dev/QF-RT/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "QF-RT",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      testFiles: ["src/qf.test.ts"],
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
      },
    });
    const r = resolveResumeOrchestration("QF-RT", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("review-test");
      expect(r.task).toContain("pre-impl");
      expect(r.task).toContain("## review-test — quick fix (pre-impl)");
      expect(r.task).toContain("src/qf.test.ts");
      expect(r.task).toContain("add edge case tests");
    }
  });

  test("resolveResumeOrchestration uses pre-impl brief when resuming review-test on implement", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "IMP-RT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "IMP-RT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "finish" },
        ],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "finish", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "IMP-RT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "impl task",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [],
          },
        ],
        guidance: [{ source: "engineer", directive: "verify error paths" }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("IMP-RT", {
      schema_version: "1.0",
      id: "IMP-RT",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/IMP-RT/spec.json",
      plan: "docs/dev/IMP-RT/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "IMP-RT",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      testFiles: ["src/impl.test.ts"],
      coversAc: ["AC-1"],
    });
    const r = resolveResumeOrchestration("IMP-RT", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("review-test");
      expect(r.task).toContain("pre-impl");
      expect(r.task).toContain("## review-test — implement (pre-impl)");
      expect(r.task).toContain("src/impl.test.ts");
      expect(r.task).toContain("verify error paths");
    }
  });

  test("resolveResumeOrchestration blocks review-test resume when a decision is pending", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "IMP-PD"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "IMP-PD", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "finish" },
        ],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "finish", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "IMP-PD", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "impl task",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [],
          },
        ],
        guidance: [],
      })}\n`,
      "utf8",
    );
    writeWorkItem("IMP-PD", {
      schema_version: "1.0",
      id: "IMP-PD",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/IMP-PD/spec.json",
      plan: "docs/dev/IMP-PD/plan.json",
      verify: null,
      brief: null,
      decisions: [
        {
          id: "q_guidance_1",
          source: "plan",
          status: "pending",
          question: "Which retry strategy?",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "IMP-PD",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      testFiles: ["src/impl.test.ts"],
      coversAc: ["AC-1"],
    });

    const blocked = resolveResumeOrchestration("IMP-PD", minimalDevConfig());
    expect(blocked.outcome).toBe("blocked");
    if (blocked.outcome === "blocked") {
      const text = blocked.messages.map((m) => m.text).join("\n");
      expect(text).toContain("Resume blocked");
      expect(text).toContain("q_guidance_1");
      expect(text).toContain("review-test");
      expect(text).toContain("--allow-pending-decisions");
    }

    const allowed = resolveResumeOrchestration("IMP-PD", minimalDevConfig(), {
      allowPendingDecisions: true,
    });
    expect(allowed.outcome).toBe("spawn");
    if (allowed.outcome === "spawn") {
      expect(allowed.agent).toBe("review-test");
    }
  });

  test("resolveResumeOrchestration does not gate phase-spec/phase-plan on their own pending decisions", () => {
    writeWorkItem("WI-1", {
      schema_version: "1.0",
      id: "WI-1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "speccing",
      task_ids: [],
      brief: "docs/dev/WI-1/brief.md",
      spec: null,
      plan: null,
      verify: null,
      decisions: [
        {
          id: "q1",
          source: "spec",
          status: "pending",
          question: "q?",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      deviations: [],
      cost_usd: 0,
    });
    mkdirSync(join(tempCwd, "docs", "dev", "WI-1"), { recursive: true });
    writeFileSync(join("docs", "dev", "WI-1", "brief.md"), "# Brief\n");

    const r = resolveResumeOrchestration("WI-1", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("phase-spec");
    }
  });

  test("resolveResumeOrchestration uses task phase for quick_fix fixing resume", () => {
    writeWorkItem("ACCORD-1", {
      schema_version: "1.0",
      id: "ACCORD-1",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/ACCORD-1/spec.json",
      plan: "docs/dev/ACCORD-1/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "ACCORD-1",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
      },
    });
    const blocked = resolveResumeOrchestration("ACCORD-1", null);
    expect(blocked.outcome).toBe("blocked");
    const spawned = resolveResumeOrchestration("ACCORD-1", minimalDevConfig());
    expect(spawned.outcome).toBe("spawn");
    if (spawned.outcome === "spawn") {
      expect(spawned.agent).toBe("phase-test");
    }
  });

  test("quickFixLoopPolicyFromDevConfig reads orchestration.quick_fix_loop", () => {
    expect(quickFixLoopPolicyFromDevConfig(null)).toEqual(defaultQuickFixLoopPolicy());
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { quick_fix_loop: { max_test_review_loops: 2, severity_gate: "block" } },
    };
    expect(quickFixLoopPolicyFromDevConfig(cfg)).toEqual({
      maxTestReviewLoops: 2,
      severityGate: "block",
    });
  });

  test("applyReviewTestPostResult honors max_test_review_loops from dev config", () => {
    writeWorkItem("QAP-0", {
      schema_version: "1.0",
      id: "QAP-0",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/QAP-0/spec.json",
      plan: "docs/dev/QAP-0/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "QAP-0",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "existing_tests", red_required: false, command: "bun test", reason: "r" },
      },
    });
    const devCfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { quick_fix_loop: { max_test_review_loops: 0 } },
    };
    const note = applyReviewTestPostResult(
      "QAP-0",
      { verdict: "issues", findings: [{ severity: "critical", issue: "x" }] },
      devCfg,
    );
    expect(note).toContain("retry cap reached");
    const task = readTaskRaw("QAP-0");
    expect(task.control.status).toBe("blocked");
  });

  test("applyReviewTestPostResult persists phase-code on clean verdict", () => {
    writeWorkItem("QAP-1", {
      schema_version: "1.0",
      id: "QAP-1",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/QAP-1/spec.json",
      plan: "docs/dev/QAP-1/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "QAP-1",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "existing_tests", red_required: false, command: "bun test", reason: "r" },
      },
    });
    const note = applyReviewTestPostResult("QAP-1", { verdict: "clean", findings: [] });
    expect(note).toContain("Quick-fix (review-test)");
    const task = readTaskRaw("QAP-1");
    expect(task.control.phase).toBe("phase-code");
  });

  test("applyReviewTestPostResult blocks task at loop cap", () => {
    const policy = defaultQuickFixLoopPolicy();
    writeWorkItem("QAP-2", {
      schema_version: "1.0",
      id: "QAP-2",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/QAP-2/spec.json",
      plan: "docs/dev/QAP-2/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "QAP-2",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      retries: {
        test_review: { used: policy.maxTestReviewLoops, lifetime: policy.maxTestReviewLoops },
      },
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "existing_tests", red_required: false, command: "bun test", reason: "r" },
      },
    });
    const note = applyReviewTestPostResult("QAP-2", {
      verdict: "issues",
      findings: [{ severity: "critical", issue: "x" }],
    });
    expect(note).toContain("retry cap reached");
    const task = readTaskRaw("QAP-2");
    expect(task.control.status).toBe("blocked");
  });

  test("resolveResumeOrchestration forwards quick_fix fixing when task is loop-blocked", () => {
    writeWorkItem("QFBLK-1", {
      schema_version: "1.0",
      id: "QFBLK-1",
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: "docs/dev/QFBLK-1/spec.json",
      plan: "docs/dev/QFBLK-1/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "QFBLK-1",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      status: "blocked",
      preImplGates: "pending",
      blocked: {
        kind: "cap",
        reason: "Review-test retry cap reached (3)",
        ref: "T1/decision",
        loop: "T",
      },
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "existing_tests", red_required: false, command: "bun test", reason: "r" },
      },
    });
    const forwarded = resolveResumeOrchestration("QFBLK-1", minimalDevConfig());
    expect(forwarded.outcome).toBe("blocked");
  });
});

describe("finish orchestration", () => {
  test("resolveFinishOrchestration blocks when work item missing", () => {
    const r = resolveFinishOrchestration("MISSING-1", minimalDevConfig());
    expect(r.outcome).toBe("blocked");
  });

  test("resolveFinishOrchestration blocked on pending decision", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "FIN-B1"), { recursive: true });
    writeFileSync(join("docs", "dev", "FIN-B1", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-B1", "plan.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-B1", "brief.md"), "# b\n", "utf8");
    writeWorkItem("FIN-B1", {
      schema_version: "1.0",
      id: "FIN-B1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/FIN-B1/spec.json",
      plan: "docs/dev/FIN-B1/plan.json",
      verify: null,
      brief: "docs/dev/FIN-B1/brief.md",
      decisions: [
        {
          id: "d1",
          source: "x",
          status: "pending",
          question: "q?",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      deviations: [],
      cost_usd: 0,
    });
    const r = resolveFinishOrchestration("FIN-B1", minimalDevConfig());
    expect(r.outcome).toBe("blocked");
  });

  test("resolveFinishOrchestration spawns phase-verify-acceptance when artifacts exist", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "FIN-1"), { recursive: true });
    writeFileSync(join("docs", "dev", "FIN-1", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-1", "plan.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-1", "brief.md"), "# b\n", "utf8");
    writeWorkItem("FIN-1", {
      schema_version: "1.0",
      id: "FIN-1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/FIN-1/spec.json",
      plan: "docs/dev/FIN-1/plan.json",
      verify: null,
      brief: "docs/dev/FIN-1/brief.md",
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const r = resolveFinishOrchestration("FIN-1", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("phase-verify-acceptance");
    }
  });

  test("runFinishOrchestrationFromResolution finalises after successful verify acceptance spawn", async () => {
    mkdirSync(join(tempCwd, "docs", "dev", "FIN-2"), { recursive: true });
    writeFileSync(join("docs", "dev", "FIN-2", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-2", "plan.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-2", "brief.md"), "# b\n", "utf8");
    writeWorkItem("FIN-2", {
      schema_version: "1.0",
      id: "FIN-2",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/FIN-2/spec.json",
      plan: "docs/dev/FIN-2/plan.json",
      verify: null,
      brief: "docs/dev/FIN-2/brief.md",
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const resolution = resolveFinishOrchestration("FIN-2", minimalDevConfig());
    expect(resolution.outcome).toBe("spawn");
    const host = {
      notify: () => {},
      async spawnSubagent() {
        writeFileSync(
          join("docs", "dev", "FIN-2", "verify.json"),
          `${JSON.stringify({
            schema_version: "1.0",
            verdict: "pass",
            date: "2026-01-01",
            criteria: [{ ac_id: "AC-1", status: "pass" }],
          })}\n`,
          "utf8",
        );
        return { exitCode: 0 };
      },
    };
    const result = await runFinishOrchestrationFromResolution(
      resolution,
      "FIN-2",
      minimalDevConfig(),
      host,
    );
    expect(result.closeout?.ok).toBe(true);
    const wi = JSON.parse(readFileSync(join(".tasks", "FIN-2.json"), "utf8")) as {
      terminal_outcome?: string;
    };
    expect(wi.terminal_outcome).toBe("done");
  });

  test("buildDevOrchestratePayload finish includes command and spawn resolution", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "FIN-3"), { recursive: true });
    writeFileSync(join("docs", "dev", "FIN-3", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-3", "plan.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "FIN-3", "brief.md"), "# b\n", "utf8");
    writeWorkItem("FIN-3", {
      schema_version: "1.0",
      id: "FIN-3",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/FIN-3/spec.json",
      plan: "docs/dev/FIN-3/plan.json",
      verify: null,
      brief: "docs/dev/FIN-3/brief.md",
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    const p = buildDevOrchestratePayload("finish", "FIN-3", minimalDevConfig());
    expect(p.command).toBe("finish");
    expect(p.resolution.outcome).toBe("spawn");
    expect(p.judgment_configured_for_spawn).toBe(false);
    expect(p.spawn_task_after_template_judgment).toBeUndefined();
  });

  test("buildDevOrchestratePayload resume exposes judgment MCP hints when judgment enabled", () => {
    const id = "JUD-ORCH-1";
    mkdirSync(join(tempCwd, "docs", "dev", id), { recursive: true });
    writeFileSync(join("docs", "dev", id, "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", id, "plan.json"), "{}\n", "utf8");
    writeWorkItem(id, {
      schema_version: "1.0",
      id,
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: `docs/dev/${id}/spec.json`,
      plan: `docs/dev/${id}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: id,
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
      },
    });
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { judgment: { enabled: true } },
    };
    const p = buildDevOrchestratePayload("resume", id, cfg);
    expect(p.resolution.outcome).toBe("spawn");
    expect(p.judgment_configured_for_spawn).toBe(true);
    expect(p.spawn_task_after_template_judgment).toBeDefined();
    expect(p.spawn_task_after_template_judgment).toContain(
      "## Judgment supplement (harness — template)",
    );
    if (p.resolution.outcome === "spawn") {
      expect(p.resolution.task).not.toContain("Judgment supplement");
      expect(p.spawn_task_after_template_judgment?.startsWith(p.resolution.task)).toBe(true);
    }
  });

  test("buildDevOrchestratePayload resume without judgment omits template merge field", () => {
    const id = "JUD-ORCH-2";
    mkdirSync(join(tempCwd, "docs", "dev", id), { recursive: true });
    writeFileSync(join("docs", "dev", id, "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", id, "plan.json"), "{}\n", "utf8");
    writeWorkItem(id, {
      schema_version: "1.0",
      id,
      title: "qf",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "quick_fix",
      phase: "fixing",
      task_ids: [1],
      spec: `docs/dev/${id}/spec.json`,
      plan: `docs/dev/${id}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: id,
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-test",
      preImplGates: "pending",
      quickFixContract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
      },
    });
    const p = buildDevOrchestratePayload("resume", id, minimalDevConfig());
    expect(p.resolution.outcome).toBe("spawn");
    expect(p.judgment_configured_for_spawn).toBe(false);
    expect(p.spawn_task_after_template_judgment).toBeUndefined();
  });
});

describe("implement phase-code harness hook", () => {
  test("applyPhaseCodePostResult advances to review-code", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "IPC-1"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "IPC-1", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [{ id: 1, title: "t", covers_ac: [], challenge: false, files: [], steps: [] }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("IPC-1", {
      schema_version: "1.0",
      id: "IPC-1",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/IPC-1/spec.json",
      plan: "docs/dev/IPC-1/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "IPC-1",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-code",
      status: "in_progress",
      preImplGates: "complete",
      coversAc: ["AC-1"],
    });
    const note = applyPhaseCodePostResult(
      "IPC-1",
      {
        status: "done",
        reviews_requested: 1,
        files_changed: [],
        tests_passing: true,
        ac_covered: ["AC-1"],
        deviations_emitted: 0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      minimalDevConfig(),
    );
    expect(note).toContain("review-code");
    const task = readTaskRaw("IPC-1");
    expect(task.control.phase).toBe("review-code");
  });

  test("applyPhaseCodePostResult always enqueues review-code regardless of legacy implement_loop config flags", () => {
    // v2: review-code is unconditional after phase-code (no test files, no security-sensitive
    // paths) — `orchestration.implement_loop.*` flags no longer affect routing
    // (see `nextPhaseAfterPhaseCode` / `ImplementCodeReviewPolicy` docstring).
    mkdirSync(join(tempCwd, "docs", "dev", "IPC-2"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "IPC-2", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [{ id: 1, title: "t", covers_ac: [], challenge: false, files: [], steps: [] }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("IPC-2", {
      schema_version: "1.0",
      id: "IPC-2",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/IPC-2/spec.json",
      plan: "docs/dev/IPC-2/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "IPC-2",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-code",
      status: "in_progress",
      preImplGates: "complete",
      coversAc: ["AC-1"],
    });
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: {
        implement_loop: {
          code_review_on_reviews_requested: false,
          code_review_on_challenge: false,
        },
      },
    };
    const note = applyPhaseCodePostResult(
      "IPC-2",
      {
        status: "done",
        reviews_requested: 0,
        files_changed: [],
        tests_passing: true,
        ac_covered: ["AC-1"],
        deviations_emitted: 0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      cfg,
    );
    expect(note).toContain("review-code");
    const task = readTaskRaw("IPC-2");
    expect(task.control.phase).toBe("review-code");
  });

  test("applyPhaseCodePostResult respawns phase-test when test files appear in files_changed (RGR)", () => {
    mkdirSync(join(tempCwd, "docs", "dev", "IPC-3"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "IPC-3", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [{ id: 1, title: "t", covers_ac: [], challenge: false, files: [], steps: [] }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("IPC-3", {
      schema_version: "1.0",
      id: "IPC-3",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/IPC-3/spec.json",
      plan: "docs/dev/IPC-3/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "IPC-3",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "phase-code",
      status: "in_progress",
      preImplGates: "complete",
      coversAc: ["AC-1"],
    });
    const note = applyPhaseCodePostResult(
      "IPC-3",
      {
        status: "done",
        files_changed: ["src/foo.test.ts"],
        tests_passing: true,
        ac_covered: ["AC-1"],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      minimalDevConfig(),
    );
    expect(note).toContain("phase-test");
    expect(note).toContain("RGR");
    const task = readTaskRaw("IPC-3");
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.pre_impl_gates).toBe("pending");
  });
});

describe("review retry policy", () => {
  test("reviewRetryPolicyForAgent: quick_fix review-test uses quick_fix_loop", () => {
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: {
        quick_fix_loop: { max_test_review_loops: 7, severity_gate: "block" },
        review_loop: { severity_gate: "warn", max_critical_retries: 9 },
      },
    };
    expect(reviewRetryPolicyForAgent(cfg, "quick_fix", "review-test")).toEqual({
      severityGate: "block",
      maxRetries: 7,
      maxLifetimeRetries: 14,
    });
    expect(reviewRetryPolicyForAgent(cfg, "quick_fix", "review-code")).toEqual({
      severityGate: "warn",
      maxRetries: 9,
      maxLifetimeRetries: 18,
    });
  });

  // NOTE: `decideAfterReviewTest` (counters-in, decision-out) was removed — the same
  // severity-gate / lifetime-cap behaviour now lives inline in `decideLoop` + `capCheck`
  // (`src/tasks/decide.ts`), driven off the findings actually recorded on the v2 task file.
  // Rewritten below as end-to-end `applyReviewTestPostResult` runs against real fixtures.

  test("applyReviewTestPostResult: implement warn gate retries on warning findings", () => {
    writeWorkItem("RRP-WARN", {
      schema_version: "1.0",
      id: "RRP-WARN",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/RRP-WARN/spec.json",
      plan: "docs/dev/RRP-WARN/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "RRP-WARN",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      coversAc: ["AC-1"],
    });
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { review_loop: { severity_gate: "warn", max_critical_retries: 2 } },
    };
    applyReviewTestPostResult(
      "RRP-WARN",
      {
        verdict: "issues",
        findings: [{ severity: "warning", ac_id: "AC-1", issue: "weak assertion" }],
      },
      cfg,
    );
    const task = readTaskRaw("RRP-WARN");
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.test_review).toEqual({ used: 1, lifetime: 1 });
  });

  test("applyReviewTestPostResult: implement block gate skips warning-only issues", () => {
    writeWorkItem("RRP-BLOCK", {
      schema_version: "1.0",
      id: "RRP-BLOCK",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/RRP-BLOCK/spec.json",
      plan: "docs/dev/RRP-BLOCK/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "RRP-BLOCK",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      coversAc: ["AC-1"],
    });
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { review_loop: { severity_gate: "block" } },
    };
    applyReviewTestPostResult(
      "RRP-BLOCK",
      { verdict: "issues", findings: [{ severity: "warning", ac_id: "AC-1", issue: "nit" }] },
      cfg,
    );
    const task = readTaskRaw("RRP-BLOCK");
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.test_review).toEqual({ used: 0, lifetime: 0 });
  });

  test("applyReviewTestPostResult: lifetime cap blocks even when the resettable counter is fresh (post-unblock)", () => {
    writeWorkItem("RRP-LIFE", {
      schema_version: "1.0",
      id: "RRP-LIFE",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/RRP-LIFE/spec.json",
      plan: "docs/dev/RRP-LIFE/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    // Simulates state right after `/dev unblock`: resettable counter back to 0, but the
    // lifetime counter (which unblock never touches) already at the default ceiling
    // (maxRetries * (max_unblocks_per_task=1 + 1) = 6).
    writeTaskFixture({
      workItemId: "RRP-LIFE",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      coversAc: ["AC-1"],
      retries: { test_review: { used: 0, lifetime: 6 }, unblocks: 1 },
    });
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { review_loop: { max_critical_retries: 3 } },
    };
    const note = applyReviewTestPostResult(
      "RRP-LIFE",
      {
        verdict: "issues",
        findings: [{ severity: "critical", ac_id: "AC-1", issue: "still broken" }],
      },
      cfg,
    );
    const task = readTaskRaw("RRP-LIFE");
    expect(task.control.status).toBe("blocked");
    expect(task.control.blocked?.lifetime).toBe(true);
    expect(task.control.blocked?.reason).toContain("LIFETIME");
    expect(note).toContain("accord unblock");
  });

  test("applyReviewTestPostResult: resettable counter under cap but lifetime cap not yet reached still retries and bumps both counters", () => {
    writeWorkItem("RRP-OK", {
      schema_version: "1.0",
      id: "RRP-OK",
      title: "impl",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: "docs/dev/RRP-OK/spec.json",
      plan: "docs/dev/RRP-OK/plan.json",
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "RRP-OK",
      taskId: 1,
      ownerNonce: "abcdef",
      phase: "review-test",
      preImplGates: "pending",
      coversAc: ["AC-1"],
      retries: { test_review: { used: 0, lifetime: 5 }, unblocks: 1 },
    });
    const cfg: DevHarnessConfig = {
      ...minimalDevConfig(),
      orchestration: { review_loop: { max_critical_retries: 3 } },
    };
    applyReviewTestPostResult(
      "RRP-OK",
      {
        verdict: "issues",
        findings: [{ severity: "critical", ac_id: "AC-1", issue: "still broken" }],
      },
      cfg,
    );
    const task = readTaskRaw("RRP-OK");
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.test_review).toEqual({ used: 1, lifetime: 6 });
  });
});
