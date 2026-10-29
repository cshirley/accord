import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateReturn } from "../src/artifacts/validation.js";
import { parseAccordTrailer, validateTrailer } from "../src/commit/commit-grammar.js";
import { tryCommitPhase } from "../src/commit/phase-commit.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { processSubagentToolResult } from "../src/harness/index.js";
import type { HarnessMutableState } from "../src/harness/types.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";
import { appendUsageLine, loadPricing } from "../src/telemetry/usage.js";
import { writeTaskFixture } from "./helpers/task-fixture.js";

const ID = "ASDLC-1";
const TASK = 7;
const PHASE_CFG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { commits: "phase" },
} as unknown as DevHarnessConfig;
const TASK_CFG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { commits: "task" },
} as unknown as DevHarnessConfig;
const UNSET_CFG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
} as unknown as DevHarnessConfig;

const TEST_FILE = "tests/foo.test.ts";
const SRC_FILE = "src/foo.ts";
const REVIEWS = `docs/dev/${ID}/reviews/task-${TASK}`;

// Seed secret is built at runtime so no full token literal is ever committed.
const SECRET = ["ghp", "_", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6"].join("");

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
function subjects(): string[] {
  return git("log", "--reverse", "--format=%s").trim().split("\n");
}
function statusAll(): string {
  return git("status", "--porcelain", "--untracked-files=all");
}
function commitCount(): number {
  return Number(git("rev-list", "--count", "HEAD").trim());
}
function filesOf(rev: string): string[] {
  return git("show", "--name-only", "--pretty=format:", rev).trim().split("\n").filter(Boolean);
}
function bodyOf(rev: string): string {
  return git("show", "-s", "--format=%B", rev);
}

beforeEach(() => {
  priorLevel = getLogLevel();
  setLogLevel("debug");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-phase-")));
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
      title: "Phase commits",
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
  process.chdir(originalCwd);
  errSpy.mockRestore();
  setLogLevel(priorLevel);
  rmSync(repo, { recursive: true, force: true });
});

function reviewPacket(findings: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    verdict: findings.length ? "issues" : "clean",
    findings,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}
function codePacket(files: string[]): Record<string, unknown> {
  return {
    status: "done",
    changes: files.map((file) => ({ file, action: "add", kind: "code", ac_ids: ["AC-1"] })),
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

describe("ASDLC-1/AC-1 per-phase commits (ASDLC-1/TC-1)", () => {
  it("ASDLC-1/AC-1 one orchestrator commit per phase, in order, with ref subjects, trailers and review findings", async () => {
    appendUsageLine(ID, {
      at: "2026-01-01T00:00:00.000Z",
      work_item_id: ID,
      subagent_type: "phase-test",
      task_id: TASK,
      model: "m",
      usage: {
        input: 120,
        output: 45,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.5,
        contextTokens: 0,
        turns: 1,
      },
      source: "subagent",
    });
    const otherUsage = (agent: string, task: number, input: number, output: number): void =>
      appendUsageLine(ID, {
        at: "2026-01-01T00:00:00.000Z",
        work_item_id: ID,
        subagent_type: agent,
        task_id: task,
        model: "m",
        usage: {
          input,
          output,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.1,
          contextTokens: 0,
          turns: 1,
        },
        source: "subagent",
      });
    otherUsage("review-test", TASK, 300, 80);
    otherUsage("phase-code", 99, 7000, 7000);
    const base = commitCount();

    write(TEST_FILE, "// red test\n");
    const c1 = await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: [TEST_FILE],
        changes: [{ file: TEST_FILE, action: "add", kind: "test", ac_ids: ["AC-1"] }],
        red_confirmed: true,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      PHASE_CFG,
      repo,
    );
    expect(c1.ok).toBe(true);

    await tryCommitPhase(
      ID,
      TASK,
      "T1/review-test",
      "review-test",
      reviewPacket([
        {
          severity: "warning",
          issue: "weak assertion",
          file: TEST_FILE,
          evidence: `token leaked: ${SECRET}`,
        },
      ]),
      PHASE_CFG,
      repo,
    );

    write(SRC_FILE, "export const foo = 1;\n");
    await tryCommitPhase(
      ID,
      TASK,
      "C1/phase-code",
      "phase-code",
      codePacket([SRC_FILE]),
      PHASE_CFG,
      repo,
    );
    await tryCommitPhase(
      ID,
      TASK,
      "C1/review-security",
      "review-security",
      reviewPacket([{ severity: "critical", issue: "sec issue", file: SRC_FILE }]),
      PHASE_CFG,
      repo,
    );
    await tryCommitPhase(
      ID,
      TASK,
      "C1/review-code",
      "review-code",
      reviewPacket([
        { severity: "warning", issue: "naming", file: SRC_FILE, recommendation: "fix naming" },
        { severity: "suggestion", issue: "style", file: SRC_FILE },
      ]),
      PHASE_CFG,
      repo,
    );
    // No hand-seeded state file: phase-verify-task has nothing to stage, V1 is still recorded.
    await tryCommitPhase(
      ID,
      TASK,
      "V1/phase-verify-task",
      "phase-verify-task",
      { status: "done", usage: { prompt_tokens: 1, completion_tokens: 1 } },
      PHASE_CFG,
      repo,
    );

    expect(commitCount()).toBe(base + 6);
    const phaseSubjects = subjects().slice(base);
    const refs = [
      "T1/phase-test",
      "T1/review-test",
      "C1/phase-code",
      "C1/review-security",
      "C1/review-code",
      "V1/phase-verify-task",
    ];
    refs.forEach((ref, index) => {
      expect(phaseSubjects[index]).toStartWith(`[${ID}][task-${TASK}] ${ref}: `);
    });

    const shas = git("log", "--reverse", "--format=%H").trim().split("\n").slice(base);
    shas.forEach((sha, index) => {
      const trailer = parseAccordTrailer(bodyOf(sha));
      expect(trailer).not.toBeNull();
      expect(validateTrailer(trailer as NonNullable<typeof trailer>).ok).toBe(true);
      expect(trailer?.id).toBe(ID);
      expect(trailer?.task).toBe(TASK);
      expect(trailer?.ref).toBe(refs[index] as string);
      expect(trailer?.agent).toBe((refs[index] as string).split("/")[1] as string);
    });

    // Usage-log sums reach the first commit's trailer.
    const first = parseAccordTrailer(bodyOf(shas[0] as string));
    expect(Number(first?.tok_in)).toBe(120);
    expect(Number(first?.tok_out)).toBe(45);
    // Per-phase sums, not cumulative work-item sums, and other tasks excluded.
    const second = parseAccordTrailer(bodyOf(shas[1] as string));
    expect(Number(second?.tok_in)).toBe(300);
    expect(Number(second?.tok_out)).toBe(80);
    // Usage of another task (phase-code, task 99, 7000/7000) is excluded from this task's trailers.
    const otherTaskTrailer = parseAccordTrailer(bodyOf(shas[2] as string));
    expect(Number(otherTaskTrailer?.tok_in ?? 0)).toBe(0);
    const seqs = shas.map((sha) => Number(parseAccordTrailer(bodyOf(sha))?.seq));
    seqs.forEach((seq, index) => {
      expect(Number.isInteger(seq)).toBe(true);
      if (index > 0) expect(seq).toBeGreaterThan(seqs[index - 1] as number);
    });

    // Test, code content committed in own phase.
    expect(filesOf(shas[0] as string)).toContain(TEST_FILE);
    expect(filesOf(shas[2] as string)).toContain(SRC_FILE);

    // Each review commit holds its findings markdown before the next phase commit.
    const reviewFiles: Array<[number, string]> = [
      [1, `${REVIEWS}/T1-review-test.md`],
      [3, `${REVIEWS}/C1-review-security.md`],
      [4, `${REVIEWS}/C1-review-code.md`],
    ];
    for (const [index, path] of reviewFiles) {
      expect(filesOf(shas[index] as string)).toContain(path);
      expect(filesOf(shas[index] as string).every((file) => file.startsWith(REVIEWS))).toBe(true);
    }
    const secMd = git("show", `${shas[3]}:${REVIEWS}/C1-review-security.md`);
    expect(secMd).toContain("sec issue");
    expect(secMd).toContain("critical");
    expect(secMd).toContain(SRC_FILE);
    const testMd = git("show", `${shas[1]}:${REVIEWS}/T1-review-test.md`);
    expect(testMd).toContain("weak assertion");
    expect(testMd).toContain(TEST_FILE);
    expect(testMd).toContain("warning");
    const codeMd = git("show", `${shas[4]}:${REVIEWS}/C1-review-code.md`);
    expect(codeMd).toContain("naming");
    expect(codeMd).toContain("style");
    expect(codeMd).toContain("warning");
    expect(codeMd).toContain("suggestion");
    expect(codeMd).toContain("fix naming");
    const secTrailer = parseAccordTrailer(bodyOf(shas[3] as string));
    expect(Number(secTrailer?.crit ?? 0)).toBe(1);
    const codeTrailer = parseAccordTrailer(bodyOf(shas[4] as string));
    expect(Number(codeTrailer?.warn ?? 0)).toBe(1);
    expect(Number(codeTrailer?.sugg ?? 0)).toBe(1);
    expect(filesOf(shas[5] as string)).toEqual([]);

    // Working tree is clean of tracked/untracked leftovers (nothing skipped).
    expect(statusAll().trim()).toBe("");
  });

  it("ASDLC-1/AC-12 secret in finding evidence is masked in the committed review markdown", async () => {
    await tryCommitPhase(
      ID,
      TASK,
      "T1/review-test",
      "review-test",
      reviewPacket([
        { severity: "warning", issue: "leak", file: TEST_FILE, evidence: `key ${SECRET} here` },
      ]),
      PHASE_CFG,
      repo,
    );
    const md = readFileSync(join(repo, REVIEWS, "T1-review-test.md"), "utf8");
    expect(md).not.toContain(SECRET);
    expect(md).toContain("[REDACTED]");
    expect(md).toContain("leak");
    expect(git("show", "HEAD")).not.toContain(SECRET);
    expect(git("log", "-p", "--all")).not.toContain(SECRET);
  });

  it("ASDLC-1/AC-1 a commit made during a spawn without a trailer is reported as agent-commit, not accepted", async () => {
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: [TEST_FILE],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      PHASE_CFG,
      repo,
    );
    // An agent commits on its own: no Accord trailer.
    write("rogue.txt", "agent commit\n");
    git("add", "rogue.txt");
    git("commit", "-q", "-m", "agent made this commit");
    const rogueSha = git("rev-parse", "HEAD").trim();
    errSpy.mockClear();

    write(SRC_FILE, "export const foo = 1;\n");
    await tryCommitPhase(
      ID,
      TASK,
      "C1/phase-code",
      "phase-code",
      codePacket([SRC_FILE]),
      PHASE_CFG,
      repo,
    );
    const rejected = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(
      rejected.some(
        (line) =>
          line.startsWith("[accord:stack:warn] stack.guard.rejected ") &&
          line.includes("ref=C1/phase-code") &&
          line.includes("rule=agent-commit") &&
          line.includes(`work_item_id=${ID}`) &&
          /\bpath=/.test(line),
      ),
    ).toBe(true);
    // Rogue commit is kept (never rewritten), reported once; the phase commit lands on top.
    git("merge-base", "--is-ancestor", rogueSha, "HEAD");
    expect(git("rev-parse", "HEAD~1").trim()).toBe(rogueSha);
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] C1/phase-code: ");
    expect(filesOf("HEAD")).toEqual([SRC_FILE]);
    expect(git("reflog", "--format=%gs")).not.toMatch(/amend|reset|rebase/);
    expect(rejected.filter((line) => line.includes("rule=agent-commit"))).toHaveLength(1);
  });

  it("ASDLC-1/AC-1 trailered phase commits and the pre-existing init commit are not reported as agent-commit", async () => {
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: [TEST_FILE],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      PHASE_CFG,
      repo,
    );
    write(SRC_FILE, "export const foo = 1;\n");
    await tryCommitPhase(
      ID,
      TASK,
      "C1/phase-code",
      "phase-code",
      codePacket([SRC_FILE]),
      PHASE_CFG,
      repo,
    );
    expect(logged().some((line) => line.includes("rule=agent-commit"))).toBe(false);
  });
});

describe("ASDLC-1/AC-3 commit guard in the phase commit", () => {
  it("ASDLC-1/AC-3 phase-code result touching a test file: test path not committed, rejection logged, phase-test respawn requested", async () => {
    write(SRC_FILE, "export const foo = 1;\n");
    write(TEST_FILE, "// edited by code agent\n");
    write(".env.production", "X=1\n");
    write("notes.txt", "human wip\n");
    const result = await tryCommitPhase(
      ID,
      TASK,
      "C1/phase-code",
      "phase-code",
      codePacket([SRC_FILE, TEST_FILE, ".env.production"]),
      PHASE_CFG,
      repo,
    );
    expect(filesOf("HEAD")).toEqual([SRC_FILE]);
    const leftover = statusAll();
    expect(leftover).toContain(TEST_FILE);
    expect(leftover).toContain(".env.production");
    expect(leftover).toContain("notes.txt");

    const rejected = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(
      rejected.some(
        (line) =>
          line.startsWith("[accord:stack:warn] stack.guard.rejected ") &&
          line.includes("rule=code-touches-test") &&
          line.includes(`path=${TEST_FILE}`) &&
          line.includes(`work_item_id=${ID}`),
      ),
    ).toBe(true);
    expect(result.respawn).toBe("phase-test");
  });

  it("ASDLC-1/AC-3 plan-listed test file edited but not reported by phase-code is still rejected", async () => {
    // Candidates come from the plan's files[] as well as the packet (pathMatchesCandidate).
    write(
      `docs/dev/${ID}/plan.json`,
      JSON.stringify({
        tasks: [
          {
            id: TASK,
            title: "Wired task",
            files: [
              { path: SRC_FILE, action: "create" },
              { path: TEST_FILE, action: "create" },
            ],
          },
        ],
      }),
    );
    git("add", "docs");
    git("commit", "-q", "-m", "plan");
    write(SRC_FILE, "export const foo = 1;\n");
    write(TEST_FILE, "// edited by code agent, unreported\n");
    const result = await tryCommitPhase(
      ID,
      TASK,
      "C1/phase-code",
      "phase-code",
      codePacket([SRC_FILE]),
      PHASE_CFG,
      repo,
    );
    expect(filesOf("HEAD")).toEqual([SRC_FILE]);
    expect(
      logged().some(
        (line) =>
          line.startsWith("[accord:stack:warn] stack.guard.rejected ") &&
          line.includes("rule=code-touches-test") &&
          line.includes(`path=${TEST_FILE}`),
      ),
    ).toBe(true);
    expect(result.respawn).toBe("phase-test");
  });

  it("ASDLC-1/AC-3 review commit never stages source or test files, even if the tree is dirty", async () => {
    write(SRC_FILE, "export const foo = 1;\n");
    write(TEST_FILE, "// t\n");
    write("README.md", "# changed\n");
    await tryCommitPhase(
      ID,
      TASK,
      "C1/review-code",
      "review-code",
      reviewPacket([{ severity: "warning", issue: "x", file: SRC_FILE }]),
      PHASE_CFG,
      repo,
    );
    expect(filesOf("HEAD")).toEqual([`${REVIEWS}/C1-review-code.md`]);
    const status = statusAll();
    expect(status).toContain(SRC_FILE);
    expect(status).toContain(TEST_FILE);
    expect(status).toContain("README.md");
  });
});

describe("ASDLC-1/AC-29 stack.commit.created emission", () => {
  it("ASDLC-1/AC-29 emits info stack.commit.created with work_item_id, ref, outcome and sha for each commit", async () => {
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: [TEST_FILE],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      PHASE_CFG,
      repo,
    );
    const sha1 = git("rev-parse", "HEAD").trim();
    await tryCommitPhase(
      ID,
      TASK,
      "T1/review-test",
      "review-test",
      reviewPacket([{ severity: "suggestion", issue: "nit", file: TEST_FILE }]),
      PHASE_CFG,
      repo,
    );
    const sha2 = git("rev-parse", "HEAD").trim();

    const events = logged().filter((line) => line.includes("stack.commit.created"));
    expect(events).toHaveLength(2);
    for (const line of events) {
      expect(line).toStartWith("[accord:stack:info] stack.commit.created ");
      expect(line).toContain(`work_item_id=${ID}`);
      expect(line).toMatch(/outcome=\S+/);
    }
    expect(events[0]).toContain("ref=T1/phase-test");
    expect(events[1]).toContain("ref=T1/review-test");
    const shaOf = (line: string): string => /sha=([0-9a-f]+)/.exec(line)?.[1] as string;
    expect(sha1.startsWith(shaOf(events[0] as string))).toBe(true);
    expect(sha2.startsWith(shaOf(events[1] as string))).toBe(true);
    expect(shaOf(events[0] as string).length).toBeGreaterThanOrEqual(7);
  });
});

const FP = { test: { command: "bun test", file_pattern: "**/*.test.ts" } };
const NEGATIVE_ROWS: Array<[string, DevHarnessConfig | null]> = [
  ["stack.commits unset", UNSET_CFG],
  ['stack.commits "task"', TASK_CFG],
  ["no config", null],
  ["stack.enabled only", { ...FP, stack: { enabled: true } } as unknown as DevHarnessConfig],
  [
    'stack.enabled with commits "task"',
    { ...FP, stack: { enabled: true, commits: "task" } } as unknown as DevHarnessConfig,
  ],
  [
    "knowledge.enabled only",
    { ...FP, knowledge: { enabled: true } } as unknown as DevHarnessConfig,
  ],
];

describe("ASDLC-1/AC-26 default config makes no phase commit", () => {
  for (const [label, cfg] of NEGATIVE_ROWS) {
    it(`ASDLC-1/AC-26 ${label}: no phase commit, tree untouched, no review markdown`, async () => {
      write(TEST_FILE, "// red\n");
      const before = commitCount();
      await tryCommitPhase(
        ID,
        TASK,
        "T1/phase-test",
        "phase-test",
        {
          status: "done",
          test_files: [TEST_FILE],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        cfg,
        repo,
      );
      await tryCommitPhase(
        ID,
        TASK,
        "T1/review-test",
        "review-test",
        reviewPacket([{ severity: "warning", issue: "x", file: TEST_FILE }]),
        cfg,
        repo,
      );
      expect(commitCount()).toBe(before);
      expect(statusAll()).toContain(TEST_FILE);
      expect(statusAll()).not.toContain("docs/dev");
      expect(existsSync(join(repo, `docs/dev/${ID}/reviews`))).toBe(false);
      expect(git("diff", "--cached", "--name-only").trim()).toBe("");
      expect(logged().some((line) => line.includes("stack."))).toBe(false);
    });
  }

  it("ASDLC-1/AC-1 stack.enabled false with commits phase still makes phase commits (independent of stack.enabled)", async () => {
    const cfg = {
      ...FP,
      stack: { enabled: false, commits: "phase" },
    } as unknown as DevHarnessConfig;
    write(TEST_FILE, "// red\n");
    const before = commitCount();
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: [TEST_FILE],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      cfg,
      repo,
    );
    await tryCommitPhase(
      ID,
      TASK,
      "T1/review-test",
      "review-test",
      reviewPacket([{ severity: "warning", issue: "x", file: TEST_FILE }]),
      cfg,
      repo,
    );
    expect(commitCount()).toBe(before + 2);
  });
});

describe("ASDLC-1/AC-1 empty phase completions still commit", () => {
  it("ASDLC-1/AC-1 clean review still makes its phase commit", async () => {
    const before = commitCount();
    await tryCommitPhase(
      ID,
      TASK,
      "T2/review-test",
      "review-test",
      reviewPacket([]),
      PHASE_CFG,
      repo,
    );
    expect(commitCount()).toBe(before + 1);
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] T2/review-test: ");
    expect(filesOf("HEAD")).toEqual([`${REVIEWS}/T2-review-test.md`]);
    const trailer = parseAccordTrailer(bodyOf("HEAD"));
    expect(
      Number(trailer?.crit ?? 0) + Number(trailer?.warn ?? 0) + Number(trailer?.sugg ?? 0),
    ).toBe(0);
  });

  it("ASDLC-1/AC-1 phase-verify-task with nothing to stage still records V1", async () => {
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      {
        status: "done",
        test_files: [TEST_FILE],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      PHASE_CFG,
      repo,
    );
    const t1 = git("rev-parse", "HEAD").trim();
    const before = commitCount();
    await tryCommitPhase(
      ID,
      TASK,
      "V1/phase-verify-task",
      "phase-verify-task",
      { status: "done", usage: { prompt_tokens: 1, completion_tokens: 1 } },
      PHASE_CFG,
      repo,
    );
    expect(commitCount()).toBe(before + 1);
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] V1/phase-verify-task: ");
    expect(git("rev-parse", "HEAD~1").trim()).toBe(t1);
  });
});

describe("ASDLC-1/AC-12 secret masked in every finding field", () => {
  it.each(["issue", "evidence", "recommendation"])(
    "ASDLC-1/AC-12 secret in finding %s is masked in markdown and history",
    async (field) => {
      await tryCommitPhase(
        ID,
        TASK,
        "T1/review-test",
        "review-test",
        reviewPacket([
          { severity: "warning", issue: "base", file: TEST_FILE, [field]: `key ${SECRET} end` },
        ]),
        PHASE_CFG,
        repo,
      );
      const md = readFileSync(join(repo, REVIEWS, "T1-review-test.md"), "utf8");
      expect(md).not.toContain(SECRET);
      expect(md).toContain("[REDACTED]");
      expect(git("log", "-p", "--all")).not.toContain(SECRET);
    },
  );
});

describe("ASDLC-1/AC-1 orchestrator wiring (processSubagentToolResult)", () => {
  const WIRE_CFG = (commits?: string | null, stackEnabled?: boolean): DevHarnessConfig | null =>
    commits === null
      ? null
      : ({
          schema_version: "1.0",
          language: "typescript",
          test: { command: "true", file_pattern: "**/*.test.ts" },
          type_check: null,
          lint: null,
          format: null,
          verification_commands: [],
          ...(commits || stackEnabled
            ? {
                stack: {
                  ...(commits ? { commits } : {}),
                  ...(stackEnabled ? { enabled: true } : {}),
                },
              }
            : {}),
        } as unknown as DevHarnessConfig);

  function seedWorkItem(
    phase: "phase-test" | "review-test" | "phase-code" | "review-security" | "phase-verify-task",
    status?: "done",
  ): void {
    write(
      `docs/dev/${ID}/plan.json`,
      JSON.stringify({
        tasks: [
          {
            id: TASK,
            title: "Wired task",
            files: [
              { path: SRC_FILE, action: "create" },
              { path: TEST_FILE, action: "create" },
            ],
          },
        ],
      }),
    );
    git("add", "docs");
    git("commit", "-q", "-m", "plan");
    writeTaskFixture(
      { workItemId: ID, taskId: TASK, phase, ...(status ? { status } : {}), coversAc: ["AC-1"] },
      repo,
    );
  }

  async function run(
    agent: string,
    packet: Record<string, unknown>,
    devConfig: DevHarnessConfig | null,
  ): Promise<string> {
    // Precondition: the packet must be schema-valid, else post-result handlers silently no-op.
    const validation = await validateReturn(agent, packet);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    const state: HarnessMutableState = {
      devConfig,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    return processSubagentToolResult({
      details: {
        results: [
          {
            agent,
            task: `**task_id:** ${TASK}\n${ID} wired run`,
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(packet)}\n\`\`\`` }],
              },
            ],
          },
        ],
      },
      state,
      pricing: loadPricing(),
    });
  }

  const testPacket = {
    status: "done",
    test_files: [TEST_FILE],
    red_confirmed: true,
    ac_covered: ["AC-1"],
    deviations_emitted: 0,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };

  const verifyPacket = {
    status: "done",
    evidence: [{ ac_id: "AC-1", result: "pass", tests: ["foo.test.ts"], command: "bun test" }],
    verify_output: "1 pass",
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };

  it("ASDLC-1/AC-26 phase mode: task done via verify is closed by phase commit, no per-task sweep commit", async () => {
    seedWorkItem("phase-verify-task");
    write(SRC_FILE, "export const foo = 1;\n");
    await run("phase-verify-task", verifyPacket, WIRE_CFG("phase"));
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] V1/phase-verify-task: ");
    expect(subjects().some((subject) => /^\[ASDLC-1\] Task 7:/.test(subject))).toBe(false);
  });

  it("ASDLC-1/AC-1 phase mode: phase-test result produces the T1/phase-test commit", async () => {
    seedWorkItem("phase-test");
    write(TEST_FILE, "// red\n");
    await run("phase-test", testPacket, WIRE_CFG("phase"));
    expect(git("log", "-1", "--format=%s").trim()).toStartWith("[ASDLC-1][task-7] T1/phase-test: ");
  });

  it("ASDLC-1/AC-3 phase mode: phase-code result touching a test file is not swept into a task commit", async () => {
    seedWorkItem("phase-code", "done");
    write(SRC_FILE, "export const foo = 1;\n");
    write(TEST_FILE, "// edited by code agent\n");
    await run(
      "phase-code",
      {
        status: "done",
        tests_passing: true,
        changes: [
          { file: SRC_FILE, action: "add", kind: "code", ac_ids: ["AC-1"] },
          { file: TEST_FILE, action: "modify", kind: "code", ac_ids: ["AC-1"] },
        ],
        deviations_emitted: 0,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      WIRE_CFG("phase"),
    );
    expect(subjects().some((subject) => /^\[ASDLC-1\] Task 7:/.test(subject))).toBe(false);
    expect(statusAll()).toContain(TEST_FILE);
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] C1/phase-code: ");
  });

  it("ASDLC-1/AC-1 phase mode: clean review-test result produces the T1/review-test commit with its findings file", async () => {
    seedWorkItem("review-test");
    await run("review-test", reviewPacket([]), WIRE_CFG("phase"));
    expect(git("log", "-1", "--format=%s").trim()).toStartWith(
      "[ASDLC-1][task-7] T1/review-test: ",
    );
    expect(filesOf("HEAD")).toEqual([`${REVIEWS}/T1-review-test.md`]);
  });

  it("ASDLC-1/AC-1 phase mode: critical review-test finding then retry commits T1/review-test then T2/phase-test", async () => {
    seedWorkItem("review-test");
    await run(
      "review-test",
      reviewPacket([
        { severity: "critical", issue: "weak assertion", file: TEST_FILE, evidence: "vacuous" },
      ]),
      WIRE_CFG("phase"),
    );
    const afterReview = subjects();
    expect(afterReview.at(-1)).toStartWith("[ASDLC-1][task-7] T1/review-test: ");
    expect(filesOf("HEAD")).toEqual([`${REVIEWS}/T1-review-test.md`]);
    write(TEST_FILE, "// red, strengthened\n");
    await run("phase-test", testPacket, WIRE_CFG("phase"));
    const all = subjects();
    expect(all.length).toBe(afterReview.length + 1);
    expect(all.at(-1)).toStartWith("[ASDLC-1][task-7] T2/phase-test: ");
    expect(filesOf("HEAD")).toContain(TEST_FILE);
  });

  it("ASDLC-1/AC-3 phase mode: test edit by phase-code respawns phase-test (RGR) and the re-owned phase-test commits", async () => {
    seedWorkItem("phase-code");
    write(SRC_FILE, "export const foo = 1;\n");
    write(TEST_FILE, "// edited by code agent\n");
    await run(
      "phase-code",
      {
        status: "done",
        tests_passing: true,
        changes: [
          { file: SRC_FILE, action: "add", kind: "code", ac_ids: ["AC-1"] },
          { file: TEST_FILE, action: "modify", kind: "code", ac_ids: ["AC-1"] },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      WIRE_CFG("phase"),
    );
    const task = JSON.parse(readFileSync(join(repo, ".tasks/ASDLC-1-task-7.json"), "utf8"));
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.rgr).toEqual({ used: 1, lifetime: 1 });
    expect(statusAll()).toContain(TEST_FILE);
    const codeCommits = subjects().filter((subject) =>
      subject.startsWith("[ASDLC-1][task-7] C1/phase-code: "),
    );
    expect(codeCommits.length).toBe(1);
    expect(filesOf("HEAD")).toEqual([SRC_FILE]);
    write(TEST_FILE, "// red, re-owned\n");
    await run("phase-test", testPacket, WIRE_CFG("phase"));
    // Fixture has no earlier test round, so the re-owned phase-test is round T1.
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] T1/phase-test: ");
    expect(filesOf("HEAD")).toContain(TEST_FILE);
  });

  it("ASDLC-1/AC-1 phase mode: review-security result produces the C1/review-security commit with its findings file", async () => {
    seedWorkItem("review-security");
    await run(
      "review-security",
      reviewPacket([{ severity: "warning", issue: "x", file: SRC_FILE, line: 1 }]),
      WIRE_CFG("phase"),
    );
    expect(subjects().at(-1)).toStartWith("[ASDLC-1][task-7] C1/review-security: ");
    expect(filesOf("HEAD")).toEqual([`${REVIEWS}/C1-review-security.md`]);
  });

  for (const [label, commits, stackEnabled] of [
    ["stack.commits unset", undefined],
    ['stack.commits "task"', "task"],
    ["no config", null],
    ["stack.enabled true, commits unset", undefined, true],
  ] as Array<[string, string | null | undefined, boolean?]>) {
    it(`ASDLC-1/AC-26 ${label}: done task still gets the per-task commit, no phase commit`, async () => {
      seedWorkItem("phase-verify-task");
      const before = commitCount();
      write(SRC_FILE, "export const foo = 1;\n");
      await run("phase-verify-task", verifyPacket, WIRE_CFG(commits, stackEnabled));
      expect(
        JSON.parse(readFileSync(join(repo, ".tasks/ASDLC-1-task-7.json"), "utf8")).control.status,
      ).toBe("done");
      expect(git("log", "-1", "--format=%s").trim()).toBe("[ASDLC-1] Task 7: Wired task");
      expect(subjects().some((subject) => subject.includes("[task-7] T1/"))).toBe(false);
      expect(commitCount()).toBe(before + 1);
      expect(subjects().some((subject) => subject.startsWith("[ASDLC-1][task-7] "))).toBe(false);
      for (const dir of ["reviews", "state", "evidence"]) {
        expect(existsSync(join(repo, `docs/dev/${ID}/${dir}`))).toBe(false);
      }
    });
  }
});
