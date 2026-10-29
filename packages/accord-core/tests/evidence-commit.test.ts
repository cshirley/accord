import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCommitMessage, parseAccordTrailer } from "../src/commit/commit-grammar.js";
import { commitTaskEvidence } from "../src/commit/evidence-commit.js";
import {
  getCloseoutBranchHook,
  registerCloseoutBranchHook,
  registerPrGroupResolver,
  resolvePrGroup,
} from "../src/commit/hooks.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { buildEvidenceAsset } from "../src/evidence/asset.js";
import * as helpers from "../src/git/helpers.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";
import { commitDoneTasks } from "../src/orchestration/commit-on-task-done.js";
import { refActor } from "../src/tasks/model.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

// Contract pinned (spec leaves shapes open):
//  commitTaskEvidence(id, taskIds, devConfig, cwd) -> { ok: boolean, hash?: string, ... }.
//  Final commit subject contains `evidence(task-<N>)` or `evidence(task-<N>,<M>)`; the Accord trailer
//  ref is that same token and outcome=done. Tasks that are not `done` are not committed.
//  A rerun adds no commit. resolvePrGroup(taskId) defaults to [taskId] and honours the last
//  resolver given to registerPrGroupResolver((taskId) => number[]).
const ID = "ASDLC-1";
const CFG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { enabled: true, commits: "phase" },
} as unknown as DevHarnessConfig;

let originalCwd: string;
let repo: string;
let errSpy: ReturnType<typeof spyOn>;
let priorLevel: ReturnType<typeof getLogLevel>;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function logged(): string[] {
  return errSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}
function commitCount(): number {
  return Number(git("rev-list", "--count", "HEAD").trim());
}
function filesOf(rev: string): string[] {
  return git("show", "--name-only", "--pretty=format:", rev).trim().split("\n").filter(Boolean);
}
function subjectOf(rev: string): string {
  return git("show", "-s", "--format=%s", rev).trim();
}
function bodyOf(rev: string): string {
  return git("show", "-s", "--format=%B", rev);
}

function phaseCommit(
  task: number,
  ref: string,
  agent: string,
  outcome: string,
  file: string,
  extra: Record<string, number> = {},
): void {
  write(file, `// ${ref}\n`);
  git("add", file);
  const message = buildCommitMessage({
    summary: `${agent} complete`,
    body: outcome === "red" ? "FAIL tests/x.test.ts\n  not implemented: foo" : undefined,
    trailer: {
      v: 1,
      id: ID,
      task,
      seq: 1,
      ref,
      agent,
      loop: ref.startsWith("T") ? "test" : "code",
      round: Number(/^[A-Z](\d+)/.exec(ref)?.[1] ?? 1),
      outcome,
      ...extra,
    },
  });
  git("commit", "-q", "-m", message);
}

function seedTask(task: number, status: "done" | "in_progress" = "done"): void {
  writeTaskFixture({
    workItemId: ID,
    taskId: task,
    phase: "phase-verify-task",
    status,
    preImplGates: "complete",
    coversAc: ["AC-1"],
  });
}

beforeEach(() => {
  priorLevel = getLogLevel();
  setLogLevel("debug");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-evidence-commit-")));
  process.chdir(repo);
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("README.md", "# repo\n");
  mkdirSync(".tasks", { recursive: true });
  write(
    join(".tasks", `${ID}.json`),
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Evidence commit",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [7, 8],
      spec: null,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

afterEach(() => {
  process.chdir(originalCwd);
  errSpy.mockRestore();
  setLogLevel(priorLevel);
  rmSync(repo, { recursive: true, force: true });
});

function evidenceLogEntries(task: number): unknown[] {
  return readTaskFixture(ID, task).log.filter(
    (entry) => refActor(entry.ref) === "commit" && entry.result === "committed",
  );
}

function seedWork(task: number): void {
  phaseCommit(task, "T1/phase-test", "phase-test", "red", `tests/t${task}.test.ts`);
  phaseCommit(task, "T1/phase-code", "phase-code", "green", `src/t${task}.ts`);
  write(`docs/dev/${ID}/state/task-${task}/task.json`, `{"task":${task}}\n`);
  write(`docs/dev/${ID}/state/task-${task}/STATE.md`, "state\n");
  git("add", "-A");
  git("commit", "-q", "-m", `state snapshot ${task}`);
}

// Runs first in file order: no registerPrGroupResolver call precedes these assertions.
describe("ASDLC-1/AC-5 module defaults", () => {
  it("ASDLC-1/AC-5 defaults to [taskId]", () => {
    expect(resolvePrGroup(7)).toEqual([7]);
    expect(resolvePrGroup(12)).toEqual([12]);
  });

  it("ASDLC-1/AC-5 closeout branch hook: default reader returns undefined, registered hook is returned", () => {
    expect(getCloseoutBranchHook()).toBeUndefined();
    const hook = (() => "sentinel") as unknown as Parameters<typeof registerCloseoutBranchHook>[0];
    try {
      registerCloseoutBranchHook(hook);
      expect(getCloseoutBranchHook()).toBe(hook);
    } finally {
      registerCloseoutBranchHook(undefined);
    }
    expect(getCloseoutBranchHook()).toBeUndefined();
  });
});

describe("ASDLC-1/AC-5 final evidence commit", () => {
  it("ASDLC-1/AC-5 single task: evidence(task-N) commit with only evidence/state paths, asset written, state dir removed", async () => {
    seedTask(7);
    seedWork(7);
    write("src/unrelated-dirty.ts", "export const x = 1;\n"); // must not be staged
    const before = commitCount();
    const [expected] = await buildEvidenceAsset(ID, [7], { cwd: repo, config: CFG });

    const result = await commitTaskEvidence(ID, [7], CFG, repo);

    expect(result.ok).toBe(true);
    expect(commitCount()).toBe(before + 1);
    const head = git("rev-parse", "HEAD").trim();
    expect(result.hash && head.startsWith(result.hash.slice(0, 7))).toBe(true);
    expect(subjectOf("HEAD")).toContain("evidence(task-7)");
    expect(subjectOf("HEAD")).not.toContain("evidence(task-7,");

    const files = filesOf("HEAD");
    expect(files).toContain(`docs/dev/${ID}/evidence/task-7.md`);
    expect(files).toContain(`docs/dev/${ID}/evidence/task-7.json`);
    for (const file of files) {
      expect(
        file.startsWith(`docs/dev/${ID}/evidence/`) || file.startsWith(`docs/dev/${ID}/state/`),
      ).toBe(true);
    }
    expect(files).toContain(`docs/dev/${ID}/state/task-7/task.json`);
    expect(files).not.toContain("src/unrelated-dirty.ts");
    expect(git("status", "--porcelain", "--untracked-files=all")).toContain(
      "src/unrelated-dirty.ts",
    );

    expect(existsSync(join(repo, `docs/dev/${ID}/state/task-7`))).toBe(false);
    expect(existsSync(join(repo, `docs/dev/${ID}/evidence/task-7.md`))).toBe(true);
    expect(existsSync(join(repo, `docs/dev/${ID}/evidence/task-7.json`))).toBe(true);
    const tracked = git("ls-tree", "-r", "--name-only", "HEAD");
    expect(tracked).toContain(`docs/dev/${ID}/evidence/task-7.json`);
    expect(tracked).not.toContain(`docs/dev/${ID}/state/task-7/`);

    // Asset is the buildEvidenceAsset output computed from the PR's commits, not a placeholder.
    expect(JSON.parse(git("show", `HEAD:docs/dev/${ID}/evidence/task-7.json`))).toEqual(
      expected?.json,
    );
    const md = git("show", `HEAD:docs/dev/${ID}/evidence/task-7.md`);
    expect(md).toBe(expected?.md as string);
    expect(md).toContain("not implemented: foo");
  });

  it("ASDLC-1/AC-5 staging guard: pre-staged source file is not swept into the evidence commit", async () => {
    seedTask(7);
    seedWork(7);
    write("src/staged.ts", "export const staged = 1;\n");
    git("add", "src/staged.ts");
    await commitTaskEvidence(ID, [7], CFG, repo);
    expect(subjectOf("HEAD")).toContain("evidence(task-7)");
    expect(filesOf("HEAD")).not.toContain("src/staged.ts");
    expect(git("status", "--porcelain")).toContain("src/staged.ts");
  });

  it("ASDLC-1/AC-5 staging guard: another task's dirty state folder is not committed", async () => {
    seedTask(7);
    seedWork(7);
    seedWork(8);
    write(`docs/dev/${ID}/state/task-8/STATE.md`, "changed\n");
    await commitTaskEvidence(ID, [7], CFG, repo);
    expect(filesOf("HEAD").some((file) => file.includes("task-8"))).toBe(false);
    expect(git("status", "--porcelain", "--untracked-files=all")).toContain(
      `docs/dev/${ID}/state/task-8/STATE.md`,
    );
  });

  it("ASDLC-1/AC-5 staging guard: dirty non-evidence docs/dev files are not committed", async () => {
    seedTask(7);
    seedWork(7);
    write(`docs/dev/${ID}/trace.md`, "dirty\n");
    write(`docs/dev/${ID}/reviews/task-7/x.md`, "dirty\n");
    await commitTaskEvidence(ID, [7], CFG, repo);
    const files = filesOf("HEAD");
    expect(files).not.toContain(`docs/dev/${ID}/trace.md`);
    expect(files).not.toContain(`docs/dev/${ID}/reviews/task-7/x.md`);
    expect(files).toContain(`docs/dev/${ID}/evidence/task-7.json`);
  });

  it("ASDLC-1/AC-5 trailer carries outcome=done roll-up", async () => {
    seedTask(7);
    write(`docs/dev/${ID}/plan.json`, JSON.stringify({ tasks: [{ id: 7, est_lines: 300 }] }));
    seedWork(7);
    phaseCommit(
      7,
      "C1/review-code",
      "review-code",
      "issues",
      `docs/dev/${ID}/reviews/task-7/C1.md`,
      {
        crit: 1,
      },
    );
    const [asset] = await buildEvidenceAsset(ID, [7], { cwd: repo, config: CFG });
    await commitTaskEvidence(ID, [7], CFG, repo);
    const trailer = parseAccordTrailer(bodyOf("HEAD"));
    expect(trailer).not.toBeNull();
    expect(trailer?.outcome).toBe("done");
    expect(trailer?.id).toBe(ID);
    expect(trailer?.task).toBe(7);
    expect(trailer?.ref).toBe("evidence(task-7)");
    // roll-up keys (evidence-stack plan 3.2)
    const json = asset?.json as {
      loops: Record<
        string,
        { rounds: number; findings: { crit: number; warn: number; sugg: number } }
      >;
      size: { act_prod_lines: number; act_test_lines: number };
    };
    expect(json.loops.test?.rounds).toBe(1);
    expect(json.loops.code?.rounds).toBe(1);
    expect(trailer?.rounds_test).toBe(json.loops.test?.rounds as number);
    expect(trailer?.rounds_code).toBe(json.loops.code?.rounds as number);
    expect(trailer?.findings_total).toBe(1);
    expect(trailer?.est_lines).toBe(300);
    expect(trailer?.act_lines).toBe(json.size.act_prod_lines + json.size.act_test_lines);
  });

  it("ASDLC-1/AC-5 merged PR: evidence(task-7,8) covers both tasks' assets and state dirs", async () => {
    seedTask(7);
    seedTask(8);
    seedWork(7);
    seedWork(8);
    const before = commitCount();
    const expected = await buildEvidenceAsset(ID, [7, 8], { cwd: repo, config: CFG });

    const result = await commitTaskEvidence(ID, [7, 8], CFG, repo);

    expect(result.ok).toBe(true);
    expect(commitCount()).toBe(before + 1);
    expect(subjectOf("HEAD")).toContain("evidence(task-7,8)");
    const files = filesOf("HEAD");
    for (const n of [7, 8]) {
      expect(files).toContain(`docs/dev/${ID}/evidence/task-${n}.md`);
      expect(files).toContain(`docs/dev/${ID}/evidence/task-${n}.json`);
      expect(existsSync(join(repo, `docs/dev/${ID}/state/task-${n}`))).toBe(false);
    }
    expect(parseAccordTrailer(bodyOf("HEAD"))?.ref).toBe("evidence(task-7,8)");
    const tracked = git("ls-tree", "-r", "--name-only", "HEAD");
    expect(tracked).not.toContain("state/task-7/");
    expect(tracked).not.toContain("state/task-8/");
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
    expect(expected.map((asset) => asset.task)).toEqual([7, 8]);
    for (const asset of expected) {
      expect(
        JSON.parse(git("show", `HEAD:docs/dev/${ID}/evidence/task-${asset.task}.json`)),
      ).toEqual(asset.json);
      expect(git("show", `HEAD:docs/dev/${ID}/evidence/task-${asset.task}.md`)).toBe(asset.md);
    }
    expect(
      (JSON.parse(git("show", `HEAD:docs/dev/${ID}/evidence/task-8.json`)) as { task: number })
        .task,
    ).toBe(8);
    const events = logged().filter((line) => line.includes("stack.commit.created"));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("ref=evidence(task-7,8)");
    expect(events[0]).toContain("outcome=done");
  });

  it("ASDLC-1/AC-5 single task leaves another task's state dir untouched", async () => {
    seedTask(7);
    seedWork(7);
    seedWork(8);
    await commitTaskEvidence(ID, [7], CFG, repo);
    expect(existsSync(join(repo, `docs/dev/${ID}/state/task-8/task.json`))).toBe(true);
    expect(filesOf("HEAD").some((file) => file.includes("task-8"))).toBe(false);
  });

  it("ASDLC-1/AC-5 succeeds when no state dir exists", async () => {
    seedTask(7);
    phaseCommit(7, "T1/phase-test", "phase-test", "red", "tests/t7.test.ts");
    const result = await commitTaskEvidence(ID, [7], CFG, repo);
    expect(result.ok).toBe(true);
    expect(filesOf("HEAD")).toContain(`docs/dev/${ID}/evidence/task-7.json`);
  });

  it("ASDLC-1/AC-5 task not done: no commit", async () => {
    seedTask(7, "in_progress");
    seedWork(7);
    const before = commitCount();
    await commitTaskEvidence(ID, [7], CFG, repo);
    expect(commitCount()).toBe(before);
    expect(existsSync(join(repo, `docs/dev/${ID}/evidence/task-7.json`))).toBe(false);
    expect(existsSync(join(repo, `docs/dev/${ID}/state/task-7/task.json`))).toBe(true);
    expect(evidenceLogEntries(7)).toHaveLength(0);
    expect(logged().some((line) => line.includes("stack.commit.created"))).toBe(false);
  });

  it.each([
    ["done", "in_progress"],
    ["in_progress", "done"],
  ] as const)(
    "ASDLC-1/AC-5 merged PR with statuses 7=%s 8=%s: no commit until every task is done",
    async (status7, status8) => {
      seedTask(7, status7);
      seedTask(8, status8);
      seedWork(7);
      seedWork(8);
      const before = commitCount();
      await commitTaskEvidence(ID, [7, 8], CFG, repo);
      expect(commitCount()).toBe(before);
      for (const n of [7, 8]) {
        expect(existsSync(join(repo, `docs/dev/${ID}/evidence/task-${n}.json`))).toBe(false);
        expect(existsSync(join(repo, `docs/dev/${ID}/state/task-${n}/task.json`))).toBe(true);
        expect(evidenceLogEntries(n)).toHaveLength(0);
      }
      expect(logged().some((line) => line.includes("stack.commit.created"))).toBe(false);
    },
  );

  it("ASDLC-1/AC-5 records harness commit log entry with the evidence sha; commitDoneTasks then skips the task", async () => {
    seedTask(7);
    seedWork(7);
    const result = await commitTaskEvidence(ID, [7], CFG, repo);
    const sha = git("rev-parse", "HEAD").trim();
    expect(result.ok).toBe(true);

    const task = readTaskFixture(ID, 7);
    const entries = task.log.filter(
      (entry) => refActor(entry.ref) === "commit" && entry.result === "committed",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.note).toContain(sha.slice(0, 7));
    expect(entries[0]?.note).toContain("evidence(task-7)");

    const before = commitCount();
    await commitDoneTasks(ID, CFG, repo);
    expect(commitCount()).toBe(before);
    expect(git("rev-parse", "HEAD").trim()).toBe(sha);
  });

  it("ASDLC-1/AC-5 merged PR logs a commit entry for each task", async () => {
    seedTask(7);
    seedTask(8);
    seedWork(7);
    seedWork(8);
    await commitTaskEvidence(ID, [7, 8], CFG, repo);
    const sha = git("rev-parse", "HEAD").trim();
    for (const n of [7, 8]) {
      const entries = readTaskFixture(ID, n).log.filter(
        (entry) => refActor(entry.ref) === "commit" && entry.result === "committed",
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]?.note).toContain(sha.slice(0, 7));
    }
  });
});

describe("ASDLC-1/AC-5 PR group resolver registry", () => {
  it("ASDLC-1/AC-5 uses the registered resolver", () => {
    try {
      registerPrGroupResolver((taskId) => (taskId === 7 ? [7, 8] : [taskId]));
      expect(resolvePrGroup(7)).toEqual([7, 8]);
      expect(resolvePrGroup(9)).toEqual([9]);
    } finally {
      registerPrGroupResolver((taskId) => [taskId]);
    }
  });
});

describe("ASDLC-1/AC-27 evidence commits are append-only", () => {
  it("ASDLC-1/AC-27 rerun adds no commit, no amend: evidence sha stays HEAD and reachable", async () => {
    seedTask(7);
    seedWork(7);
    await commitTaskEvidence(ID, [7], CFG, repo);
    const evidenceSha = git("rev-parse", "HEAD").trim();
    const count = commitCount();
    const message = bodyOf("HEAD");
    const reflogBefore = git("reflog", "--format=%H %gs");
    const gitSpy = spyOn(helpers, "git");

    let again: Awaited<ReturnType<typeof commitTaskEvidence>>;
    try {
      again = await commitTaskEvidence(ID, [7], CFG, repo);
      const forbidden = [
        "--amend",
        "--force",
        "--force-with-lease",
        "-f",
        "reset",
        "rebase",
        "push",
      ];
      for (const call of gitSpy.mock.calls) {
        const args = (call[0] ?? []) as string[];
        for (const word of forbidden) expect(args).not.toContain(word);
      }
    } finally {
      gitSpy.mockRestore();
    }
    // A reflog entry is written even when an amend yields an identical sha.
    expect(git("reflog", "--format=%H %gs")).toBe(reflogBefore);

    expect(again.ok).toBe(true);
    expect(commitCount()).toBe(count);
    expect(git("rev-parse", "HEAD").trim()).toBe(evidenceSha);
    expect(bodyOf("HEAD")).toBe(message);
    expect(
      git("log", "--format=%s")
        .split("\n")
        .filter((s) => s.includes("evidence(task-7)")),
    ).toHaveLength(1);
    expect(git("status", "--porcelain", "--untracked-files=all").trim()).toBe("");
  });

  it("ASDLC-1/AC-27 a later phase commit goes on top; evidence commit is never rewritten", async () => {
    seedTask(7);
    seedWork(7);
    await commitTaskEvidence(ID, [7], CFG, repo);
    const evidenceSha = git("rev-parse", "HEAD").trim();
    phaseCommit(7, "T2/phase-code", "phase-code", "green", "src/t7b.ts");
    const afterPhase = commitCount();
    await commitTaskEvidence(ID, [7], CFG, repo);
    expect(commitCount()).toBe(afterPhase);
    expect(
      git("log", "--format=%s")
        .split("\n")
        .filter((s) => s.includes("evidence(task-7)")),
    ).toHaveLength(1);
    expect(evidenceLogEntries(7)).toHaveLength(1);
    expect(git("reflog", "--format=%gs")).not.toMatch(/amend|reset|rebase/);
    expect(git("merge-base", "--is-ancestor", evidenceSha, "HEAD")).toBe("");
    expect(git("log", "--format=%H", "--grep", "evidence(task-7)", "-F").trim()).toContain(
      evidenceSha,
    );
  });
});

describe("ASDLC-1/AC-29 stack.commit.created for evidence commit", () => {
  it("ASDLC-1/AC-29 emits info event with work_item_id, ref, outcome=done and sha", async () => {
    seedTask(7);
    seedWork(7);
    await commitTaskEvidence(ID, [7], CFG, repo);
    const sha = git("rev-parse", "HEAD").trim();
    const events = logged().filter((line) => line.includes("stack.commit.created"));
    expect(events).toHaveLength(1);
    const line = events[0] as string;
    expect(line).toStartWith("[accord:stack:info] stack.commit.created ");
    expect(line).toContain(`work_item_id=${ID}`);
    expect(line).toContain("ref=evidence(task-7)");
    expect(line).toContain("outcome=done");
    const emitted = /sha=([0-9a-f]+)/.exec(line)?.[1] as string;
    expect(emitted.length).toBeGreaterThanOrEqual(7);
    expect(sha.startsWith(emitted)).toBe(true);
  });

  it("ASDLC-1/AC-29 no event on idempotent rerun", async () => {
    seedTask(7);
    seedWork(7);
    await commitTaskEvidence(ID, [7], CFG, repo);
    await commitTaskEvidence(ID, [7], CFG, repo);
    expect(logged().filter((line) => line.includes("stack.commit.created"))).toHaveLength(1);
  });
});
