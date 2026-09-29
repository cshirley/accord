import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { blockTask, devBlock } from "@clive.shirley/accord-core/queries/block-task.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import { writeJson } from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

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

function bootstrapWithTasks(taskIds: number[]): void {
  devBootstrap("BLK-1", "Block fixture", "implement", "standard");
  const wiPath = join(".tasks", "BLK-1.json");
  const wi = JSON.parse(readFileSync(wiPath, "utf8"));
  wi.task_ids = taskIds;
  writeJson(wiPath, wi);
}

describe("blockTask", () => {
  test("forces an in-progress task to blocked and records a manual block + log entry", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({
      workItemId: "BLK-1",
      taskId: 1,
      phase: "phase-code",
      status: "in_progress",
      round: "C2",
      retries: { code_review: { used: 2, lifetime: 2 } },
    });

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

    const task: TaskFileV2 = readTaskFixture("BLK-1", 1);
    expect(task.control.status).toBe("blocked");
    expect(task.control.blocked).toEqual({
      kind: "manual",
      reason: "stuck in adversarial test/review loop",
      ref: "C2/block",
    });
    // Retry counters are left untouched — blocking is a status override, not a reset.
    expect(task.control.retries.code_review).toEqual({ used: 2, lifetime: 2 });
    const entry = task.log.at(-1);
    expect(entry).toMatchObject({
      ref: "C2/block",
      result: "blocked",
      note: "stuck in adversarial test/review loop",
      actor: "human",
    });
  });

  test("errors without a reason", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({ workItemId: "BLK-1", taskId: 1, status: "in_progress" });

    const result = blockTask("BLK-1", 1, "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("requires a reason");
  });

  test("errors when the task is already blocked", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({
      workItemId: "BLK-1",
      taskId: 1,
      status: "blocked",
      blocked: { kind: "manual", reason: "already stuck", ref: "T1/block" },
    });

    const result = blockTask("BLK-1", 1, "already stuck again");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("already blocked");
  });

  test("errors when the task is already done", () => {
    bootstrapWithTasks([1]);
    writeTaskFixture({ workItemId: "BLK-1", taskId: 1, status: "done" });

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
    writeTaskFixture({ workItemId: "BLK-1", taskId: 1, status: "in_progress" });

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
