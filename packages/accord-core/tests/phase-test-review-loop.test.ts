/**
 * phase-test ↔ review-test convergence: import-only RED guard, stub skeleton propagation,
 * retry-brief contents, and per-task feedback targeting.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildImplementSpawnTaskBrief } from "@clive.shirley/accord-core/briefing/task-requirements.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  appendReviewFeedbackToResumeBrief,
  applyPhaseTestPostResult,
  applyReviewTestPostResult,
} from "@clive.shirley/accord-core/orchestration/index.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";

const WI = "LOOP-1";

function devConfig(overrides?: DevHarnessConfig["orchestration"]): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: ["bun test"],
    ...(overrides ? { orchestration: overrides } : {}),
  };
}

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-loop-"));
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
  resetSpawnPreflightCheckForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function seed(taskIds: number[] = [1]): void {
  mkdirSync(join("docs", "dev", WI), { recursive: true });
  writeFileSync(
    join("docs", "dev", WI, "spec.json"),
    `${JSON.stringify({
      schema_version: "1.0",
      acceptance_criteria: [
        { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "prorates" },
      ],
      verification: {
        commands: ["bun test"],
        test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "prorates", tier: "unit" }],
      },
    })}\n`,
  );
  writeFileSync(
    join("docs", "dev", WI, "plan.json"),
    `${JSON.stringify({
      schema_version: "1.0",
      tasks: taskIds.map((id) => ({
        id,
        title: `t${String(id)}`,
        covers_ac: ["AC-1"],
        challenge: false,
        files: [
          { path: "src/proration.test.ts", action: "create" },
          { path: "src/proration.ts", action: "create" },
        ],
        steps: [
          { tag: "test", description: "red" },
          { tag: "impl", description: "green" },
        ],
      })),
    })}\n`,
  );
  writeFileSync(
    join(".tasks", `${WI}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      id: WI,
      title: "loop",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: taskIds,
      spec: `docs/dev/${WI}/spec.json`,
      plan: `docs/dev/${WI}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    })}\n`,
  );
}

function writeTask(taskId: number, body: Record<string, unknown>): void {
  writeFileSync(
    join(".tasks", `${WI}-task-${String(taskId)}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      work_item_id: WI,
      task_id: taskId,
      owner_nonce: "abcdef",
      phase: "phase-test",
      status: "pending",
      pre_impl_gates: "pending",
      test_files: [],
      events: [],
      ...body,
    })}\n`,
  );
}

function readTask(taskId = 1): Record<string, unknown> {
  return JSON.parse(readFileSync(join(".tasks", `${WI}-task-${String(taskId)}.json`), "utf8"));
}

const IMPORT_ONLY_OUTPUT =
  "error: Cannot find module './proration' from '/repo/src/proration.test.ts'\n\n0 pass\n1 fail\n";

describe("import-only RED guard (phase-test post-result)", () => {
  test("bounces to phase-test with an actionable critical finding and skips review-test", () => {
    seed();
    writeTask(1, {});
    const note = applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        red_confirmed: true,
        test_output: IMPORT_ONLY_OUTPUT,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig(),
    );
    expect(note).toContain("import-only RED");
    expect(note).toContain("review-test skipped");
    const task = readTask();
    expect(task.phase).toBe("phase-test");
    expect(task.status).toBe("pending");
    expect(task.red_confirmed).toBe(false);
    const feedback = task.last_review_feedback as {
      agent: string;
      findings: Array<{
        severity: string;
        category: string;
        recommendation: string;
        issue: string;
      }>;
      packet: { source?: string };
    };
    expect(feedback.agent).toBe("review-test");
    expect(feedback.packet.source).toBe("harness:import-only-red-guard");
    expect(feedback.findings[0]?.severity).toBe("critical");
    expect(feedback.findings[0]?.category).toBe("import_only_red");
    expect(feedback.findings[0]?.issue).toContain("./proration");
    // Recommendation must be actionable by phase-test itself (Step 3), not deferred to phase-code.
    expect(feedback.findings[0]?.recommendation).toContain("phase-test Step 3");
    expect(feedback.findings[0]?.recommendation).toContain("Do NOT mock the module under test");
    expect(
      (task.review_loop as { test_review_retries_used: number }).test_review_retries_used,
    ).toBe(1);
    const events = task.events as Array<{ type: string; missing?: string[] }>;
    const event = events.find((e) => e.type === "implement_phase_test_import_only_red");
    expect(event?.missing).toEqual(["./proration"]);
  });

  test("blocks once the review-test retry cap is exhausted", () => {
    seed();
    writeTask(1, {});
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        test_output: IMPORT_ONLY_OUTPUT,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig({ review_loop: { review_test: { max_retries: 0 } } }),
    );
    const task = readTask();
    expect(task.status).toBe("blocked");
    expect(task.phase).toBe("phase-test");
  });

  test("existing_tests quick-fix strategy is exempt (pre-existing suite may legitimately fail to resolve)", () => {
    seed();
    const wi = JSON.parse(readFileSync(join(".tasks", `${WI}.json`), "utf8"));
    writeFileSync(
      join(".tasks", `${WI}.json`),
      `${JSON.stringify({ ...wi, pattern: "quick_fix", phase: "fixing" })}\n`,
    );
    writeTask(1, {
      quick_fix_contract: {
        plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "done" },
        test: { strategy: "existing_tests", red_required: false, command: "bun test", reason: "r" },
      },
    });
    applyPhaseTestPostResult(WI, {
      status: "done",
      test_files: ["src/proration.test.ts"],
      test_output: IMPORT_ONLY_OUTPUT,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(readTask().phase).toBe("review-test");
  });

  test("behaviour RED with stubs advances and persists stub_files + review_responses", () => {
    seed();
    writeTask(1, {
      test_files: ["src/proration.test.ts"],
      last_review_feedback: {
        agent: "review-test",
        verdict: "issues",
        findings: [{ severity: "critical", issue: "import-only" }],
        at: "2026-01-01T00:00:00.000Z",
        packet: {},
      },
    });
    const note = applyPhaseTestPostResult(WI, {
      status: "done",
      test_files: ["src/proration.test.ts"],
      stub_files: ["src/proration.ts"],
      red_confirmed: true,
      test_output: "✗ AC-1 prorates\n  error: not implemented: prorate\n0 pass\n1 fail\n",
      review_responses: [
        { issue: "import-only", resolution: "fixed", note: "added stub src/proration.ts" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("`src/proration.ts`");
    expect(note).not.toContain("no `review_responses`");
    const task = readTask();
    expect(task.phase).toBe("review-test");
    expect(task.red_confirmed).toBe(true);
    expect(task.stub_files).toEqual(["src/proration.ts"]);
    expect(task.review_responses).toEqual([
      { issue: "import-only", resolution: "fixed", note: "added stub src/proration.ts" },
    ]);
  });

  test("flags a retry round that returns no review_responses", () => {
    seed();
    writeTask(1, {
      test_files: ["src/proration.test.ts"],
      review_responses: [{ issue: "stale", resolution: "fixed", note: "old round" }],
      last_review_feedback: {
        agent: "review-test",
        verdict: "issues",
        findings: [{ severity: "critical", issue: "weak assertion" }],
        at: "2026-01-01T00:00:00.000Z",
        packet: {},
      },
    });
    const note = applyPhaseTestPostResult(WI, {
      status: "done",
      test_files: ["src/proration.test.ts"],
      red_confirmed: true,
      test_output: "Expected: 1\nReceived: 0\n",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(note).toContain("no `review_responses`");
    const task = readTask();
    // Stale responses from an earlier round must not reach review-test.
    expect(task.review_responses).toBeUndefined();
    const events = task.events as Array<{ type: string; review_responses_missing?: boolean }>;
    expect(events.at(-1)?.review_responses_missing).toBe(true);
  });
});

describe("retry briefs", () => {
  test("phase-test retry brief carries prior_round and a review_responses instruction", () => {
    seed();
    writeTask(1, {
      test_files: ["src/proration.test.ts"],
      stub_files: ["src/proration.ts"],
      test_output: IMPORT_ONLY_OUTPUT,
    });
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        test_output: IMPORT_ONLY_OUTPUT,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig(),
    );
    const brief = buildImplementSpawnTaskBrief({
      workItemId: WI,
      dispatchAgent: "phase-test",
      phase: "implementing",
      title: "loop",
      pattern: "implement",
      devConfig: devConfig(),
    });
    if (!brief.ok || !brief.value) throw new Error("expected phase-test brief");
    expect(brief.value).toContain('"prior_round"');
    expect(brief.value).toContain('"stub_files"');
    const withFeedback = appendReviewFeedbackToResumeBrief(WI, brief.value, "phase-test");
    expect(withFeedback).toContain("## Prior review feedback (harness)");
    expect(withFeedback).toContain("import_only_red");
    expect(withFeedback).toContain("review_responses[]");
  });

  test("review-test brief carries stub_files and phase-test's review responses", () => {
    seed();
    writeTask(1, {
      phase: "review-test",
      test_files: ["src/proration.test.ts"],
      stub_files: ["src/proration.ts"],
      red_confirmed: true,
      test_output: "error: not implemented: prorate",
      review_responses: [
        { issue: "weak assertion", resolution: "disputed", note: "spec AC-1 says X" },
      ],
    });
    const brief = buildImplementSpawnTaskBrief({
      workItemId: WI,
      dispatchAgent: "review-test",
      phase: "implementing",
      title: "loop",
      pattern: "implement",
      devConfig: devConfig(),
    });
    if (!brief.ok || !brief.value) throw new Error("expected review-test brief");
    expect(brief.value).toContain('"stub_files"');
    expect(brief.value).toContain('"phase_test_review_responses"');
    expect(brief.value).toContain("spec AC-1 says X");
  });

  test("feedback is taken from the active task only, not a finished sibling", () => {
    seed([1, 2]);
    writeTask(1, {
      phase: "phase-code",
      status: "done",
      last_review_feedback: {
        agent: "review-code",
        verdict: "issues",
        findings: [{ severity: "suggestion", issue: "task-1 stale nit" }],
        at: "2026-01-01T00:00:00.000Z",
        packet: {},
      },
    });
    writeTask(2, { phase: "phase-code", status: "pending" });
    const out = appendReviewFeedbackToResumeBrief(WI, "BASE", "phase-code");
    expect(out).toBe("BASE");
  });

  test("review-test critical findings route back to phase-test with the findings in its brief", () => {
    seed();
    writeTask(1, { phase: "review-test", test_files: ["src/proration.test.ts"] });
    applyReviewTestPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            issue: "AC-1 negation stays green",
            file: "src/proration.test.ts",
            line: 4,
          },
        ],
      },
      devConfig(),
    );
    expect(readTask().phase).toBe("phase-test");
    const out = appendReviewFeedbackToResumeBrief(WI, "BASE", "phase-test");
    expect(out).toContain("AC-1 negation stays green");
  });
});
