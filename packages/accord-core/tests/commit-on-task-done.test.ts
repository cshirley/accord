import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  commitDoneTasks,
  commitWorkItemArtifacts,
  pathMatchesCandidate,
  tryCommitOnTaskDone,
} from "@clive.shirley/accord-core/orchestration/commit-on-task-done.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TASK = join(here, "..", "schemas", "task-file.example.json");
const ID = "TRACE-1";

let originalCwd: string;
let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function exampleTask(taskId: number, status: TaskFileV2["control"]["status"] = "done"): TaskFileV2 {
  const task = JSON.parse(readFileSync(EXAMPLE_TASK, "utf8")) as TaskFileV2;
  task.task = taskId;
  task.control.status = status;
  return task;
}

function writeTask(task: TaskFileV2): void {
  writeFileSync(join(".tasks", `${ID}-task-${String(task.task)}.json`), JSON.stringify(task));
}

function readTask(taskId: number): TaskFileV2 {
  return JSON.parse(
    readFileSync(join(".tasks", `${ID}-task-${String(taskId)}.json`), "utf8"),
  ) as TaskFileV2;
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function filesInHead(): string[] {
  return git("show", "--name-only", "--pretty=format:", "HEAD").trim().split("\n").filter(Boolean);
}

beforeEach(() => {
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-commit-")));
  process.chdir(repo);
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("README.md", "# repo\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");

  mkdirSync(".tasks", { recursive: true });
  write(
    join(".tasks", `${ID}.json`),
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Commit fixture",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1, 2],
      spec: null,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  write(
    join("docs", "dev", ID, "plan.json"),
    JSON.stringify({
      tasks: [
        {
          id: 1,
          title: "New caching module",
          files: [{ path: "src/caching/store.ts", action: "create" }],
        },
        { id: 2, title: "Wire it up", files: [{ path: "src/app.ts", action: "modify" }] },
      ],
    }),
  );
  git("add", "docs");
  git("commit", "-q", "-m", "plan");
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe("pathMatchesCandidate", () => {
  test("matches directory prefixes at the root and nested", () => {
    expect(pathMatchesCandidate("docs/dev/X-1/trace.json", "docs/dev/X-1/")).toBe(true);
    expect(pathMatchesCandidate("apps/web/docs/dev/X-1/trace.json", "docs/dev/X-1/")).toBe(true);
    expect(pathMatchesCandidate("src/a.ts", "./src/a.ts")).toBe(true);
    expect(pathMatchesCandidate("src/ab.ts", "src/a.ts")).toBe(false);
  });
});

describe("tryCommitOnTaskDone", () => {
  test("commits files inside new (untracked) directories plus the trace, not unrelated edits", async () => {
    writeTask(exampleTask(1));
    write("src/caching/store.ts", "export const store = 1;\n");
    write("tests/a.test.ts", "test\n");
    write("README.md", "# changed elsewhere\n");

    const result = await tryCommitOnTaskDone(ID, 1, null, repo);
    expect(result.ok).toBe(true);
    expect(result.hash).toBeTruthy();
    const committed = filesInHead();
    expect(committed).toContain("src/caching/store.ts");
    expect(committed).toContain("tests/a.test.ts");
    expect(committed).toContain(`docs/dev/${ID}/trace.json`);
    expect(committed).toContain(`docs/dev/${ID}/trace.md`);
    expect(committed).not.toContain("README.md");
    expect(git("log", "-1", "--pretty=%s").trim()).toBe(`[${ID}] Task 1: New caching module`);

    const commitEntry = readTask(1).log.find((entry) => entry.ref.endsWith("/commit"));
    expect(commitEntry?.result).toBe("committed");
    expect(commitEntry?.note.startsWith(result.hash ?? "?")).toBe(true);
  });

  test("is idempotent once the task has a commit", async () => {
    writeTask(exampleTask(1));
    write("src/caching/store.ts", "x\n");
    await tryCommitOnTaskDone(ID, 1, null, repo);
    const again = await tryCommitOnTaskDone(ID, 1, null, repo);
    expect(again).toMatchObject({ ok: true, skipped: true });
  });

  test("respects commit.on_task_done: false", async () => {
    writeTask(exampleTask(1));
    const result = await tryCommitOnTaskDone(
      ID,
      1,
      {
        schema_version: "1.0",
        language: "typescript",
        test: { command: "bun test" },
        orchestration: { commit: { on_task_done: false } },
      } as never,
      repo,
    );
    expect(result).toMatchObject({ ok: true, skipped: true });
  });
});

describe("commitDoneTasks", () => {
  test("commits every done task without a commit, in id order, and skips unfinished ones", async () => {
    writeTask(exampleTask(1));
    writeTask(exampleTask(2));
    write("src/caching/store.ts", "x\n");
    write("src/app.ts", "y\n");

    const outcomes = await commitDoneTasks(ID, null, repo);
    expect(outcomes.map((outcome) => [outcome.task_id, outcome.ok])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(git("log", "--pretty=%s", "-2").trim().split("\n")).toEqual([
      `[${ID}] Task 2: Wire it up`,
      `[${ID}] Task 1: New caching module`,
    ]);
    expect(await commitDoneTasks(ID, null, repo)).toEqual([]);
  });

  test("leaves in-progress tasks alone", async () => {
    writeTask(exampleTask(1, "in_progress"));
    write("src/caching/store.ts", "x\n");
    expect(await commitDoneTasks(ID, null, repo)).toEqual([]);
    expect(git("status", "--porcelain")).toContain("src/");
  });
});

describe("commitWorkItemArtifacts", () => {
  test("sweeps done tasks, then commits docs/dev closeout artifacts", async () => {
    writeTask(exampleTask(1));
    write("src/caching/store.ts", "x\n");
    write(join("docs", "dev", ID, "workflow-cost.json"), "{}\n");

    const result = await commitWorkItemArtifacts(ID, null, repo);
    expect(result.task_commits.map((outcome) => outcome.task_id)).toEqual([1]);
    expect(result.ok).toBe(true);
    expect(result.hash).toBeTruthy();
    expect(git("log", "-1", "--pretty=%s").trim()).toBe(
      `[${ID}] Closeout: verify report, implementation trace, workflow cost`,
    );
    expect(filesInHead()).toContain(`docs/dev/${ID}/trace.json`);
    expect(git("log", "--name-only", "--pretty=format:")).toContain(
      `docs/dev/${ID}/workflow-cost.json`,
    );
    expect(git("status", "--porcelain").trim()).toBe("");
  });
});
