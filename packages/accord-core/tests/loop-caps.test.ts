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

function writeTask(id: string, taskId: number, body: Record<string, unknown>): void {
  writeFileSync(
    join(".tasks", `${id}-task-${String(taskId)}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      work_item_id: id,
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

function readTask(id: string, taskId = 1): Record<string, unknown> {
  return JSON.parse(readFileSync(join(".tasks", `${id}-task-${String(taskId)}.json`), "utf8"));
}

function readWorkItem(id: string): WorkItem {
  return JSON.parse(readFileSync(join(".tasks", `${id}.json`), "utf8"));
}

function setTaskPhase(id: string, phase: string): void {
  const task = readTask(id);
  writeFileSync(
    join(".tasks", `${id}-task-1.json`),
    `${JSON.stringify({ ...task, phase, status: "pending" })}\n`,
  );
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
      writeTask("RT", 1, {
        phase: "review-test",
        ...(pattern === "quick_fix"
          ? {
              quick_fix_contract: {
                plan: { summary: "s", target_paths: [], out_of_scope: [], expected_finish: "d" },
                test: { strategy: "new_red_test", red_required: true, command: "bun test" },
              },
            }
          : {}),
      });
      for (let attempt = 1; attempt <= 3; attempt++) {
        applyReviewTestPostResult("RT", CRITICAL, devConfig());
        expect(readTask("RT").phase).toBe("phase-test");
        expect(readTask("RT").status).toBe("pending");
        setTaskPhase("RT", "review-test");
      }
      const note = applyReviewTestPostResult("RT", CRITICAL, devConfig());
      expect(note).toContain("retry cap reached");
      expect(readTask("RT").status).toBe("blocked");
    });
  }
});

describe("review-code → phase-code", () => {
  test("3 retries, then blocked on the 4th gated review", () => {
    writeWorkItem("RC", {});
    writeTask("RC", 1, { phase: "review-code", pre_impl_gates: "complete" });
    for (let attempt = 1; attempt <= 3; attempt++) {
      applyReviewCodePostResult("RC", CRITICAL, devConfig());
      expect(readTask("RC").phase).toBe("phase-code");
      setTaskPhase("RC", "review-code");
    }
    applyReviewCodePostResult("RC", CRITICAL, devConfig());
    expect(readTask("RC").status).toBe("blocked");
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
    writeTask("RGR", 1, { phase: "phase-code", pre_impl_gates: "complete" });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const note = applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
      expect(note).toContain(`RGR respawn ${String(attempt)} / 3`);
      expect(readTask("RGR").phase).toBe("phase-test");
      setTaskPhase("RGR", "phase-code");
    }
    const blockedNote = applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
    expect(blockedNote).toContain("RGR respawn cap reached");
    expect(readTask("RGR").status).toBe("blocked");
    expect(readTask("RGR").phase).toBe("phase-code");

    // Unblock grants another 3 (default max_unblocks_per_task = 1) …
    expect(unblockTask("RGR", 1).ok).toBe(true);
    for (let attempt = 1; attempt <= 3; attempt++) {
      applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
      expect(readTask("RGR").status).toBe("pending");
      setTaskPhase("RGR", "phase-code");
    }
    // … then the lifetime ceiling (3 × 2) blocks, and a second unblock is refused.
    const lifetimeNote = applyPhaseCodePostResult("RGR", TEST_ISSUE, devConfig());
    expect(lifetimeNote).toContain("LIFETIME");
    expect(readTask("RGR").status).toBe("blocked");
    expect(unblockTask("RGR", 1).ok).toBe(false);
  });
});

describe("blocked tasks halt the work item", () => {
  test("resume refuses to skip a blocked task to later tasks or into finish", () => {
    writeWorkItem("HALT", { task_ids: [1, 2] });
    writeTask("HALT", 1, { phase: "review-test", status: "blocked" });
    writeTask("HALT", 2, { phase: "phase-test", status: "pending" });
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
    writeTask("FIN", 1, { phase: "review-code", status: "done" });
    writeTask("FIN", 2, { phase: "review-test", status: "blocked" });
    expect(isFinishReady("FIN", readWorkItem("FIN"))).toBe(false);
    writeTask("FIN", 2, { phase: "review-code", status: "done" });
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
