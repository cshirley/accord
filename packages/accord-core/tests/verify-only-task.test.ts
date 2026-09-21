import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPhaseVerifyTaskPostResult } from "@clive.shirley/accord-core/orchestration/post-result/phase-verify-task.js";
import {
  bootstrapImplementTasksFromPlan,
  reconcileVerifyOnlyTasksFromPlan,
} from "@clive.shirley/accord-core/work-items/artifact-discovery.js";

const tmpRoot = join(import.meta.dirname, ".tmp-verify-only");
const originalCwd = process.cwd();

function writeJson(path: string, data: unknown) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
    const task = JSON.parse(readFileSync(join(".tasks", `${id}-task-1.json`), "utf8")) as {
      phase: string;
      pre_impl_gates: string;
    };
    expect(task.phase).toBe("phase-verify-task");
    expect(task.pre_impl_gates).toBe("complete");
  });

  test("reconcile migrates legacy phase-test verify-only task", () => {
    const { id, planPath } = setupProject();
    writeJson(join(".tasks", `${id}-task-1.json`), {
      schema_version: "1.0",
      work_item_id: id,
      task_id: 1,
      owner_nonce: "aabbcc",
      phase: "phase-test",
      status: "pending",
      pre_impl_gates: "pending",
      test_files: [],
      events: [],
    });
    writeJson(join(".tasks", `${id}.json`), {
      ...JSON.parse(readFileSync(join(".tasks", `${id}.json`), "utf8")),
      task_ids: [1],
    });

    expect(reconcileVerifyOnlyTasksFromPlan(id, planPath)).toBe(1);
    const task = JSON.parse(readFileSync(join(".tasks", `${id}-task-1.json`), "utf8")) as {
      phase: string;
      pre_impl_gates: string;
    };
    expect(task.phase).toBe("phase-verify-task");
    expect(task.pre_impl_gates).toBe("complete");
  });

  test("phase-verify-task post-result marks task done", () => {
    const { id, planPath } = setupProject();
    bootstrapImplementTasksFromPlan(id, planPath);
    writeJson(join(".tasks", `${id}.json`), {
      ...JSON.parse(readFileSync(join(".tasks", `${id}.json`), "utf8")),
      task_ids: [1],
    });
    const packet = {
      status: "done" as const,
      verify_output: "all green",
      ac_covered: ["AC-1"],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const out = applyPhaseVerifyTaskPostResult(id, packet);
    expect(out).toContain("verify-only");
    const task = JSON.parse(readFileSync(join(".tasks", `${id}-task-1.json`), "utf8")) as {
      status: string;
      phase: string;
      events: Array<{ type: string }>;
    };
    expect(task.status).toBe("done");
    expect(task.phase).toBe("phase-verify-task");
    expect(task.events.some((e) => e.type === "implement_verify_task_applied")).toBe(true);
  });
});
