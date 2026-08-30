import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isFinishReady,
  missingArtifactsForWorkItem,
  resolveDashboardActionHint,
  resolveReadOnlyResumeAgent,
} from "../src/core/queries/dashboard-hints.js";
import { devTasks } from "../src/core/queries/dashboard.js";
import { writeJson } from "../src/core/work-items/io.js";
import { devBootstrap } from "../src/core/work-items/lifecycle.js";
import type { TaskFile, WorkItem } from "../src/core/work-items/types.js";

function tempProject(): string {
  const dir = join("/tmp", `accord-dash-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("dashboard hints", () => {
  const prev = process.cwd();
  afterEach(() => {
    process.chdir(prev);
  });

  test("missingArtifactsForWorkItem flags plan in implementing", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("HINT-1", "hint test", "implement", "standard");
    const wi = {
      id: "HINT-1",
      pattern: "implement",
      phase: "implementing",
      brief: null,
      spec: null,
      plan: null,
    } as WorkItem;
    expect(missingArtifactsForWorkItem(wi)).toContain("plan");
    expect(missingArtifactsForWorkItem(wi)).toContain("spec");
  });

  test("resolveDashboardActionHint suggests finish when tasks terminal", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("HINT-2", "finish ready", "implement", "standard");
    const wiPath = join(".tasks", "HINT-2.json");
    const wi = JSON.parse(readFileSync(wiPath, "utf8")) as WorkItem;
    wi.phase = "implementing";
    wi.pattern = "implement";
    wi.task_ids = [1];
    writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`);
    writeJson(join(".tasks", "HINT-2-task-1.json"), {
      status: "done",
      phase: "phase-code",
    } satisfies Partial<TaskFile>);
    expect(isFinishReady("HINT-2", wi)).toBe(true);
    expect(
      resolveDashboardActionHint("HINT-2", wi, {
        pending_decisions: 0,
        pending_deviations: 0,
      }),
    ).toBe("→ finish");
  });

  test("resolveReadOnlyResumeAgent maps coarse speccing to phase-spec", () => {
    const wi = {
      id: "HINT-3",
      pattern: "implement",
      phase: "speccing",
    } as WorkItem;
    expect(resolveReadOnlyResumeAgent("HINT-3", wi)).toBe("phase-spec");
  });
});

describe("devTasks with hints", () => {
  const prev = process.cwd();
  afterEach(() => {
    process.chdir(prev);
  });

  test("formatted output includes action hint for speccing work item", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("HINT-4", "with hint", "implement", "standard");
    const wiPath = join(".tasks", "HINT-4.json");
    const wi = JSON.parse(readFileSync(wiPath, "utf8")) as WorkItem;
    wi.phase = "speccing";
    writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`);
    const r = devTasks();
    expect(r.formatted).toMatch(/HINT-4\s+imp\/std\s+spec/);
    expect(r.formatted).toContain("resume (phase-spec)");
    expect(r.rows[0]?.action_hint).toBe("→ resume (phase-spec)");
  });
});
