import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  devUnblock,
  parseUnblockArgs,
  tokenizeArgs,
  unblockTask,
} from "@clive.shirley/accord-core/queries/unblock-task.js";
import type { Finding, Requirement, TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import { writeJson } from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { capBlock, readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-unblock-"));
  process.chdir(tempCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function bootstrapWithTasks(taskIds: number[]): void {
  devBootstrap("UNB-1", "Unblock fixture", "implement", "standard");
  const wiPath = join(".tasks", "UNB-1.json");
  const wi = JSON.parse(readFileSync(wiPath, "utf8"));
  wi.task_ids = taskIds;
  writeJson(wiPath, wi);
}

/** A single AC-1 requirement carrying one gating T-loop finding, re-raised 3 times (at cap). */
function reraisedFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "F-001",
    state: "reraised",
    severity: "critical",
    loop: "T",
    issue: "AC-1 negative path untested",
    file: "tests/a.test.ts",
    raised: "T1/review-test",
    history: [
      { by: "T1/review-test", outcome: "reraised" },
      { by: "T2/phase-test", outcome: "fixed", note: "added case" },
      { by: "T2/review-test", outcome: "reraised" },
    ],
    ...overrides,
  };
}

function requirementWithFinding(finding: Finding): Requirement {
  return {
    id: "AC-1",
    requirement: "MUST",
    text: "AC-1 behaviour",
    test_cases: [],
    status: "open",
    changes: [],
    findings: [finding],
    verification: null,
  };
}

/** A task blocked on the test-review retry cap (T loop), 3/3 used, at the default lifetime cap. */
function cappedBlockedFixture(
  overrides: {
    taskId?: number;
    round?: string;
    finding?: Finding;
    retries?: { used: number; lifetime: number };
    unblocks?: number;
  } = {},
): TaskFileV2 {
  const taskId = overrides.taskId ?? 1;
  const finding = overrides.finding ?? reraisedFinding();
  return writeTaskFixture({
    workItemId: "UNB-1",
    taskId,
    phase: "phase-test",
    status: "blocked",
    round: overrides.round ?? "T4",
    blocked: capBlock("T", "test-review retry cap reached"),
    requirements: [requirementWithFinding(finding)],
    retries: {
      test_review: overrides.retries ?? { used: 3, lifetime: 3 },
      unblocks: overrides.unblocks ?? 0,
    },
  });
}

describe("unblockTask — per-blocker decisions on a retry-cap block", () => {
  test("resolving the only blocker resets the loop's `used` counter and bumps unblocks", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture();

    const result = unblockTask("UNB-1", 1, {
      decisions: [{ target: "F-001", action: "note", reason: "use a table-driven negative case" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.unblocked[0]).toMatchObject({
      task_id: 1,
      was_status: "blocked",
      outcome: "retry",
      next_phase: "phase-test",
      retries_reset: { test_review: 3 },
      unblock_count: 1,
    });
    expect(result.value.formatted).toContain("task 1: blocked → phase-test");

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.status).toBe("pending");
    expect(task.control.blocked).toBeNull();
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.round).toBe("T5");
    expect(task.control.retries.test_review).toEqual({ used: 0, lifetime: 3 });
    expect(task.control.retries.unblocks).toBe(1);
    const finding = task.requirements[0]?.findings[0];
    expect(finding?.history.at(-1)).toMatchObject({
      outcome: "note",
      note: "use a table-driven negative case",
      actor: "human",
    });
    const logEntry = task.log.at(-1);
    expect(logEntry).toMatchObject({ ref: "T4/unblock", result: "retry", actor: "human" });
    expect(logEntry?.note).toContain("test_review used reset");
  });

  test("errors when the named task is not blocked", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({ workItemId: "UNB-1", taskId: 1, status: "in_progress" });

    const result = unblockTask("UNB-1", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not blocked");
  });

  test("errors when the work item does not exist", () => {
    const result = unblockTask("NOPE-1", 1);
    expect(result.ok).toBe(false);
  });

  test("errors when an explicitly-named task does not exist", () => {
    bootstrapWithTasks([1]);
    const result = unblockTask("UNB-1", 99);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });

  test("no task_id: unblocks every currently-blocked task, skips others silently", () => {
    bootstrapWithTasks([1, 2, 3]);
    cappedBlockedFixture({ taskId: 1 });
    cappedBlockedFixture({ taskId: 2 });
    writeTaskFixture({ workItemId: "UNB-1", taskId: 3, status: "done" });

    const result = unblockTask("UNB-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unblockedIds = result.value.unblocked.map((u) => u.task_id).sort();
    expect(unblockedIds).toEqual([1, 2]);
    // fixtures carry no working-tree fingerprint on the block, so the blind-unblock guard has
    // nothing to compare against and lets the sweep through as a plain retry-cap reset for each.
    for (const summary of result.value.unblocked) {
      expect(summary.outcome).toBe("retry");
      expect(summary.unblock_count).toBe(1);
    }

    const task3 = readTaskFixture("UNB-1", 3);
    expect(task3.control.status).toBe("done"); // untouched
  });

  test("no task_id, nothing blocked: succeeds with an empty result", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({ workItemId: "UNB-1", taskId: 1, status: "pending" });

    const result = unblockTask("UNB-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked).toHaveLength(0);
    expect(result.value.formatted).toContain("no blocked task(s)");
  });

  test("decisions without an explicit task are refused", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture();
    const result = unblockTask("UNB-1", undefined, {
      decisions: [{ target: "F-001", action: "note", reason: "x" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("need an explicit task");
  });
});

describe("unblockTask — budget & lifetime caps", () => {
  test("refuses once the per-task unblock budget is exhausted", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture({ unblocks: 1 }); // default max_unblocks_per_task is 1 — already spent

    const result = unblockTask("UNB-1", 1, {
      decisions: [{ target: "F-001", action: "note", reason: "spend it anyway" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("unblock budget");
    expect(result.error).toContain("max_unblocks_per_task");

    // Refusing must not mutate the task — still blocked, counters untouched.
    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.status).toBe("blocked");
    expect(task.control.retries.unblocks).toBe(1);
    expect(task.control.retries.test_review).toEqual({ used: 3, lifetime: 3 });
  });

  test("refuses when the loop's lifetime cap has been reached — unblock cannot reset it", () => {
    bootstrapWithTasks([1]);
    // default review-loop cap: maxRetries=3, maxLifetimeRetries=3*(max_unblocks_per_task+1)=6
    cappedBlockedFixture({ retries: { used: 3, lifetime: 6 } });

    const result = unblockTask("UNB-1", 1, {
      decisions: [{ target: "F-001", action: "note", reason: "one more try" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("LIFETIME cap reached");
    expect(result.error).toContain("F-001");

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.status).toBe("blocked");
    expect(task.control.retries.test_review).toEqual({ used: 3, lifetime: 6 });
    expect(task.control.retries.unblocks).toBe(0);
  });

  test("lifetime counters survive a successful reset unchanged", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture({ retries: { used: 3, lifetime: 3 } });

    const result = unblockTask("UNB-1", 1, {
      decisions: [{ target: "F-001", action: "note", reason: "keep going" }],
    });
    expect(result.ok).toBe(true);

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.retries.test_review.lifetime).toBe(3);
    expect(task.control.retries.test_review.used).toBe(0);
    expect(task.control.retries.unblocks).toBe(1);
  });
});

describe("unblockTask — resolving every blocker", () => {
  test("accepting the only blocker advances past the gate without spending unblock budget", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture();

    const result = unblockTask("UNB-1", 1, {
      decisions: [{ target: "F-001", action: "accept", reason: "covered by e2e instead" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]).toMatchObject({
      outcome: "advanced",
      next_phase: "phase-code",
      remaining_blockers: [],
    });

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.status).toBe("pending");
    expect(task.control.blocked).toBeNull();
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.pre_impl_gates).toBe("complete");
    expect(task.control.round).toBe("C1");
    // no budget spent: gate passed on its own, not via a retry-cap reset.
    expect(task.control.retries.unblocks).toBe(0);
    expect(task.control.retries.test_review).toEqual({ used: 3, lifetime: 3 });
    expect(task.requirements[0]?.findings[0]?.history.at(-1)).toMatchObject({
      outcome: "wont_fix_accepted",
    });
  });

  test("--fixed on the only blocker still spends budget but routes straight to the reviewer", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture();

    const result = unblockTask("UNB-1", 1, {
      decisions: [{ target: "F-001", action: "fixed", reason: "I fixed the test myself" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]).toMatchObject({
      outcome: "retry",
      next_phase: "review-test",
    });

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.phase).toBe("review-test");
    expect(task.control.pre_impl_gates).toBe("pending");
    // human-fixed still resets the loop and spends the unblock budget — the reviewer must
    // recheck it, unlike an accepted/waived blocker.
    expect(task.control.retries.test_review.used).toBe(0);
    expect(task.control.retries.unblocks).toBe(1);
    expect(task.requirements[0]?.findings[0]?.history.at(-1)?.outcome).toBe("fixed");
  });
});

describe("unblockTask — blind-unblock guard", () => {
  test("refuses a decision-less unblock when the working tree hasn't changed since the block", () => {
    bootstrapWithTasks([1]);
    const task = cappedBlockedFixture();
    task.control.blocked = { ...task.control.blocked!, fingerprint: "same-tree" };
    writeTaskFixture({
      workItemId: "UNB-1",
      taskId: 1,
      phase: task.control.phase,
      status: "blocked",
      round: task.control.round,
      blocked: task.control.blocked,
      requirements: task.requirements,
      retries: { test_review: task.control.retries.test_review, unblocks: 0 },
    });

    const blind = unblockTask("UNB-1", 1, { fingerprint: () => "same-tree" });
    expect(blind.ok).toBe(false);
    if (blind.ok) return;
    expect(blind.error).toContain("Blind unblock refused");
    expect(blind.error).toContain("F-001");

    const after = readTaskFixture("UNB-1", 1);
    expect(after.control.status).toBe("blocked");
    expect(after.control.retries.unblocks).toBe(0);
  });

  test("--force overrides the blind-unblock guard and is noted in the log", () => {
    bootstrapWithTasks([1]);
    const task = cappedBlockedFixture();
    task.control.blocked = { ...task.control.blocked!, fingerprint: "same-tree" };
    writeTaskFixture({
      workItemId: "UNB-1",
      taskId: 1,
      phase: task.control.phase,
      status: "blocked",
      round: task.control.round,
      blocked: task.control.blocked,
      requirements: task.requirements,
      retries: { test_review: task.control.retries.test_review, unblocks: 0 },
    });

    const result = unblockTask("UNB-1", 1, {
      fingerprint: () => "same-tree",
      force: "human eyeballed it, code is fine",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]).toMatchObject({ outcome: "retry", unblock_count: 1 });

    const after = readTaskFixture("UNB-1", 1);
    expect(after.control.status).toBe("pending");
    expect(after.log.at(-1)?.note).toContain("forced: human eyeballed it, code is fine");
  });

  test("a fingerprint that differs from the block's needs no --force", () => {
    bootstrapWithTasks([1]);
    const task = cappedBlockedFixture();
    task.control.blocked = { ...task.control.blocked!, fingerprint: "before" };
    writeTaskFixture({
      workItemId: "UNB-1",
      taskId: 1,
      phase: task.control.phase,
      status: "blocked",
      round: task.control.round,
      blocked: task.control.blocked,
      requirements: task.requirements,
      retries: { test_review: task.control.retries.test_review, unblocks: 0 },
    });

    const result = unblockTask("UNB-1", 1, { fingerprint: () => "after-a-fix" });
    expect(result.ok).toBe(true);
  });
});

describe("unblockTask — non-cap blocks release without spending budget", () => {
  test("a manual block is released and resumed as-is (no round change)", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({
      workItemId: "UNB-1",
      taskId: 1,
      phase: "phase-code",
      status: "blocked",
      round: "C2",
      blocked: { kind: "manual", reason: "human paused it", ref: "C2/block" },
      retries: { code_review: { used: 1, lifetime: 1 } },
    });

    const result = unblockTask("UNB-1", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]).toMatchObject({
      outcome: "resumed",
      next_phase: "phase-code",
    });

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.status).toBe("pending");
    expect(task.control.blocked).toBeNull();
    expect(task.control.round).toBe("C2"); // unchanged — this was a manual pause, not a retry cap
    expect(task.control.retries.code_review).toEqual({ used: 1, lifetime: 1 }); // untouched
    expect(task.control.retries.unblocks).toBe(0); // no budget spent to release a manual block
  });

  test("a crash block is released and opens a fresh round for the same loop", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({
      workItemId: "UNB-1",
      taskId: 1,
      phase: "phase-test",
      status: "blocked",
      round: "T1",
      blocked: { kind: "crash", reason: "agent process crashed", ref: "T1/phase-test" },
    });

    const result = unblockTask("UNB-1", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0].outcome).toBe("resumed");

    const task = readTaskFixture("UNB-1", 1);
    expect(task.control.status).toBe("pending");
    expect(task.control.round).toBe("T2");
    expect(task.control.retries.unblocks).toBe(0);
  });
});

describe("tokenizeArgs / parseUnblockArgs", () => {
  test("splits quoted reasons as single tokens and unescapes embedded quotes", () => {
    expect(tokenizeArgs('UNB-1 --task 1 --note F-001 "use a table-driven case"')).toEqual([
      "UNB-1",
      "--task",
      "1",
      "--note",
      "F-001",
      "use a table-driven case",
    ]);
    expect(tokenizeArgs(String.raw`--force "she said \"ok\""`)).toEqual([
      "--force",
      'she said "ok"',
    ]);
  });

  test("parses multiple decisions with quoted reasons, in order", () => {
    const parsed = parseUnblockArgs(
      tokenizeArgs(
        'UNB-1 --task 1 --fixed F-001 "human added the case" --accept AC-2 "waived by PM" --waive F-003 "not worth it"',
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.workItemId).toBe("UNB-1");
    expect(parsed.taskId).toBe(1);
    expect(parsed.decisions).toEqual([
      { target: "F-001", action: "fixed", reason: "human added the case" },
      { target: "AC-2", action: "accept", reason: "waived by PM" },
      { target: "F-003", action: "waive", reason: "not worth it" },
    ]);
  });

  test("rejects a decision flag missing a target or a quoted reason", () => {
    const missingTarget = parseUnblockArgs(tokenizeArgs("UNB-1 --note"));
    expect(missingTarget.errors[0]).toContain("needs a target");

    const missingReason = parseUnblockArgs(tokenizeArgs("UNB-1 --fixed F-001 --accept"));
    expect(missingReason.errors[0]).toContain("needs a quoted reason");
  });

  test("--task and a positional task_id both resolve to a numeric taskId", () => {
    const viaFlag = parseUnblockArgs(tokenizeArgs("UNB-1 --task 3"));
    expect(viaFlag.taskId).toBe(3);
    const viaPositional = parseUnblockArgs(tokenizeArgs("UNB-1 3"));
    expect(viaPositional.taskId).toBe(3);
  });

  test("--force needs a quoted reason", () => {
    const parsed = parseUnblockArgs(tokenizeArgs("UNB-1 --task 1 --force"));
    expect(parsed.errors[0]).toContain("--force needs a quoted reason");
  });
});

describe("devUnblock", () => {
  test("parses `<ID> [task_id]` and requires a work item id", () => {
    bootstrapWithTasks([1]);
    cappedBlockedFixture();

    const missingId = devUnblock("");
    expect(missingId.ok).toBe(false);

    const badTaskId = devUnblock("UNB-1 not-a-number");
    expect(badTaskId.ok).toBe(false);

    const result = devUnblock('UNB-1 1 --note F-001 "note from CLI"');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]?.task_id).toBe(1);
    expect(result.value.unblocked[0]?.outcome).toBe("retry");
  });

  test("surfaces parse errors alongside the usage string", () => {
    const result = devUnblock("UNB-1 --note F-001");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("needs a quoted reason");
    expect(result.error).toContain("Usage:");
  });
});
