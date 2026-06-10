import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import * as path from "node:path";
import { devWorkItemStatus } from "../src/core/queries/work-item-status.js";
import { TASKS_DIR, writeJson } from "../src/core/work-items/io.js";
import type { TaskFile, WorkItem } from "../src/core/work-items/types.js";

const WI_ID = "WISTAT-1";
const wiPath = path.join(TASKS_DIR, `${WI_ID}.json`);
const taskPath = path.join(TASKS_DIR, `${WI_ID}-task-1.json`);
const devDir = path.join("docs", "dev", WI_ID);
const planPath = path.join(devDir, "plan.json");

function cleanup() {
  for (const p of [wiPath, taskPath]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  try {
    rmSync(devDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

afterEach(() => cleanup());

describe("devWorkItemStatus", () => {
  test("finish nudge when all implementation tasks are terminal", () => {
    cleanup();
    const wi: WorkItem = {
      schema_version: "1.0",
      id: WI_ID,
      title: "Status test",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      task_ids: [1],
      plan: `docs/dev/${WI_ID}/plan.json`,
    };
    writeJson(wiPath, wi);

    mkdirSync(devDir, { recursive: true });
    writeFileSync(
      planPath,
      `${JSON.stringify(
        {
          schema_version: "1.0",
          work_item_id: WI_ID,
          tasks: [{ id: 1, title: "Task 1", steps: [] }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const task: TaskFile = {
      schema_version: "1.0",
      work_item_id: WI_ID,
      task_id: 1,
      owner_nonce: "abc123",
      phase: "phase-code",
      status: "done",
      pre_impl_gates: "complete",
      events: [],
    };
    writeJson(taskPath, task);

    const result = devWorkItemStatus(WI_ID, null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finish_nudge).toContain("/dev finish");
    expect(result.value.next_resume_agent).toBeNull();
  });
});
