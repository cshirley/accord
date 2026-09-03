import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { devResumeState } from "@clive.shirley/accord-core/queries/resume-state.js";
import { loadWorkItem, readJson, TASKS_DIR } from "@clive.shirley/accord-core/work-items/io.js";
import {
  devRehydrateWorkItem,
  rehydrateWorkItemFromArtifacts,
} from "@clive.shirley/accord-core/work-items/rehydrate.js";

const TEST_ID = "REHY-1";
const DEV_DIR = path.join("docs", "dev", TEST_ID);

let cwdBefore: string;
let tempRoot: string;

beforeEach(() => {
  cwdBefore = process.cwd();
  tempRoot = path.join(
    import.meta.dir,
    ".tmp-rehydrate",
    `${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(path.join(tempRoot, ".tasks"), { recursive: true });
  mkdirSync(path.join(tempRoot, DEV_DIR), { recursive: true });
  process.chdir(tempRoot);
});

afterEach(() => {
  process.chdir(cwdBefore);
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function writeMinimalSpec(title = "Rehydrate test feature") {
  writeFileSync(
    path.join(DEV_DIR, "spec.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        work_item_id: TEST_ID,
        title,
        date: "2026-05-19",
        problem_statement: "Problem",
        proposed_solution: "Solution",
        acceptance_criteria: [
          // biome-ignore lint/suspicious/noThenProperty: spec schema Gherkin field name
          { id: "AC-1", given: "g", when: "w", then: "t" },
        ],
        scope: { in: ["x"], out: [] },
        verification: { commands: ["true"], test_cases: [] },
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeMinimalPlan() {
  writeFileSync(
    path.join(DEV_DIR, "plan.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        work_item_id: TEST_ID,
        spec: path.join(DEV_DIR, "spec.json"),
        tasks: [{ id: 1, title: "Task one", acceptance_criteria: ["AC-1"] }],
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("rehydrateWorkItemFromArtifacts", () => {
  test("creates work item at implementing when plan exists", () => {
    writeMinimalSpec();
    writeMinimalPlan();

    const result = rehydrateWorkItemFromArtifacts(TEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rehydrated).toBe(true);
    expect(result.value.phase).toBe("implementing");

    const wi = loadWorkItem(TEST_ID);
    expect(wi?.phase).toBe("implementing");
    expect(wi?.spec).toBe(path.join(DEV_DIR, "spec.json"));
    expect(wi?.plan).toBe(path.join(DEV_DIR, "plan.json"));
    expect(wi?.task_ids).toEqual([1]);
    expect(existsSync(path.join(TASKS_DIR, `${TEST_ID}-task-1.json`))).toBe(true);
  });

  test("lands at planning when only spec exists", () => {
    writeMinimalSpec();
    const result = rehydrateWorkItemFromArtifacts(TEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe("planning");
    expect(loadWorkItem(TEST_ID)?.plan).toBeNull();
  });

  test("is idempotent when work item already exists", () => {
    writeMinimalSpec();
    rehydrateWorkItemFromArtifacts(TEST_ID);
    const again = rehydrateWorkItemFromArtifacts(TEST_ID);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.rehydrated).toBe(false);
  });

  test("fails when no artifacts on disk", () => {
    const result = rehydrateWorkItemFromArtifacts(TEST_ID);
    expect(result.ok).toBe(false);
  });
});

describe("devResumeState", () => {
  test("rehydrates then returns resume state", () => {
    writeMinimalSpec();
    writeMinimalPlan();

    const rs = devResumeState(TEST_ID);
    expect(rs.ok).toBe(true);
    if (!rs.ok) return;
    expect(rs.value.phase).toBe("implementing");
    expect(rs.value.pattern).toBe("implement");
  });
});

describe("devRehydrateWorkItem", () => {
  test("reconcile advances stale aligning when brief exists", () => {
    writeFileSync(path.join(DEV_DIR, "brief.md"), "# My feature\n\nBody.\n", "utf8");
    writeMinimalSpec();

    const result = devRehydrateWorkItem(TEST_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const wi = loadWorkItem(TEST_ID);
    expect(wi?.phase).toBe("planning");
    expect(readJson<{ spec?: string }>(path.join(TASKS_DIR, `${TEST_ID}.json`))?.spec).toBe(
      path.join(DEV_DIR, "spec.json"),
    );
  });
});
