import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devUnblock, unblockTask } from "@clive.shirley/accord-core/queries/unblock-task.js";
import { writeJson } from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { taskJsonPath } from "@clive.shirley/accord-core/work-items/tasks-dir.js";

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

function blockedTaskFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "1.0",
    work_item_id: "UNB-1",
    task_id: 1,
    owner_nonce: "abc123",
    phase: "review-test",
    status: "blocked",
    events: [{ type: "implement_review_test_blocked", at: "2026-01-01T00:00:00.000Z" }],
    review_loop: { test_review_retries_used: 3, code_review_retries_used: 0 },
    quick_fix_loop: { test_review_cycles_used: 3 },
    last_review_feedback: {
      agent: "review-test",
      verdict: "issues",
      findings: [
        { severity: "critical", issue: "a" },
        { severity: "critical", issue: "b" },
      ],
    },
    ...overrides,
  };
}

function bootstrapWithTasks(taskIds: number[]): void {
  devBootstrap("UNB-1", "Unblock fixture", "implement", "standard");
  const wiPath = join(".tasks", "UNB-1.json");
  const wi = JSON.parse(readFileSync(wiPath, "utf8"));
  wi.task_ids = taskIds;
  writeJson(wiPath, wi);
}

describe("unblockTask", () => {
  test("resets a specific blocked task's status and retry counters", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("UNB-1", 1), blockedTaskFixture());

    const result = unblockTask("UNB-1", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.unblocked).toHaveLength(1);
    expect(result.value.unblocked[0]).toMatchObject({
      task_id: 1,
      was_status: "blocked",
      retries_reset: { test_review_retries_used: 3, code_review_retries_used: 0 },
      last_review_verdict: "issues",
      last_review_finding_count: 2,
    });
    expect(result.value.formatted).toContain("task 1: blocked → pending");
    expect(result.value.formatted).toContain("accord resume UNB-1");

    const task = JSON.parse(readFileSync(taskJsonPath("UNB-1", 1), "utf8"));
    expect(task.status).toBe("pending");
    expect(task.review_loop).toEqual({
      test_review_retries_used: 0,
      code_review_retries_used: 0,
      lifetime_test_review_cycles: 0,
      lifetime_code_review_cycles: 0,
      unblock_count: 1,
    });
    expect(task.quick_fix_loop).toEqual({ test_review_cycles_used: 0 });
    // last_review_feedback / events are left in place as history, not scrubbed.
    expect(task.last_review_feedback.verdict).toBe("issues");
  });

  test("errors when the named task is not blocked", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("UNB-1", 1), blockedTaskFixture({ status: "in_progress" }));

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
    writeJson(taskJsonPath("UNB-1", 1), blockedTaskFixture({ task_id: 1 }));
    writeJson(taskJsonPath("UNB-1", 2), blockedTaskFixture({ task_id: 2 }));
    writeJson(taskJsonPath("UNB-1", 3), blockedTaskFixture({ task_id: 3, status: "done" }));

    const result = unblockTask("UNB-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const unblockedIds = result.value.unblocked.map((u) => u.task_id).sort();
    expect(unblockedIds).toEqual([1, 2]);

    const task3 = JSON.parse(readFileSync(taskJsonPath("UNB-1", 3), "utf8"));
    expect(task3.status).toBe("done"); // untouched
  });

  test("no task_id, nothing blocked: succeeds with an empty result", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("UNB-1", 1), blockedTaskFixture({ status: "pending" }));

    const result = unblockTask("UNB-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked).toHaveLength(0);
    expect(result.value.formatted).toContain("no blocked task(s)");
  });

  test("refuses to reset a task that has already used its lifetime unblock budget", () => {
    bootstrapWithTasks([1]);
    writeJson(
      taskJsonPath("UNB-1", 1),
      blockedTaskFixture({
        review_loop: {
          test_review_retries_used: 3,
          code_review_retries_used: 0,
          lifetime_test_review_cycles: 3,
          lifetime_code_review_cycles: 0,
          unblock_count: 1, // default max_unblocks_per_task is 1 \u2014 already spent
        },
      }),
    );

    const result = unblockTask("UNB-1", 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("lifetime unblock budget");
    expect(result.error).toContain("max_unblocks_per_task");

    // Refusing must not mutate the task \u2014 still blocked, counters untouched.
    const task = JSON.parse(readFileSync(taskJsonPath("UNB-1", 1), "utf8"));
    expect(task.status).toBe("blocked");
    expect(task.review_loop.unblock_count).toBe(1);
    expect(task.review_loop.test_review_retries_used).toBe(3);
  });

  test("first unblock succeeds and increments unblock_count without touching lifetime cycles", () => {
    bootstrapWithTasks([1]);
    writeJson(
      taskJsonPath("UNB-1", 1),
      blockedTaskFixture({
        review_loop: {
          test_review_retries_used: 3,
          code_review_retries_used: 0,
          lifetime_test_review_cycles: 3,
          lifetime_code_review_cycles: 0,
          unblock_count: 0,
        },
      }),
    );

    const result = unblockTask("UNB-1", 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]).toMatchObject({ unblock_count: 1 });

    const task = JSON.parse(readFileSync(taskJsonPath("UNB-1", 1), "utf8"));
    expect(task.status).toBe("pending");
    expect(task.review_loop).toEqual({
      test_review_retries_used: 0,
      code_review_retries_used: 0,
      // Lifetime cycles survive the reset unchanged \u2014 this is the hard ceiling that a
      // second unblock (once permitted by a raised `max_unblocks_per_task`) still can't erase.
      lifetime_test_review_cycles: 3,
      lifetime_code_review_cycles: 0,
      unblock_count: 1,
    });
  });

  test("devUnblock parses `<ID> [task_id]` and requires a work item id", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("UNB-1", 1), blockedTaskFixture());

    const missingId = devUnblock("");
    expect(missingId.ok).toBe(false);

    const badTaskId = devUnblock("UNB-1 not-a-number");
    expect(badTaskId.ok).toBe(false);

    const result = devUnblock("UNB-1 1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unblocked[0]?.task_id).toBe(1);
  });
});
