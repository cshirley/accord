/**
 * Every automated loop in the development pipeline must stop after a bounded number of
 * attempts (default 3) and hand control to a human — never cycle silently or ship past a cap.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  applyPhaseCodePostResult,
  applyReviewCodePostResult,
  applyReviewTestPostResult,
  DEFAULT_MAX_CRITICAL_REVIEW_RETRIES,
  DEFAULT_MAX_GATHER_ATTEMPTS,
  DEFAULT_MAX_QUICK_FIX_TEST_REVIEW_LOOPS,
  DEFAULT_MAX_RGR_RESPAWNS,
  resolveResumeOrchestration,
  reviewRetryPolicyForAgent,
  runResumeOrchestrationWithReplans,
} from "@clive.shirley/accord-core/orchestration/index.js";
import { isFinishReady } from "@clive.shirley/accord-core/queries/dashboard-hints.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import { unblockTask } from "@clive.shirley/accord-core/queries/unblock-task.js";
import type { WorkItem } from "@clive.shirley/accord-core/work-items/types.js";
import { readTaskFixture, taskFixturePath, writeTaskFixture } from "./helpers/task-fixture.js";

function devConfig(): DevHarnessConfig {
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
  tempCwd = mkdtempSync(join(tmpdir(), "accord-caps-"));
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
  resetSpawnPreflightCheckForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function writeWorkItem(id: string, body: Partial<WorkItem> & Record<string, unknown>): void {
  writeFileSync(
    join(".tasks", `${id}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      id,
      title: "caps",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
      ...body,
    })}\n`,
  );
}

function readTask(id: string, taskId = 1): ReturnType<typeof readTaskFixture> {
  return readTaskFixture(id, taskId);
}

function readWorkItem(id: string): WorkItem {
  return JSON.parse(readFileSync(join(".tasks", `${id}.json`), "utf8"));
}

/** Rewrite `phase`/`status` directly on the v2 task file — mirrors "the agent re-ran". */
function setTaskPhase(id: string, phase: string, taskId = 1): void {
  const task = readTask(id, taskId);
  task.control.phase = phase as (typeof task)["control"]["phase"];
  task.control.status = "pending";
  writeFileSync(taskFixturePath(id, taskId), `${JSON.stringify(task)}\n`);
}

const CRITICAL = {
  verdict: "issues" as const,
  findings: [{ severity: "critical", issue: "AC-1 negation stays green" }],
};

describe("defaults: every adversarial loop is capped at 3", () => {
  test("constants", () => {
    expect(DEFAULT_MAX_CRITICAL_REVIEW_RETRIES).toBe(3);
    expect(DEFAULT_MAX_QUICK_FIX_TEST_REVIEW_LOOPS).toBe(3);
    expect(DEFAULT_MAX_RGR_RESPAWNS).toBe(3);
    expect(DEFAULT_MAX_GATHER_ATTEMPTS).toBe(3);
  });

  test("resolved policies for implement + quick_fix review-test / review-code", () => {
    for (const pattern of ["implement", "quick_fix"]) {
      for (const agent of ["review-test", "review-code"] as const) {
        expect(reviewRetryPolicyForAgent(null, pattern, agent).maxRetries).toBe(3);
      }
    }
  });
});

describe("review-test → phase-test", () => {
  for (const pattern of ["implement", "quick_fix"] as const) {
    test(`${pattern}: 3 retries, then blocked on the 4th gated review`, () => {
      writeWorkItem("RT", pattern === "quick_fix" ? { pattern, phase: "fixing" } : {});
      writeTaskFixture({
        workItemId: "RT",
        taskId: 1,
        phase: "review-test",
        ...(pattern === "quick_fix"
          ? {
              quickFixContract: {
                plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "d" },
                test: { strategy: "new_red_test", red_required: true, command: "bun test" },
              },
            }
          : {}),
      });
      for (let attempt = 1; attempt <= 3; attempt++) {
        applyReviewTestPostResult("RT", CRITICAL, devConfig());
        expect(readTask("RT").control.phase).toBe("phase-test");
        expect(readTask("RT").control.status).toBe("pending");
        setTaskPhase("RT", "review-test");
      }
      const note = applyReviewTestPostResult("RT", CRITICAL, devConfig());
      expect(note).toContain("retry cap reached");
      expect(readTask("RT").control.status).toBe("blocked");
    });
  }
});

describe("review-code → phase-code", () => {
  test("3 retries, then blocked on the 4th gated review", () => {
    writeWorkItem("RC", {});
    writeTaskFixture({
      workItemId: "RC",
      taskId: 1,
      phase: "review-code",
      preImplGates: "complete",
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      applyReviewCodePostResult("RC", CRITICAL, devConfig());
      expect(readTask("RC").control.phase).toBe("phase-code");
      setTaskPhase("RC", "review-code");
    }
    applyReviewCodePostResult("RC", CRITICAL, devConfig());
    expect(readTask("RC").control.status).toBe("blocked");
  });
});

describe("phase-code → phase-test (RGR test_issue) respawns", () => {
  const TEST_ISSUE = {
    status: "done",
    files_changed: ["src/a.ts"],
    test_issues_emitted: 1,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };

  test("3 respawns, then blocked; unblock resets but lifetime cap holds", () => {
    writeWorkItem("RGR", {});
    writeTaskFixture({
      workItemId: "RGR",
      taskId: 1,
      phase: "phase-code",
      preImplGates: "complete",
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const note = applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
      expect(note).toContain(`(rgr ${String(attempt)}/3)`);
      expect(readTask("RGR").control.phase).toBe("phase-test");
      setTaskPhase("RGR", "phase-code");
    }
    const blockedNote = applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
    expect(blockedNote).toContain("RGR respawn cap reached");
    expect(readTask("RGR").control.status).toBe("blocked");
    expect(readTask("RGR").control.phase).toBe("phase-code");

    // Unblock grants another 3 (default max_unblocks_per_task = 1) — unblock reopens the T
    // loop (RGR is a T-loop finding), so drive phase-code again from `phase-code`.
    expect(unblockTask("RGR", 1).ok).toBe(true);
    expect(readTask("RGR").control.phase).toBe("phase-test");
    setTaskPhase("RGR", "phase-code");
    for (let attempt = 1; attempt <= 3; attempt++) {
      applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
      expect(readTask("RGR").control.status).toBe("pending");
      setTaskPhase("RGR", "phase-code");
    }
    // … then the lifetime ceiling (3 × 2) blocks, and a second unblock is refused.
    const lifetimeNote = applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
    expect(lifetimeNote).toContain("LIFETIME");
    expect(readTask("RGR").control.status).toBe("blocked");
    expect(unblockTask("RGR", 1).ok).toBe(false);
  });
});

describe("blocked tasks halt the work item", () => {
  test("resume refuses to skip a blocked task to later tasks or into finish", () => {
    writeWorkItem("HALT", { task_ids: [1, 2] });
    writeTaskFixture({
      workItemId: "HALT",
      taskId: 1,
      phase: "review-test",
      status: "blocked",
      blocked: { kind: "cap", reason: "retry cap reached", ref: "T1/decision", loop: "T" },
    });
    writeTaskFixture({ workItemId: "HALT", taskId: 2, phase: "phase-test", status: "pending" });
    const resolution = resolveResumeOrchestration("HALT", devConfig());
    expect(resolution.outcome).toBe("blocked");
    const text = (resolution.messages ?? []).map((m) => m.text).join("\n");
    expect(text).toContain("task 1");
    expect(text).toContain("unblock");
    // `accord drive` treats these phrases as ready-for-finish — must not appear.
    expect(text).not.toMatch(/all implementation tasks/i);
    expect(text).not.toMatch(/run [`']?\/dev finish/i);
  });

  test("done + blocked is not finish-ready", () => {
    writeWorkItem("FIN", { task_ids: [1, 2] });
    writeTaskFixture({ workItemId: "FIN", taskId: 1, phase: "review-code", status: "done" });
    writeTaskFixture({
      workItemId: "FIN",
      taskId: 2,
      phase: "review-test",
      status: "blocked",
      blocked: { kind: "cap", reason: "retry cap reached", ref: "T1/decision", loop: "T" },
    });
    expect(isFinishReady("FIN", readWorkItem("FIN"))).toBe(false);
    writeTaskFixture({ workItemId: "FIN", taskId: 2, phase: "review-code", status: "done" });
    expect(isFinishReady("FIN", readWorkItem("FIN"))).toBe(true);
  });
});

describe("align ↔ gather", () => {
  test("gather budget persists across resumes, then escalates to decisions[] and stops", async () => {
    writeWorkItem("GATHER", { phase: "aligning", task_ids: [] });
    const spawns: string[] = [];
    const host = {
      notify: () => {},
      spawnSubagent: async (input: { agent: string; task: string }) => {
        spawns.push(input.agent);
        return input.agent === "phase-gather"
          ? {
              exitCode: 0,
              parsedReturn: {
                status: "done",
                context: "more",
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              },
            }
          : {
              exitCode: 0,
              parsedReturn: {
                status: "needs_gather",
                gather_hint: { reason: "still missing context" },
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              },
            };
      },
    };

    // Simulate `accord drive` rounds: keep resuming until the harness stops us.
    let stalled: string | undefined;
    for (let round = 0; round < 10 && !stalled; round++) {
      const out = await runResumeOrchestrationWithReplans("GATHER", devConfig(), host);
      stalled = out.stalledReason;
    }
    expect(stalled).toBe("stuck");
    expect(spawns.filter((a) => a === "phase-gather")).toHaveLength(3);

    const wi = readWorkItem("GATHER");
    const pending = wi.decisions.filter((d) => d.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.question).toContain("3 phase-gather attempt(s)");
    expect(pending[0]?.context).toContain("still missing context");
    // Answering the escalation buys a fresh budget.
    expect(wi.gather_attempts).toBe(0);
  });
});
