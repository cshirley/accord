import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  enrichmentsDirRelForWorkItem,
  listWorkItemFileRefs,
  resolveTasksDir,
  resolveWorkItemFilePath,
} from "../src/core/work-items/tasks-dir.js";

const TEST_ID = "STEP-99999";
let cwdBefore: string;
let tempRoot: string;

beforeEach(() => {
  cwdBefore = process.cwd();
  tempRoot = join(
    tmpdir(),
    `accord-tasks-dir-${String(Date.now())}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(join(tempRoot, ".git"), { recursive: true });
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

describe("resolveTasksDir", () => {
  test("finds nested package .tasks when cwd is git root", () => {
    const pkgTasks = join("apps", "partner-portal", ".tasks");
    mkdirSync(join(pkgTasks), { recursive: true });
    writeFileSync(
      join(pkgTasks, `${TEST_ID}.json`),
      JSON.stringify({ schema_version: "1.0", id: TEST_ID, title: "t", phase: "aligning" }),
      "utf8",
    );

    expect(resolveWorkItemFilePath(TEST_ID)).toBe(resolve(pkgTasks, `${TEST_ID}.json`));
    expect(resolveTasksDir(TEST_ID)).toBe(resolve(pkgTasks));
    expect(enrichmentsDirRelForWorkItem(TEST_ID)).toBe(
      "apps/partner-portal/.tasks/STEP-99999-enrichments",
    );
  });

  test("prefers cwd .tasks when work item exists there", () => {
    mkdirSync(".tasks", { recursive: true });
    writeFileSync(join(".tasks", `${TEST_ID}.json`), '{"id":"STEP-99999"}', "utf8");

    expect(resolveTasksDir(TEST_ID)).toBe(resolve(".tasks"));
  });

  test("listWorkItemFileRefs discovers nested work items from repo root cwd", () => {
    const pkgTasks = join("apps", "portal", ".tasks");
    mkdirSync(pkgTasks, { recursive: true });
    writeFileSync(join(pkgTasks, `${TEST_ID}.json`), '{"id":"STEP-99999"}', "utf8");

    const refs = listWorkItemFileRefs();
    expect(refs.some((r) => r.id === TEST_ID && r.tasksDir.endsWith("apps/portal/.tasks"))).toBe(
      true,
    );
  });
});
