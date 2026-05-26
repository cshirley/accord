import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DevHarnessConfig } from "../src/core/config/index.js";
import {
  applyPhaseCodePostResult,
  applyPhaseTestPostResult,
  applyReviewTestPostResult,
  buildDevOrchestratePayload,
  bumpQuickFixTestReviewCycle,
  decideQuickFixAfterReviewPacket,
  decideQuickFixAfterReviewTest,
  defaultQuickFixLoopPolicy,
  parseLeadingWorkItemId,
  quickFixLoopPolicyFromDevConfig,
  REFERENCE_ORCHESTRATION_GRAPH,
  resolveFinishOrchestration,
  resolveResumeAgentId,
  resolveResumeOrchestration,
  resumeResolutionToNextSteps,
  runFinishOrchestrationFromResolution,
  runResumeOrchestrationWithReplans,
  runUntilStop,
  selectOrchestrationEdge,
  transitionOrchestrationGraph,
  validateOrchestrationGraph,
} from "../src/core/orchestration/index.js";
import type { OrchestrationGraphDefinition } from "../src/core/orchestration/types.js";

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
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function writeWorkItem(id: string, body: Record<string, unknown>) {
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
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
      expect(r.task).toContain("dispatch_agent: phase-spec");
      expect(r.task).toContain("work_item_phase: speccing");
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

  test("resolveResumeOrchestration forwards when phase has no mapping (implementing)", () => {
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
      expect(r.messages[0]?.text).toContain("no harness resume mapping");
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
    writeFileSync(join("docs", "dev", "IMP-RES-1", "spec.json"), "{}\n", "utf8");
    writeFileSync(join("docs", "dev", "IMP-RES-1", "plan.json"), "{}\n", "utf8");
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
    writeFileSync(
      join(".tasks", "IMP-RES-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "IMP-RES-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-code",
        status: "pending",
        pre_impl_gates: "complete",
        events: [],
      })}\n`,
      "utf8",
    );
    const blocked = resolveResumeOrchestration("IMP-RES-1", null);
    expect(blocked.outcome).toBe("blocked");
    const spawned = resolveResumeOrchestration("IMP-RES-1", minimalDevConfig());
    expect(spawned.outcome).toBe("spawn");
    if (spawned.outcome === "spawn") {
      expect(spawned.agent).toBe("phase-code");
      expect(spawned.task).toContain("dispatch_agent: phase-code");
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
    const taskPath = join(".tasks", "ACCORD-990-task-1.json");
    writeFileSync(
      taskPath,
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "ACCORD-990",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: [],
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
        },
        events: [],
      })}\n`,
      "utf8",
    );

    let spawnCount = 0;
    const host = {
      notify: () => {},
      spawnSubagent: async (input: { agent: string; task: string }) => {
        spawnCount += 1;
        // first spawn (phase-test) transitions task to review-test
        if (spawnCount === 1) {
          expect(input.agent).toBe("phase-test");
          const raw = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;
          raw.phase = "review-test";
          raw.test_files = ["pkg/x.test.ts"];
          writeFileSync(taskPath, `${JSON.stringify(raw)}\n`, "utf8");
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
    const taskPath = join(".tasks", "ACCORD-991-task-1.json");
    writeFileSync(
      taskPath,
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "ACCORD-991",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "complete",
        test_files: ["pkg/x.test.ts"],
        quick_fix_loop: { test_review_cycles_used: 0 },
        events: [],
      })}\n`,
      "utf8",
    );

    let spawnCount = 0;
    const notices: string[] = [];
    const host = {
      notify: (_level: string, text: string) => {
        notices.push(text);
      },
      spawnSubagent: async (input: { agent: string }) => {
        spawnCount += 1;
        expect(input.agent).toBe("review-test");
        const raw = JSON.parse(readFileSync(taskPath, "utf8")) as Record<string, unknown>;
        raw.phase = "phase-code";
        writeFileSync(taskPath, `${JSON.stringify(raw)}\n`, "utf8");
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
  test("decideQuickFixAfterReviewTest: clean → phase-code", () => {
    const policy = defaultQuickFixLoopPolicy();
    expect(decideQuickFixAfterReviewTest({ test_review_cycles_used: 2 }, "clean", policy)).toEqual({
      nextAgent: "phase-code",
      bumpCycle: false,
    });
  });

  test("decideQuickFixAfterReviewTest: issues under cap → phase-test + bump", () => {
    const policy = defaultQuickFixLoopPolicy();
    expect(decideQuickFixAfterReviewTest({ test_review_cycles_used: 0 }, "issues", policy)).toEqual(
      {
        nextAgent: "phase-test",
        bumpCycle: true,
      },
    );
  });

  test("decideQuickFixAfterReviewTest: issues at cap → blocked", () => {
    const policy = defaultQuickFixLoopPolicy();
    const result = decideQuickFixAfterReviewTest(
      { test_review_cycles_used: policy.maxTestReviewLoops },
      "issues",
      policy,
    );
    expect("blocked" in result && result.blocked).toBe(true);
    if ("blocked" in result && result.blocked) {
      expect(result.reason).toContain("cap reached");
    }
  });

  test("bumpQuickFixTestReviewCycle increments task file counter", () => {
    writeFileSync(
      join(".tasks", "ACCORD-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "ACCORD-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 1 },
        events: [],
      })}\n`,
      "utf8",
    );
    const bumped = bumpQuickFixTestReviewCycle("ACCORD-1", 1);
    expect(bumped).toEqual({ ok: true, test_review_cycles_used: 2 });
  });

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
    writeFileSync(
      join(".tasks", "QAP-PT-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QAP-PT",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: [],
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
        },
        events: [],
      })}\n`,
      "utf8",
    );
    const note = applyPhaseTestPostResult("QAP-PT", {
      status: "done",
      test_files: ["src/foo.test.ts"],
      red_confirmed: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("review-test");
    const task = JSON.parse(readFileSync(join(".tasks", "QAP-PT-task-1.json"), "utf8")) as {
      phase: string;
      test_files: string[];
    };
    expect(task.phase).toBe("review-test");
    expect(task.test_files).toEqual(["src/foo.test.ts"]);
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
    writeFileSync(
      join(".tasks", "QAP-IMP-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QAP-IMP",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: [],
        events: [],
      })}\n`,
      "utf8",
    );
    const note = applyPhaseTestPostResult("QAP-IMP", {
      status: "done",
      test_files: ["src/imp.test.ts"],
      red_confirmed: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("Implement (phase-test)");
    expect(note).toContain("review-test");
    const task = JSON.parse(readFileSync(join(".tasks", "QAP-IMP-task-1.json"), "utf8")) as {
      phase: string;
      test_files: string[];
      events: Array<{ type?: string }>;
    };
    expect(task.phase).toBe("review-test");
    expect(task.test_files).toEqual(["src/imp.test.ts"]);
    expect(task.events.some((e) => e.type === "implement_phase_test_applied")).toBe(true);
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
    writeFileSync(
      join(".tasks", "QF-RT-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QF-RT",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: ["src/qf.test.ts"],
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
        },
        events: [],
      })}\n`,
      "utf8",
    );
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
    writeFileSync(
      join(".tasks", "IMP-RT-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "IMP-RT",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "pending",
        test_files: ["src/impl.test.ts"],
        events: [],
      })}\n`,
      "utf8",
    );
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
    writeFileSync(
      join(".tasks", "ACCORD-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "ACCORD-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
        },
        events: [],
      })}\n`,
      "utf8",
    );
    const blocked = resolveResumeOrchestration("ACCORD-1", null);
    expect(blocked.outcome).toBe("blocked");
    const spawned = resolveResumeOrchestration("ACCORD-1", minimalDevConfig());
    expect(spawned.outcome).toBe("spawn");
    if (spawned.outcome === "spawn") {
      expect(spawned.agent).toBe("phase-test");
    }
  });

  test("decideQuickFixAfterReviewPacket: suggestion-only issues skip retry slot under warn gate", () => {
    const policy = defaultQuickFixLoopPolicy();
    expect(
      decideQuickFixAfterReviewPacket(
        { test_review_cycles_used: 0 },
        { verdict: "issues", findings: [{ severity: "suggestion" }] },
        policy,
      ),
    ).toEqual({ nextAgent: "phase-code", bumpCycle: false });
  });

  test("decideQuickFixAfterReviewPacket: critical issues request phase-test under warn gate", () => {
    const policy = defaultQuickFixLoopPolicy();
    expect(
      decideQuickFixAfterReviewPacket(
        { test_review_cycles_used: 0 },
        { verdict: "issues", findings: [{ severity: "critical" }] },
        policy,
      ),
    ).toEqual({ nextAgent: "phase-test", bumpCycle: true });
  });

  test("decideQuickFixAfterReviewPacket: block gate ignores non-critical findings", () => {
    const policy = { ...defaultQuickFixLoopPolicy(), severityGate: "block" as const };
    expect(
      decideQuickFixAfterReviewPacket(
        { test_review_cycles_used: 0 },
        { verdict: "issues", findings: [{ severity: "warning" }] },
        policy,
      ),
    ).toEqual({ nextAgent: "phase-code", bumpCycle: false });
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
    writeFileSync(
      join(".tasks", "QAP-0-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QAP-0",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: {
            strategy: "existing_tests",
            red_required: false,
            command: "bun test",
            reason: "r",
          },
        },
        events: [],
      })}\n`,
      "utf8",
    );
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
    const task = JSON.parse(readFileSync(join(".tasks", "QAP-0-task-1.json"), "utf8")) as {
      status: string;
    };
    expect(task.status).toBe("blocked");
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
    writeFileSync(
      join(".tasks", "QAP-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QAP-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: {
            strategy: "existing_tests",
            red_required: false,
            command: "bun test",
            reason: "r",
          },
        },
        events: [],
      })}\n`,
      "utf8",
    );
    const note = applyReviewTestPostResult("QAP-1", { verdict: "clean", findings: [] });
    expect(note).toContain("Quick-fix (review-test)");
    const task = JSON.parse(readFileSync(join(".tasks", "QAP-1-task-1.json"), "utf8")) as {
      phase: string;
    };
    expect(task.phase).toBe("phase-code");
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
    writeFileSync(
      join(".tasks", "QAP-2-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QAP-2",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: policy.maxTestReviewLoops },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: {
            strategy: "existing_tests",
            red_required: false,
            command: "bun test",
            reason: "r",
          },
        },
        events: [],
      })}\n`,
      "utf8",
    );
    const note = applyReviewTestPostResult("QAP-2", {
      verdict: "issues",
      findings: [{ severity: "critical", issue: "x" }],
    });
    expect(note).toContain("retry cap reached");
    const task = JSON.parse(readFileSync(join(".tasks", "QAP-2-task-1.json"), "utf8")) as {
      status: string;
    };
    expect(task.status).toBe("blocked");
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
    writeFileSync(
      join(".tasks", "QFBLK-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "QFBLK-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "blocked",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 1 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: {
            strategy: "existing_tests",
            red_required: false,
            command: "bun test",
            reason: "r",
          },
        },
        events: [],
      })}\n`,
      "utf8",
    );
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
    writeFileSync(
      join(".tasks", `${id}-task-1.json`),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: id,
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
        },
        events: [],
      })}\n`,
      "utf8",
    );
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
    writeFileSync(
      join(".tasks", `${id}-task-1.json`),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: id,
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        quick_fix_loop: { test_review_cycles_used: 0 },
        quick_fix_contract: {
          plan: {
            summary: "s",
            target_paths: [],
            out_of_scope: [],
            expected_finish: "done",
          },
          test: { strategy: "new_red_test", red_required: true, command: "bun test", reason: "r" },
        },
        events: [],
      })}\n`,
      "utf8",
    );
    const p = buildDevOrchestratePayload("resume", id, minimalDevConfig());
    expect(p.resolution.outcome).toBe("spawn");
    expect(p.judgment_configured_for_spawn).toBe(false);
    expect(p.spawn_task_after_template_judgment).toBeUndefined();
  });
});

describe("implement phase-code harness hook", () => {
  test("applyPhaseCodePostResult advances to review-code when reviews_requested", () => {
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
    writeFileSync(
      join(".tasks", "IPC-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "IPC-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-code",
        status: "in_progress",
        pre_impl_gates: "complete",
        events: [],
      })}\n`,
      "utf8",
    );
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
    const task = JSON.parse(readFileSync(join(".tasks", "IPC-1-task-1.json"), "utf8")) as {
      phase: string;
    };
    expect(task.phase).toBe("review-code");
  });

  test("applyPhaseCodePostResult always enqueues review-code even when implement_loop flags are false", () => {
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
    writeFileSync(
      join(".tasks", "IPC-2-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "IPC-2",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "phase-code",
        status: "in_progress",
        pre_impl_gates: "complete",
        events: [],
      })}\n`,
      "utf8",
    );
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
    const task = JSON.parse(readFileSync(join(".tasks", "IPC-2-task-1.json"), "utf8")) as {
      phase: string;
    };
    expect(task.phase).toBe("review-code");
  });
});
