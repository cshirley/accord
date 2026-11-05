import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tryCommitPhase } from "../src/commit/phase-commit.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import * as helpers from "../src/git/helpers.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";

const ID = "ASDLC-1";
const TASK = 7;
const CFG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { commits: "phase" },
} as unknown as DevHarnessConfig;
const FORBIDDEN = ["--amend", "--force", "--force-with-lease", "-f", "reset", "rebase", "push"];

let originalCwd: string;
let repo: string;
let errSpy: ReturnType<typeof spyOn>;
let gitSpy: ReturnType<typeof spyOn> | undefined;
let commitSpy: ReturnType<typeof spyOn> | undefined;
let priorLevel: ReturnType<typeof getLogLevel>;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function review(findings: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    verdict: "issues",
    findings,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

beforeEach(() => {
  priorLevel = getLogLevel();
  setLogLevel("debug");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-append-")));
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
      title: "Append only",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [TASK],
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
  gitSpy?.mockRestore();
  commitSpy?.mockRestore();
  gitSpy = undefined;
  commitSpy = undefined;
  process.chdir(originalCwd);
  errSpy.mockRestore();
  setLogLevel(priorLevel);
  rmSync(repo, { recursive: true, force: true });
});

describe("ASDLC-1/AC-27 evidence commits are append-only (ASDLC-1/TC-28)", () => {
  it("ASDLC-1/AC-27 failed review round then retry only appends commits; earlier shas stay ancestors of HEAD", async () => {
    gitSpy = spyOn(helpers, "git");
    commitSpy = spyOn(helpers, "commitWithMessage");

    write("tests/a.test.ts", "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: ["tests/a.test.ts"],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      CFG,
      repo,
    );
    // Failed review round (critical finding).
    await tryCommitPhase(
      ID,
      TASK,
      "T1/review-test",
      "review-test",
      review([{ severity: "critical", issue: "vacuous", file: "tests/a.test.ts" }]),
      CFG,
      repo,
    );
    const earlier = git("rev-list", "--reverse", "HEAD").trim().split("\n");
    const headBeforeRetry = git("rev-parse", "HEAD").trim();

    // Retry: tests fixed, second round of review.
    write("tests/a.test.ts", "// red, fixed\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T2/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: ["tests/a.test.ts"],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      CFG,
      repo,
    );
    await tryCommitPhase(
      ID,
      TASK,
      "T2/review-test",
      "review-test",
      review([{ severity: "suggestion", issue: "nit", file: "tests/a.test.ts" }]),
      CFG,
      repo,
    );

    expect(git("rev-list", "--count", "HEAD").trim()).toBe(String(earlier.length + 2));
    for (const sha of earlier) {
      // exits non-zero (throws) when `sha` is not an ancestor of HEAD
      git("merge-base", "--is-ancestor", sha, "HEAD");
    }
    git("merge-base", "--is-ancestor", headBeforeRetry, "HEAD");
    // First-parent chain is linear: retry commits sit on top of the failed round.
    const subjects = git("log", "--reverse", "--format=%s").trim().split("\n");
    expect(subjects.slice(-4).map((s) => /\] ([TCV][0-9]+\/[a-z-]+):/.exec(s)?.[1])).toEqual([
      "T1/phase-test",
      "T1/review-test",
      "T2/phase-test",
      "T2/review-test",
    ]);
    // Reflog never records an amend/reset/rebase.
    expect(git("reflog", "--format=%gs")).not.toMatch(/amend|reset|rebase/);

    // Spy on the git helper args: the spies must have seen calls (not vacuous) and none forbidden.
    const gitCalls = (gitSpy as NonNullable<typeof gitSpy>).mock.calls.map(
      (call: unknown[]) => call[0] as string[],
    );
    expect(
      (commitSpy as NonNullable<typeof commitSpy>).mock.calls.length + gitCalls.length,
    ).toBeGreaterThan(0);
    const usedCommit =
      (commitSpy as NonNullable<typeof commitSpy>).mock.calls.length >= 4 ||
      gitCalls.some((args: string[]) => args[0] === "commit");
    expect(usedCommit).toBe(true);
    for (const args of gitCalls as string[][]) {
      for (const flag of FORBIDDEN) {
        expect(args).not.toContain(flag);
      }
    }
  });

  it("ASDLC-1/AC-27 an unchanged tree never rewrites the previous commit (no amend on empty round)", async () => {
    write("tests/a.test.ts", "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: ["tests/a.test.ts"],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      CFG,
      repo,
    );
    const head = git("rev-parse", "HEAD").trim();
    // Same phase again with nothing new to stage.
    await tryCommitPhase(
      ID,
      TASK,
      "T2/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: ["tests/a.test.ts"],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      CFG,
      repo,
    ).catch(() => undefined);
    git("merge-base", "--is-ancestor", head, "HEAD");
    expect(git("cat-file", "-t", head).trim()).toBe("commit");
    expect(git("log", "--format=%s", "-n", "1", head)).toContain("T1/phase-test");
  });
});
