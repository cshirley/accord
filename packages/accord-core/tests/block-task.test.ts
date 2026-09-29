import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { blockTask, devBlock } from "@clive.shirley/accord-core/queries/block-task.js";
import { writeJson } from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { taskJsonPath } from "@clive.shirley/accord-core/work-items/tasks-dir.js";

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-block-"));
  process.chdir(tempCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function inProgressTaskFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "1.0",
    work_item_id: "BLK-1",
    task_id: 1,
    owner_nonce: "abc123",
    phase: "review-test",
    status: "in_progress",
    events: [],
    review_loop: { test_review_retries_used: 2, code_review_retries_used: 0 },
    ...overrides,
  };
}

function bootstrapWithTasks(taskIds: number[]): void {
  devBootstrap("BLK-1", "Block fixture", "implement", "standard");
  const wiPath = join(".tasks", "BLK-1.json");
  const wi = JSON.parse(readFileSync(wiPath, "utf8"));
  wi.task_ids = taskIds;
  writeJson(wiPath, wi);
}

describe("blockTask", () => {
  test("forces an in-progress task to blocked and records the reason as an escalation event", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("BLK-1", 1), inProgressTaskFixture());

    const result = blockTask("BLK-1", 1, "stuck in adversarial test/review loop");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.blocked).toMatchObject({
      task_id: 1,
      was_status: "in_progress",
      reason: "stuck in adversarial test/review loop",
    });
    expect(result.value.formatted).toContain("task 1 in_progress → blocked");
    expect(result.value.formatted).toContain("/dev unblock BLK-1 1");

    const task = JSON.parse(readFileSync(taskJsonPath("BLK-1", 1), "utf8"));
    expect(task.status).toBe("blocked");
    // Retry counters are left untouched \u2014 blocking is a status override, not a reset.
    expect(task.review_loop).toEqual({ test_review_retries_used: 2, code_review_retries_used: 0 });
    expect(task.events).toHaveLength(1);
    expect(task.events[0]).toMatchObject({
      type: "escalation",
      question: "Manually blocked via /dev block",
      context: "stuck in adversarial test/review loop",
    });
  });

  test("errors without a reason", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("BLK-1", 1), inProgressTaskFixture());

    const result = blockTask("BLK-1", 1, "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("requires a reason");
  });

  test("errors when the task is already blocked", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("BLK-1", 1), inProgressTaskFixture({ status: "blocked" }));

    const result = blockTask("BLK-1", 1, "already stuck");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("already blocked");
  });

  test("errors when the task is already done", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("BLK-1", 1), inProgressTaskFixture({ status: "done" }));

    const result = blockTask("BLK-1", 1, "too late");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("already done");
  });

  test("errors when the work item does not exist", () => {
    const result = blockTask("NOPE-1", 1, "no such work item");
    expect(result.ok).toBe(false);
  });

  test("errors when the named task does not exist", () => {
    bootstrapWithTasks([1]);
    const result = blockTask("BLK-1", 99, "no such task");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not found");
  });

  test("devBlock parses `<ID> <task_id> <reason...>` and requires all three", () => {
    bootstrapWithTasks([1]);
    writeJson(taskJsonPath("BLK-1", 1), inProgressTaskFixture());

    const missingId = devBlock("");
    expect(missingId.ok).toBe(false);

    const missingTaskId = devBlock("BLK-1");
    expect(missingTaskId.ok).toBe(false);

    const badTaskId = devBlock("BLK-1 not-a-number some reason");
    expect(badTaskId.ok).toBe(false);

    const result = devBlock("BLK-1 1 stuck in adversarial test/review loop");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blocked.task_id).toBe(1);
    expect(result.value.blocked.reason).toBe("stuck in adversarial test/review loop");
  });
});
