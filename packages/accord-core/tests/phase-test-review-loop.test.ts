/**
 * phase-test ↔ review-test convergence: import-only RED guard, stub skeleton propagation,
 * retry-brief contents, and per-task feedback targeting (v2 task file).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { findFinding, stateFromHistory } from "@clive.shirley/accord-core/tasks/model.js";
import type { Requirement } from "@clive.shirley/accord-core/tasks/types.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

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

function writeWorkItem(overrides: Record<string, unknown> = {}, taskIds: number[] = [1]): void {
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
      ...overrides,
    })}\n`,
  );
}

/** spec.json + plan.json backing `buildImplementSpawnTaskBrief` (not read by the post-result handlers). */
function seedSpecPlan(taskIds: number[] = [1]): void {
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
}

function seed(taskIds: number[] = [1]): void {
  seedSpecPlan(taskIds);
  writeWorkItem({}, taskIds);
}

function readTask(taskId = 1): ReturnType<typeof readTaskFixture> {
  return readTaskFixture(WI, taskId);
}

const IMPORT_ONLY_OUTPUT =
  "error: Cannot find module './proration' from '/repo/src/proration.test.ts'\n\n0 pass\n1 fail\n";

describe("import-only RED guard (phase-test post-result)", () => {
  test("bounces to phase-test with an actionable critical finding and skips review-test", () => {
    seed();
    writeTaskFixture({ workItemId: WI, taskId: 1 });
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
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.status).toBe("pending");
    expect(task.control.last_test_run?.confirmed).toBe(false);
    const hit = findFinding(task, "F-001");
    expect(hit?.finding.severity).toBe("critical");
    expect(hit?.finding.detail?.category).toBe("import_only_red");
    expect(hit?.finding.issue).toContain("./proration");
    // Recommendation must be actionable by phase-test itself (Step 3), not deferred to phase-code.
    expect(hit?.finding.detail?.recommendation).toContain("phase-test Step 3");
    expect(hit?.finding.detail?.recommendation).toContain("Do NOT mock the module under test");
    expect(task.control.retries.test_review).toEqual({ used: 1, lifetime: 1 });
  });

  test("blocks once the review-test retry cap is exhausted", () => {
    seed();
    writeTaskFixture({ workItemId: WI, taskId: 1 });
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
    expect(task.control.status).toBe("blocked");
    expect(task.control.phase).toBe("phase-test");
  });

  test("existing_tests quick-fix strategy is exempt (pre-existing suite may legitimately fail to resolve)", () => {
    seed();
    writeWorkItem({ pattern: "quick_fix", phase: "fixing" });
    writeTaskFixture({
      workItemId: WI,
      taskId: 1,
      quickFixContract: {
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
    expect(readTask().control.phase).toBe("review-test");
  });

  test("behaviour RED with stubs advances and persists stub_files + review_responses", () => {
    seed();
    writeTaskFixture({ workItemId: WI, taskId: 1 });
    // Round T1: initial (behaviour) RED, review-test raises a critical finding.
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        red_confirmed: true,
        test_output: "FAIL src/proration.test.ts\n  Expected: 1\n  Received: 0\n",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig(),
    );
    applyReviewTestPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            issue: "import-only",
            ac_id: "AC-1",
            file: "src/proration.test.ts",
          },
        ],
      },
      devConfig(),
    );
    expect(readTask().control.phase).toBe("phase-test");

    // Round T2: phase-test adds a stub and answers the finding.
    const note = applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        stub_files: ["src/proration.ts"],
        red_confirmed: true,
        test_output: "✗ AC-1 prorates\n  error: not implemented: prorate\n0 pass\n1 fail\n",
        review_responses: [
          { finding_id: "F-001", resolution: "fixed", note: "added stub src/proration.ts" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig(),
    );
    expect(note).toContain("`src/proration.ts`");
    expect(note).not.toContain("no `review_responses`");
    const task = readTask();
    expect(task.control.phase).toBe("review-test");
    expect(task.control.last_test_run?.confirmed).toBe(true);
    expect(task.control.stub_files).toEqual(["src/proration.ts"]);
    const hit = findFinding(task, "F-001");
    expect(hit && stateFromHistory(hit.finding.history)).toBe("addressed");
  });

  test("flags a retry round that returns no review_responses", () => {
    seed();
    writeTaskFixture({ workItemId: WI, taskId: 1 });
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        red_confirmed: true,
        test_output: "FAIL src/proration.test.ts\n  Expected: 1\n  Received: 0\n",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig(),
    );
    applyReviewTestPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            issue: "weak assertion",
            ac_id: "AC-1",
            file: "src/proration.test.ts",
          },
        ],
      },
      devConfig(),
    );
    expect(readTask().control.phase).toBe("phase-test");

    const note = applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        red_confirmed: true,
        test_output: "Expected: 1\nReceived: 0\n",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      devConfig(),
    );
    expect(note).toContain("no `review_responses`");
    const task = readTask();
    const lastEntry = task.log.at(-1);
    expect(lastEntry?.warnings?.some((w) => w.includes("no review_responses"))).toBe(true);
  });
});

describe("retry briefs", () => {
  test("phase-test retry brief carries prior_round and a review_responses instruction", () => {
    seed();
    writeTaskFixture({ workItemId: WI, taskId: 1 });
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
    expect(withFeedback).toContain("## Open test findings (harness ledger)");
    expect(withFeedback).toContain("import_only_red");
    expect(withFeedback).toContain("review_responses[]");
  });

  test("review-test brief carries stub_files, requirement_map, and phase-test's disputed response", () => {
    seed();
    writeTaskFixture({ workItemId: WI, taskId: 1 });
    // T1: initial RED → review-test raises a critical finding → back to phase-test (T2).
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        red_confirmed: true,
        test_output: "FAIL src/proration.test.ts\n  Expected: 1\n  Received: 0\n",
      },
      devConfig(),
    );
    applyReviewTestPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            issue: "weak assertion",
            ac_id: "AC-1",
            file: "src/proration.test.ts",
          },
        ],
      },
      devConfig(),
    );
    // T2: phase-test adds a stub and disputes the finding — advances back to review-test.
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        test_files: ["src/proration.test.ts"],
        stub_files: ["src/proration.ts"],
        red_confirmed: true,
        test_output: "FAIL src/proration.test.ts\n  Expected: 1\n  Received: 0\n",
        review_responses: [
          { finding_id: "F-001", resolution: "disputed", note: "spec AC-1 says X" },
        ],
      },
      devConfig(),
    );
    expect(readTask().control.phase).toBe("review-test");

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
    expect(brief.value).toContain('"requirement_map"');

    const withFeedback = appendReviewFeedbackToResumeBrief(WI, brief.value, "review-test");
    expect(withFeedback).toContain("## Prior test findings to recheck (harness ledger)");
    expect(withFeedback).toContain("spec AC-1 says X");
  });

  test("feedback is taken from the active task only, not a finished sibling", () => {
    seed([1, 2]);
    const staleFinding: Requirement["findings"][number] = {
      id: "F-001",
      state: "open",
      severity: "suggestion",
      loop: "C",
      issue: "task-1 stale nit",
      raised: "C1/review-code",
      history: [],
    };
    writeTaskFixture({
      workItemId: WI,
      taskId: 1,
      phase: "phase-code",
      status: "done",
      requirements: [
        {
          id: "AC-1",
          requirement: "MUST",
          text: "AC-1 behaviour",
          test_cases: [],
          status: "satisfied",
          changes: [],
          findings: [staleFinding],
          verification: null,
        },
        {
          id: "_task",
          text: "Changes/findings not attributable to one AC",
          test_cases: [],
          status: "n/a",
          changes: [],
          findings: [],
          verification: null,
        },
      ],
    });
    writeTaskFixture({ workItemId: WI, taskId: 2, phase: "phase-code", status: "pending" });
    const out = appendReviewFeedbackToResumeBrief(WI, "BASE", "phase-code");
    expect(out).toBe("BASE");
  });

  test("review-test critical findings route back to phase-test with the findings in its brief", () => {
    seed();
    writeTaskFixture({
      workItemId: WI,
      taskId: 1,
      phase: "review-test",
      testFiles: ["src/proration.test.ts"],
    });
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
    expect(readTask().control.phase).toBe("phase-test");
    const out = appendReviewFeedbackToResumeBrief(WI, "BASE", "phase-test");
    expect(out).toContain("AC-1 negation stays green");
  });
});
