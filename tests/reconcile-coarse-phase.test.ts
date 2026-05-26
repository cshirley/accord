import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { reconcileCoarsePhaseBeforeResume } from "../src/core/orchestration/reconcile-coarse-phase.js";
import { devBootstrap } from "../src/core/work-items/lifecycle.js";
import { loadWorkItem } from "../src/core/work-items/io.js";
import { devCheckpointWrite } from "../src/core/work-items/checkpoint.js";

let tempRoot: string;
let cwdBefore: string;

beforeEach(() => {
  cwdBefore = process.cwd();
  tempRoot = join(import.meta.dir, ".tmp-reconcile");
  mkdirSync(tempRoot, { recursive: true });
});

afterEach(() => {
  process.chdir(cwdBefore);
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("reconcileCoarsePhaseBeforeResume", () => {
  test("advances planning → implementing when plan complete despite stale checkpoint", () => {
    const project = join(tempRoot, `p-${Date.now()}`);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    mkdirSync(join(project, "docs", "dev", "REC-1"), { recursive: true });
    process.chdir(project);

    writeFileSync(
      join("docs", "dev", "REC-1", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "REC-1",
        spec: "docs/dev/REC-1/spec.json",
        tasks: [{ id: 1, title: "t", covers_ac: ["AC-1"], challenge: false, files: [], steps: [] }],
        guidance: [],
      })}\n`,
      "utf8",
    );

    devBootstrap("REC-1", "Reconcile plan", "implement", "standard");
    const wiPath = join(".tasks", "REC-1.json");
    const wi = loadWorkItem("REC-1");
    if (wi) {
      wi.phase = "planning";
      wi.spec = "docs/dev/REC-1/spec.json";
      writeFileSync(wiPath, `${JSON.stringify(wi)}\n`, "utf8");
    }

    devCheckpointWrite("REC-1", {
      schema_version: "1.0",
      work_item_id: "REC-1",
      phase: "planning",
      draft: {},
      answered: [],
      pending: ["q1"],
    });

    const result = reconcileCoarsePhaseBeforeResume("REC-1");
    expect(result.advanced).toBe(true);
    expect(result.toPhase).toBe("implementing");
    expect(loadWorkItem("REC-1")?.phase).toBe("implementing");
    expect(existsSync(join(".tasks", "REC-1-task-1.json"))).toBe(true);
  });
});
