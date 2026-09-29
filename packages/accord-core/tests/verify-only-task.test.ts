import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPhaseVerifyTaskPostResult } from "@clive.shirley/accord-core/orchestration/post-result/phase-verify-task.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import {
  bootstrapImplementTasksFromPlan,
  reconcileVerifyOnlyTasksFromPlan,
} from "@clive.shirley/accord-core/work-items/artifact-discovery.js";
import { writeTaskFixture } from "./helpers/task-fixture.js";

const tmpRoot = join(import.meta.dirname, ".tmp-verify-only");
const originalCwd = process.cwd();

function writeJson(path: string, data: unknown) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readTask(id: string): TaskFileV2 {
  return JSON.parse(readFileSync(join(".tasks", `${id}-task-1.json`), "utf8")) as TaskFileV2;
}

function setupProject() {
  const id = `VOT-${String(Date.now()).slice(-6)}`;
  const root = join(tmpRoot, id);
  mkdirSync(join(root, ".tasks"), { recursive: true });
  mkdirSync(join(root, "docs", "dev", id), { recursive: true });
  process.chdir(root);

  writeJson(join(root, ".tasks", `${id}.json`), {
    schema_version: "1.0",
    id,
    title: "Verify only gate",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    pattern: "implement",
    variant: "standard",
    phase: "implementing",
    spec: `docs/dev/${id}/spec.json`,
    plan: `docs/dev/${id}/plan.json`,
    verify: null,
    brief: null,
    task_ids: [],
    decisions: [],
    deviations: [],
    cost_usd: 0,
  });

  writeJson(join(root, "docs", "dev", id, "spec.json"), {
    schema_version: "1.0",
    work_item_id: id,
    title: "Verify only",
    acceptance_criteria: [
      { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "gate passes" },
    ],
    verification: { commands: ["echo ok"] },
  });

  writeJson(join(root, "docs", "dev", id, "plan.json"), {
    schema_version: "1.0",
    work_item_id: id,
    spec: `docs/dev/${id}/spec.json`,
    tasks: [
      {
        id: 1,
        title: "Full gate",
        covers_ac: ["AC-1"],
        challenge: false,
        files: [],
        steps: [{ tag: "verify", description: "echo ok" }],
      },
    ],
  });

  return { id, root, planPath: `docs/dev/${id}/plan.json` };
}

afterEach(() => {
  process.chdir(originalCwd);
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("verify-only implement tasks", () => {
  test("bootstrap sets phase-verify-task and pre_impl_gates complete", () => {
    const { id, planPath } = setupProject();
    expect(bootstrapImplementTasksFromPlan(id, planPath)).toBe(1);
    const task = readTask(id);
    expect(task.control.phase).toBe("phase-verify-task");
    expect(task.control.pre_impl_gates).toBe("complete");
  });

  test("reconcile migrates a verify-only task stuck at phase-test", () => {
    const { id, planPath } = setupProject();
    writeTaskFixture(
      {
        workItemId: id,
        taskId: 1,
        phase: "phase-test",
        preImplGates: "pending",
        coversAc: ["AC-1"],
      },
      ".",
    );
    writeJson(join(".tasks", `${id}.json`), {
      ...JSON.parse(readFileSync(join(".tasks", `${id}.json`), "utf8")),
      task_ids: [1],
    });

    expect(reconcileVerifyOnlyTasksFromPlan(id, planPath)).toBe(1);
    const task = readTask(id);
    expect(task.control.phase).toBe("phase-verify-task");
    expect(task.control.pre_impl_gates).toBe("complete");
  });

  test("phase-verify-task post-result marks task done", () => {
    const { id, planPath } = setupProject();
    bootstrapImplementTasksFromPlan(id, planPath);
    const packet = {
      status: "done" as const,
      verify_output: "all green",
      ac_covered: ["AC-1"],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const out = applyPhaseVerifyTaskPostResult(id, packet);
    expect(out).toContain("verification passed");
    const task = readTask(id);
    expect(task.control.status).toBe("done");
    expect(task.control.phase).toBe("phase-verify-task");
    // legacy `ac_covered` (no `evidence[]`) is inferred as a pass for each covered AC.
    const ac1 = task.requirements.find((r) => r.id === "AC-1");
    expect(ac1?.verification).toEqual({ by: "V1/phase-verify-task", result: "pass", tests: [] });
    expect(ac1?.status).toBe("satisfied");
  });

  test("phase-verify-task post-result blocks (does not mark done) when verify_output shows a crashed runner", () => {
    const { id, planPath } = setupProject();
    bootstrapImplementTasksFromPlan(id, planPath);
    const packet = {
      status: "done" as const,
      verify_output: "UnhandledPromiseRejectionWarning: Error: boom\n  at foo (bar.js:1:1)\n",
      ac_covered: ["AC-1"],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const out = applyPhaseVerifyTaskPostResult(id, packet);
    expect(out).toContain("CRASH detected");
    const task = readTask(id);
    // Must NOT be marked done on a crashed run — no RED/review cycle downstream would ever
    // catch this otherwise, since verify-only tasks complete in one gate pass.
    expect(task.control.status).toBe("blocked");
    expect(task.control.phase).toBe("phase-verify-task");
    expect(task.control.blocked?.kind).toBe("crash");
    expect(task.control.blocked?.reason).toContain("unhandled promise rejection");
  });
});
