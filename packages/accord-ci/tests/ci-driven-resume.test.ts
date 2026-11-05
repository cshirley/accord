import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCommitMessage,
  parseAccordTrailer,
} from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { parse as parseYaml } from "yaml";

import { raiseAlert } from "../src/ci-driven/alert.js";
import type { Pr0ExecLike } from "../src/ci-driven/pr0.js";
import {
  type AdvanceContext,
  type AdvanceResult,
  acquireResumeLock,
  createCiAdvance,
  detectResumeTrigger,
  planResume,
  type ResumeEvent,
  readGates,
  runResume,
} from "../src/ci-driven/resume.js";
import { MissingSecretError } from "../src/lib/env.js";
import type { PhaseRunBackend } from "../src/run-phase.js";

// ASDLC-1/TC-25 (this file). ASDLC-1/AC-31: the smoke doc is pinned by the last describe;
// validate:okf, validate:ste and check:biome enforcement belongs to phase-verify-task.
// ASDLC-1/AC-27 (append-only) is pinned here for the resume path: history only grows.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ID = "ASDLC-1";
const OTHER_ID = "ASDLC-2";
const TOKEN = "ghp_SENTINEL_resume_token_55cd";
const REFS = [
  "T1/phase-test",
  "T1/review-test",
  "C1/phase-code",
  "C1/review-code",
  "V1/phase-verify-task",
];

let repo: string;
let lockDir: string;
let sandbox: string;

function sh(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}
function commitAll(message: string): void {
  sh("add", "-A");
  sh("commit", "-q", "-m", message);
}
function devHarnessMd(stack: unknown): string {
  const config: Record<string, unknown> = {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    verification_commands: ["bun test"],
  };
  if (stack !== "absent") config.stack = stack;
  return `# Project\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n`;
}
type Fixture = {
  stack?: unknown;
  state?: boolean;
  id?: string;
  cost?: number;
  /** Commit a one-task plan (computeStack: task 1 is PR 1, branch stack/<ID>/pr-1). */
  plan?: boolean;
  /** Commit docs/dev/<ID>/contract.lock.json (PR0 merged). */
  lock?: boolean;
};
/** main with Dev Harness config and (optionally) the committed PR0 state snapshot. */
function fixture(opts: Fixture = {}): void {
  const id = opts.id ?? ID;
  write("AGENTS.md", devHarnessMd(opts.stack ?? { enabled: true }));
  write(".gitignore", ".tasks/\n");
  write(`docs/dev/${id}/brief.md`, "# brief\n");
  write(`docs/dev/${id}/spec.json`, "{}\n");
  if (opts.state !== false) {
    write(
      `docs/dev/${id}/state/work-item.json`,
      `${JSON.stringify({ id, phase: "implementing", cost_usd: opts.cost ?? 0 })}\n`,
    );
    write(
      `docs/dev/${id}/state/task-1/task.json`,
      `${JSON.stringify({ task: 1, work_item: id })}\n`,
    );
  }
  if (opts.plan) {
    write(
      `docs/dev/${id}/plan.json`,
      `${JSON.stringify({ tasks: [{ id: 1, est_lines: 10, files: [{ path: "src/a.ts", action: "add" }] }] })}\n`,
    );
  }
  if (opts.lock) write(`docs/dev/${id}/contract.lock.json`, "{}\n");
  commitAll("init");
  sh("branch", "-M", "main");
}
const BRANCH = `stack/${ID}/pr-1`;
/** Bare origin with main pushed; the local repo tracks it (as a CI checkout would). */
function withOrigin(): string {
  const origin = join(sandbox, "origin.git");
  mkdirSync(origin);
  gitIn(origin, "init", "-q", "--bare", "-b", "main");
  sh("remote", "add", "origin", origin);
  sh("push", "-q", "origin", "main");
  return origin;
}
function typedCommit(seq: number, ref: string, id: string = ID, outcome = "done"): void {
  typedCommitAt(repo, seq, ref, id, outcome);
}
function typedCommitAt(
  dir: string,
  seq: number,
  ref: string,
  id: string = ID,
  outcome = "done",
): void {
  const message = buildCommitMessage({
    summary: "step",
    trailer: {
      v: 1,
      id,
      task: 1,
      seq,
      ref,
      agent: ref.split("/")[1] ?? "x",
      loop: ref.slice(0, 1),
      round: 1,
      outcome,
    },
  });
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], { cwd: dir });
}
function gitIn(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}
function typedRefs(): string[] {
  return typedRefsIn(repo);
}
function typedRefsIn(dir: string, rev = "HEAD"): string[] {
  const out = gitIn(dir, "log", "--reverse", "--format=%B%x00", rev);
  return out
    .split("\0")
    .map((message) => parseAccordTrailer(message))
    .filter((trailer) => trailer !== null && trailer.id === ID)
    .map((trailer) => trailer?.ref as string);
}

beforeEach(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "accord-resume-")));
  repo = join(sandbox, "repo");
  lockDir = join(sandbox, "locks");
  mkdirSync(repo);
  mkdirSync(lockDir);
  sh("init", "-q");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ── trigger selection (ASDLC-1/AC-24) ────────────────────────────────────────

const LOCK_PUSH: ResumeEvent = {
  name: "push",
  branch: "main",
  changedFiles: [`docs/dev/${ID}/contract.lock.json`, `docs/dev/${ID}/plan.json`],
};
function comment(body: string, authorAssociation = "OWNER"): ResumeEvent {
  return {
    name: "issue_comment",
    body,
    authorAssociation,
    isPullRequest: true,
    prBranch: `accord/${ID}/x`,
  };
}

describe("ASDLC-1/AC-24 resume trigger selection", () => {
  it("push to main touching contract.lock.json selects resume for that work item", () => {
    fixture();
    expect(detectResumeTrigger({ repoRoot: repo, event: LOCK_PUSH })).toEqual({
      trigger: true,
      workItemId: ID,
      kind: "merge",
    });
  });

  it.each([
    ["approve", "/accord approve"],
    ["unblock", "/accord unblock"],
    ["trailing newline", "/accord approve\n"],
    ["surrounding whitespace", "  /accord unblock  "],
    ["unblock with task and reason", "/accord unblock 3 fixture was flaky, retry"],
  ])("gate comment by an authorised user selects resume (%s)", (_label, body) => {
    fixture();
    expect(detectResumeTrigger({ repoRoot: repo, event: comment(body) })).toEqual({
      trigger: true,
      workItemId: ID,
      kind: "gate_comment",
    });
  });

  it.each(["OWNER", "MEMBER", "COLLABORATOR"])("author_association %s is authorised", (assoc) => {
    fixture();
    const result = detectResumeTrigger({
      repoRoot: repo,
      event: comment("/accord approve", assoc),
    });
    expect(result.trigger).toBe(true);
  });

  it.each(["NONE", "CONTRIBUTOR", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "MANNEQUIN", ""])(
    "author_association %p is not authorised: no resume",
    (assoc) => {
      fixture();
      const result = detectResumeTrigger({
        repoRoot: repo,
        event: comment("/accord approve", assoc),
      });
      expect(result.trigger).toBe(false);
    },
  );

  it.each([
    "",
    "   ",
    "/accord approved",
    "accord approve",
    "/accord reject",
    "/accord",
    "/accordapprove",
    "looks good, approve",
    "/accord unblock three reason",
    "/accord unblocked 3 reason",
    "/accord approve 3 reason",
  ])("comment %p is not a gate command: no resume", (body) => {
    fixture();
    expect(detectResumeTrigger({ repoRoot: repo, event: comment(body) }).trigger).toBe(false);
  });

  it("gate command on a plain issue (not a PR) does not resume", () => {
    fixture();
    const event = {
      ...(comment("/accord approve") as object),
      isPullRequest: false,
    } as ResumeEvent;
    expect(detectResumeTrigger({ repoRoot: repo, event }).trigger).toBe(false);
  });

  // ASDLC-1/AC-24 (F-016): after PR0 merges the work item PRs are the stack branches
  it.each([
    ["stack/ASDLC-1/pr-1", "a task PR branch"],
    ["stack/ASDLC-1/pr-12", "a later task PR branch"],
    ["stack/ASDLC-1/closeout", "the closeout PR branch"],
  ])("gate comment on stack PR branch %p (%s) selects resume for that work item", (prBranch) => {
    fixture();
    const event = { ...(comment("/accord unblock") as object), prBranch } as ResumeEvent;
    expect(detectResumeTrigger({ repoRoot: repo, event })).toEqual({
      trigger: true,
      workItemId: ID,
      kind: "gate_comment",
    });
  });

  it.each([
    ["stack/ASDLC-1", "no segment after the id"],
    ["stack/ASDLC-1/other", "a stack branch that is neither pr-<N> nor closeout"],
    ["stack/ASDLC-1/pr-", "no PR number"],
    ["accord/ASDLC-1", "no segment after the id"],
    ["foo/ASDLC-1/bar", "a wrong prefix"],
    ["accord//x", "an empty id"],
    ["main", "the default branch"],
  ])("gate comment on PR branch %p (%s) does not resume", (prBranch) => {
    fixture();
    const event = { ...(comment("/accord approve") as object), prBranch } as ResumeEvent;
    expect(detectResumeTrigger({ repoRoot: repo, event }).trigger).toBe(false);
  });

  it.each([
    ["push without a lock file", ["docs/dev/ASDLC-1/brief.md", "src/a.ts"]],
    ["nested lock file name", [`docs/dev/${ID}/other/contract.lock.json`]],
    ["lock file suffix", [`docs/dev/${ID}/contract.lock.json.bak`]],
    ["lock file outside docs/dev", ["contract.lock.json"]],
    ["empty push", []],
  ])("main push: %s does not resume", (_label, changedFiles) => {
    fixture();
    const event: ResumeEvent = { name: "push", branch: "main", changedFiles };
    expect(detectResumeTrigger({ repoRoot: repo, event }).trigger).toBe(false);
  });

  it("push to a non-main branch touching the lock file does not resume", () => {
    fixture();
    const event: ResumeEvent = { ...LOCK_PUSH, branch: "accord/ASDLC-1/x" } as ResumeEvent;
    expect(detectResumeTrigger({ repoRoot: repo, event }).trigger).toBe(false);
  });

  it.each([
    ["enabled false", { enabled: false }],
    ["stack key absent", "absent"],
    ["enabled string true", { enabled: "true" }],
    ["enabled missing", {}],
  ])("stack.enabled %s ends green without running (both triggers)", (_label, stack) => {
    fixture({ stack });
    expect(detectResumeTrigger({ repoRoot: repo, event: LOCK_PUSH })).toEqual({
      trigger: false,
      reason: "stack_disabled",
    });
    expect(detectResumeTrigger({ repoRoot: repo, event: comment("/accord approve") })).toEqual({
      trigger: false,
      reason: "stack_disabled",
    });
  });

  it("enabled but no committed state ends green without running (both triggers)", () => {
    fixture({ state: false });
    expect(detectResumeTrigger({ repoRoot: repo, event: LOCK_PUSH })).toEqual({
      trigger: false,
      reason: "no_committed_state",
    });
    expect(detectResumeTrigger({ repoRoot: repo, event: comment("/accord unblock") })).toEqual({
      trigger: false,
      reason: "no_committed_state",
    });
  });

  it("state of another work item does not count as committed state", () => {
    fixture({ state: false });
    write(`docs/dev/${OTHER_ID}/state/work-item.json`, "{}\n");
    commitAll("other");
    expect(detectResumeTrigger({ repoRoot: repo, event: LOCK_PUSH })).toEqual({
      trigger: false,
      reason: "no_committed_state",
    });
  });
});

// ── lock (ASDLC-1/AC-24) ─────────────────────────────────────────────────────

describe("ASDLC-1/AC-24 one concurrency lock per <ID>", () => {
  it("second acquire for the same id is refused until release", () => {
    const first = acquireResumeLock({ workItemId: ID, lockDir });
    expect(first.acquired).toBe(true);
    expect(acquireResumeLock({ workItemId: ID, lockDir })).toEqual({ acquired: false });
    if (first.acquired) first.release();
    const again = acquireResumeLock({ workItemId: ID, lockDir });
    expect(again.acquired).toBe(true);
    if (again.acquired) again.release();
  });

  it("locks are per id: a different id acquires while the first is held", () => {
    const first = acquireResumeLock({ workItemId: ID, lockDir });
    const other = acquireResumeLock({ workItemId: OTHER_ID, lockDir });
    expect(first.acquired).toBe(true);
    expect(other.acquired).toBe(true);
    if (first.acquired) first.release();
    if (other.acquired) other.release();
  });

  it("releasing the lock for one id does not release another id's lock", () => {
    const first = acquireResumeLock({ workItemId: ID, lockDir });
    const other = acquireResumeLock({ workItemId: OTHER_ID, lockDir });
    if (first.acquired) first.release();
    expect(acquireResumeLock({ workItemId: OTHER_ID, lockDir })).toEqual({ acquired: false });
    if (other.acquired) other.release();
  });

  it("the lock is a real on-disk artifact: a second process is refused while held, acquires after release", () => {
    const modulePath = join(ROOT, "packages/accord-ci/src/ci-driven/resume.ts");
    const code = [
      `import { acquireResumeLock } from ${JSON.stringify(modulePath)};`,
      `const r = acquireResumeLock({ workItemId: ${JSON.stringify(ID)}, lockDir: ${JSON.stringify(lockDir)} });`,
      "process.stdout.write(JSON.stringify(r.acquired));",
      "if (r.acquired) r.release();",
    ].join("\n");
    const child = () =>
      Bun.spawnSync([process.execPath, "-e", code], {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      })
        .stdout.toString()
        .trim();
    const held = acquireResumeLock({ workItemId: ID, lockDir });
    try {
      expect(held.acquired).toBe(true);
      expect(readdirSync(lockDir)).toHaveLength(1);
      expect(child()).toBe("false");
    } finally {
      if (held.acquired) held.release();
    }
    expect(readdirSync(lockDir)).toEqual([]);
    expect(child()).toBe("true");
    expect(readdirSync(lockDir)).toEqual([]);
  });
});

// ── gates (ASDLC-1/AC-24) ────────────────────────────────────────────────────

function closeoutMessage(id: string, outcome: string): string {
  return buildCommitMessage({
    summary: "closeout",
    trailer: {
      v: 1,
      id,
      task: 1,
      seq: 9,
      ref: "V1/closeout",
      agent: "x",
      loop: "V",
      round: 1,
      outcome,
    },
  });
}

describe("ASDLC-1/AC-24 gates are read from PR comments or commits", () => {
  const none = { pr0_approved: false, unblock_requested: false, closeout_ready: false };

  it("no comments and no commits: every gate closed", () => {
    expect(readGates({ workItemId: ID, comments: [], commitMessages: [] })).toEqual(none);
  });

  it("authorised /accord approve opens the PR0 approval gate only", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [{ body: "/accord approve", author_association: "MEMBER" }],
      commitMessages: [],
    });
    expect(gates).toEqual({ ...none, pr0_approved: true });
  });

  it("authorised /accord unblock opens the blocked-task gate only", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [{ body: "/accord unblock", author_association: "OWNER" }],
      commitMessages: [],
    });
    expect(gates).toEqual({ ...none, unblock_requested: true });
  });

  it("/accord unblock <task> <reason> carries the task number and the reason", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [
        { body: "/accord unblock 3 fixture was flaky, retry", author_association: "OWNER" },
      ],
      commitMessages: [],
    });
    expect(gates).toEqual({
      ...none,
      unblock_requested: true,
      unblock: { task: 3, reason: "fixture was flaky, retry" },
    });
  });

  it("an unauthorised /accord unblock <task> <reason> carries nothing", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [{ body: "/accord unblock 3 please", author_association: "NONE" }],
      commitMessages: [],
    });
    expect(gates).toEqual(none);
  });

  it("comments from unauthorised users and near-miss commands open nothing", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [
        { body: "/accord approve", author_association: "NONE" },
        { body: "/accord unblock", author_association: "CONTRIBUTOR" },
        { body: "/accord approved", author_association: "OWNER" },
        { body: "please unblock", author_association: "OWNER" },
      ],
      commitMessages: [],
    });
    expect(gates).toEqual(none);
  });

  it("closeout gate opens on a typed commit with outcome=closeout for this id", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [],
      commitMessages: [closeoutMessage(ID, "closeout")],
    });
    expect(gates).toEqual({ ...none, closeout_ready: true });
  });

  it("closeout commit of another work item or another outcome keeps the gate closed", () => {
    const gates = readGates({
      workItemId: ID,
      comments: [],
      commitMessages: [closeoutMessage(OTHER_ID, "closeout"), closeoutMessage(ID, "done")],
    });
    expect(gates).toEqual(none);
  });
});

// ── planResume (ASDLC-1/AC-24, ASDLC-1/AC-27) ────────────────────────────────

describe("ASDLC-1/AC-24 planResume reads the last typed commit", () => {
  it("no typed commit: lastRef null, lastSeq 0", () => {
    fixture();
    expect(planResume({ repoRoot: repo, workItemId: ID })).toEqual({ lastRef: null, lastSeq: 0 });
  });

  it("returns the newest typed commit's ref and seq, and does not touch history", () => {
    fixture();
    typedCommit(1, REFS[0] as string);
    typedCommit(2, REFS[1] as string);
    const head = sh("rev-parse", "HEAD");
    const plan = planResume({ repoRoot: repo, workItemId: ID });
    expect(plan).toEqual({ lastRef: REFS[1] as string, lastSeq: 2 });
    expect(planResume({ repoRoot: repo, workItemId: ID })).toEqual(plan);
    expect(sh("rev-parse", "HEAD")).toBe(head);
  });

  it("ignores later untyped commits and typed commits of other work items", () => {
    fixture();
    typedCommit(1, REFS[0] as string);
    typedCommit(7, "C9/phase-code", OTHER_ID);
    write("note.txt", "x\n");
    commitAll("chore: unrelated");
    expect(planResume({ repoRoot: repo, workItemId: ID })).toEqual({
      lastRef: REFS[0] as string,
      lastSeq: 1,
    });
  });
});

// ── runResume: skip, interruption, resume, append-only ──────────────────────

type Harness = {
  contexts: AdvanceContext[];
  execCalls: {
    cmd: string;
    args: readonly string[];
    env?: Readonly<Record<string, string | undefined>>;
  }[];
  logs: Record<"debug" | "info" | "warn" | "error", string[]>;
};
function harness(): Harness {
  return { contexts: [], execCalls: [], logs: { debug: [], info: [], warn: [], error: [] } };
}
function baseOpts(h: Harness, advance: (ctx: AdvanceContext) => Promise<AdvanceResult>) {
  return {
    repoRoot: repo,
    workItemId: ID,
    lockDir,
    prNumber: 42,
    env: { ACCORD_CI_PUSH_TOKEN: TOKEN } as Record<string, string | undefined>,
    exec: async (
      cmd: string,
      args: readonly string[],
      opts?: { env?: Record<string, string | undefined> },
    ) => {
      h.execCalls.push({ cmd, args, env: opts?.env });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    logger: {
      debug: (m: string) => void h.logs.debug.push(m),
      info: (m: string) => void h.logs.info.push(m),
      warn: (m: string) => void h.logs.warn.push(m),
      error: (m: string) => void h.logs.error.push(m),
    },
    advance: async (ctx: AdvanceContext) => {
      h.contexts.push(ctx);
      return advance(ctx);
    },
  };
}
/** Deterministic stepper: commits the ref that follows ctx.lastRef; throws after step `interruptAfter`. */
function stepper(interruptAfter: number | null, cost = 0) {
  return async (ctx: AdvanceContext): Promise<AdvanceResult> => {
    const index = ctx.lastRef === null ? 0 : REFS.indexOf(ctx.lastRef) + 1;
    if (index >= REFS.length) return { done: true };
    typedCommit(ctx.lastSeq + 1, REFS[index] as string);
    if (interruptAfter === index) throw new Error(`interrupted after ${REFS[index]}`);
    return { done: false, ref: REFS[index] as string, cost_usd: cost };
  };
}

describe("ASDLC-1/AC-24 runResume entry checks", () => {
  it("stack disabled: skipped, advance never called, lock not left behind, no alert", async () => {
    fixture({ stack: { enabled: false } });
    const h = harness();
    const before = sh("rev-parse", "HEAD");
    const result = await runResume(baseOpts(h, stepper(null)));
    expect(result).toEqual({ status: "skipped", reason: "stack_disabled" });
    expect(h.contexts).toEqual([]);
    expect(h.execCalls).toEqual([]);
    expect(h.logs.error).toEqual([]);
    expect(sh("rev-parse", "HEAD")).toBe(before);
    expect(readdirSync(lockDir)).toEqual([]);
  });

  it("no committed state: skipped, advance never called", async () => {
    fixture({ state: false });
    const h = harness();
    const result = await runResume(baseOpts(h, stepper(null)));
    expect(result).toEqual({ status: "skipped", reason: "no_committed_state" });
    expect(h.contexts).toEqual([]);
    expect(h.execCalls).toEqual([]);
  });

  it("enabled with state: restores .tasks from the committed snapshot, then advances", async () => {
    fixture();
    expect(existsSync(join(repo, ".tasks", `${ID}.json`))).toBe(false);
    const h = harness();
    const restoredBeforeAdvance: boolean[] = [];
    const step = stepper(null);
    const result = await runResume(
      baseOpts(h, async (ctx) => {
        restoredBeforeAdvance.push(
          existsSync(join(repo, ".tasks", `${ID}.json`)) &&
            existsSync(join(repo, ".tasks", `${ID}-task-1.json`)),
        );
        return step(ctx);
      }),
    );
    expect(result).toEqual({ status: "completed", lastRef: REFS.at(-1) as string });
    // restore happens BEFORE the first advance, on every advance
    expect(restoredBeforeAdvance).toEqual(restoredBeforeAdvance.map(() => true));
    expect(restoredBeforeAdvance.length).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(repo, ".tasks", `${ID}.json`), "utf8"))).toEqual({
      id: ID,
      phase: "implementing",
      cost_usd: 0,
    });
    expect(JSON.parse(readFileSync(join(repo, ".tasks", `${ID}-task-1.json`), "utf8"))).toEqual({
      task: 1,
      work_item: ID,
    });
  });
});

describe("ASDLC-1/AC-24 runResume hands run-time gate state to the run", () => {
  const closed = { pr0_approved: false, unblock_requested: false, closeout_ready: false };
  const finish = async (): Promise<AdvanceResult> => ({ done: true });

  it("PR comment /accord unblock by an authorised user opens only the blocked-task gate", async () => {
    fixture();
    const h = harness();
    await runResume({
      ...baseOpts(h, finish),
      fetchComments: async () => [{ body: "/accord unblock", author_association: "OWNER" }],
    });
    expect(h.contexts[0]?.gates).toEqual({ ...closed, unblock_requested: true });
  });

  it("PR comment /accord approve opens only the PR0 approval gate", async () => {
    fixture();
    const h = harness();
    await runResume({
      ...baseOpts(h, finish),
      fetchComments: async () => [{ body: "/accord approve", author_association: "MEMBER" }],
    });
    expect(h.contexts[0]?.gates).toEqual({ ...closed, pr0_approved: true });
  });

  it("an unauthorised /accord approve comment opens nothing", async () => {
    fixture();
    const h = harness();
    await runResume({
      ...baseOpts(h, finish),
      fetchComments: async () => [{ body: "/accord approve", author_association: "NONE" }],
    });
    expect(h.contexts[0]?.gates).toEqual(closed);
  });

  it("no comments: every gate is closed", async () => {
    fixture();
    const h = harness();
    await runResume({ ...baseOpts(h, finish), fetchComments: async () => [] });
    expect(h.contexts[0]?.gates).toEqual(closed);
  });

  it("closeout gate is read from git log, not injected: a closeout typed commit for this id", async () => {
    fixture();
    sh("commit", "-q", "--allow-empty", "-m", closeoutMessage(ID, "closeout"));
    const h = harness();
    await runResume({ ...baseOpts(h, finish), fetchComments: async () => [] });
    expect(h.contexts[0]?.gates).toEqual({ ...closed, closeout_ready: true });
  });

  it("a closeout commit of another work item does not open this id's closeout gate", async () => {
    fixture();
    sh("commit", "-q", "--allow-empty", "-m", closeoutMessage(OTHER_ID, "closeout"));
    const h = harness();
    await runResume({ ...baseOpts(h, finish), fetchComments: async () => [] });
    expect(h.contexts[0]?.gates).toEqual(closed);
  });
});

describe("ASDLC-1/AC-24 PR0 approval gate: the PR0 merge commit is a signal", () => {
  const finish = async (): Promise<AdvanceResult> => ({ done: true });
  const closed = { pr0_approved: false, unblock_requested: false, closeout_ready: false };

  it("contract.lock.json of this id on the checked-out tree opens the PR0 approval gate with no comment", async () => {
    fixture({ lock: true });
    const h = harness();
    await runResume({ ...baseOpts(h, finish), fetchComments: async () => [] });
    expect(h.contexts[0]?.gates).toEqual({ ...closed, pr0_approved: true });
  });

  it("another work item's contract.lock.json does not open this id's gate", async () => {
    fixture({ lock: true, id: OTHER_ID });
    write(`docs/dev/${ID}/brief.md`, "# brief\n");
    write(`docs/dev/${ID}/spec.json`, "{}\n");
    write(`docs/dev/${ID}/state/work-item.json`, `${JSON.stringify({ id: ID })}\n`);
    commitAll("this id has state but no lock");
    const h = harness();
    await runResume({ ...baseOpts(h, finish), fetchComments: async () => [] });
    expect(h.contexts[0]?.gates).toEqual(closed);
  });
});

// ── post-PR0 branch topology (ASDLC-1/AC-24, ASDLC-1/AC-27; engineer decision q_guidance_6) ──
// Typed commits go to stack/<ID>/pr-<N> (never main); a push-to-main trigger carries <ID> only and
// resume derives the next PR branch from the committed plan; alerts target the stack PR.

type FakePr = { number: number; headRefName: string };
/**
 * Fake gh. Contract pinned for the implementation: PRs are listed with
 * `gh pr list --head <branch> --json number,headRefName` (no --jq; stdout is a JSON array of
 * {number, headRefName}); an unfiltered `gh pr list` returns every PR.
 */
function ghExec(h: Harness, prs: FakePr[], listExit = 0) {
  return async (
    cmd: string,
    args: readonly string[],
    opts?: { env?: Record<string, string | undefined> },
  ) => {
    h.execCalls.push({ cmd, args, env: opts?.env });
    if (cmd === "gh" && args[0] === "pr" && args[1] === "list") {
      if (listExit !== 0) return { exitCode: listExit, stdout: "", stderr: "HTTP 502" };
      const headIndex = args.indexOf("--head");
      const head = headIndex >= 0 ? args[headIndex + 1] : undefined;
      const rows = prs.filter((pr) => head === undefined || pr.headRefName === head);
      return { exitCode: 0, stdout: JSON.stringify(rows), stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}
const prComments = (h: Harness) =>
  h.execCalls.filter((c) => c.cmd === "gh" && c.args[0] === "pr" && c.args[1] === "comment");
const gateFails = async (): Promise<AdvanceResult> => ({ done: false, gate_failed: "verify" });

describe("ASDLC-1/AC-24 resume derives the stack branch from the committed plan", () => {
  it("push-to-main resume (no PR, on main): switches to stack/<ID>/pr-1 off main, advance sees it", async () => {
    fixture({ plan: true, lock: true });
    const origin = withOrigin();
    const mainBefore = gitIn(origin, "rev-parse", "main");
    const h = harness();
    const result = await runResume({
      ...baseOpts(h, async () => ({ done: true })),
      prNumber: undefined,
    });
    expect(result.status).toBe("completed");
    expect(h.contexts[0]?.branch).toBe(BRANCH);
    expect(sh("rev-parse", "--abbrev-ref", "HEAD")).toBe(BRANCH);
    expect(gitIn(origin, "rev-parse", "main")).toBe(mainBefore);
  });

  it("a rerun on the stack branch stays on it", async () => {
    fixture({ plan: true, lock: true });
    withOrigin();
    sh("checkout", "-q", "-b", BRANCH);
    const h = harness();
    await runResume({ ...baseOpts(h, async () => ({ done: true })), prNumber: undefined });
    expect(h.contexts[0]?.branch).toBe(BRANCH);
    expect(sh("rev-parse", "--abbrev-ref", "HEAD")).toBe(BRANCH);
  });
});

describe("ASDLC-1/AC-24 alerts target the work item PR (no PR number on a push trigger)", () => {
  async function failOnStackBranch(prs: FakePr[], listExit = 0) {
    fixture({ plan: true, lock: true });
    withOrigin();
    const h = harness();
    const result = await runResume({
      ...baseOpts(h, gateFails),
      exec: ghExec(h, prs, listExit),
      prNumber: undefined,
    });
    return { h, result };
  }

  it("the open PR whose head is the current stack branch gets the comment, not the PR0 PR", async () => {
    const { h, result } = await failOnStackBranch([
      { number: 5, headRefName: `accord/${ID}/contract` },
      { number: 77, headRefName: BRANCH },
    ]);
    expect(result).toEqual({ status: "gate_failed", gate: "verify" });
    const lists = h.execCalls.filter((c) => c.args[0] === "pr" && c.args[1] === "list");
    expect(lists.length).toBeGreaterThan(0);
    expect(lists[0]?.args).toContain(BRANCH);
    expect(prComments(h)).toHaveLength(1);
    expect(prComments(h)[0]?.args[2]).toBe("77");
    expect(h.logs.error).toHaveLength(1);
  });

  it("no stack PR: falls back to the PR0 PR (head accord/<ID>/*)", async () => {
    const { h } = await failOnStackBranch([
      { number: 5, headRefName: `accord/${ID}/contract` },
      { number: 8, headRefName: `accord/${OTHER_ID}/x` },
    ]);
    expect(prComments(h)).toHaveLength(1);
    expect(prComments(h)[0]?.args[2]).toBe("5");
  });

  it("no PR for this work item: one error log, no comment, no failure", async () => {
    const { h, result } = await failOnStackBranch([
      { number: 9, headRefName: `stack/${OTHER_ID}/pr-1` },
      { number: 8, headRefName: `accord/${OTHER_ID}/x` },
    ]);
    expect(result).toEqual({ status: "gate_failed", gate: "verify" });
    expect(h.logs.error).toHaveLength(1);
    expect(h.logs.error[0]).toMatch(/^stack\.ci\.alert work_item_id=ASDLC-1 condition=\S*gate/);
    expect(prComments(h)).toEqual([]);
  });

  it("gh pr list fails: the alert path never fails; log once, no comment", async () => {
    const { h, result } = await failOnStackBranch([{ number: 77, headRefName: BRANCH }], 1);
    expect(result).toEqual({ status: "gate_failed", gate: "verify" });
    expect(h.logs.error).toHaveLength(1);
    expect(prComments(h)).toEqual([]);
  });

  it("an explicit prNumber (comment trigger) is used as given: no PR lookup", async () => {
    fixture();
    const h = harness();
    await runResume({
      ...baseOpts(h, gateFails),
      exec: ghExec(h, [{ number: 77, headRefName: BRANCH }]),
    });
    expect(h.execCalls.filter((c) => c.args[1] === "list")).toEqual([]);
    expect(prComments(h)[0]?.args[2]).toBe("42");
  });
});

describe("ASDLC-1/AC-24 + ASDLC-1/AC-27 interrupt at each typed commit and rerun", () => {
  it("uninterrupted run produces the full ref chain once, with seq 1..n", async () => {
    fixture();
    const h = harness();
    await runResume(baseOpts(h, stepper(null)));
    expect(typedRefs()).toEqual(REFS);
    expect(h.contexts.map((ctx) => [ctx.lastRef, ctx.lastSeq])).toEqual([
      [null, 0],
      ...REFS.map((ref, index) => [ref, index + 1]),
    ]);
  });

  it.each(REFS.map((ref, index) => [index, ref] as const))(
    "interrupted after %i (%s): rerun resumes from that typed commit, same next ref, no rewrite",
    async (index, ref) => {
      fixture();
      const first = harness();
      await expect(runResume(baseOpts(first, stepper(index)))).rejects.toThrow(
        `interrupted after ${ref}`,
      );
      const afterInterrupt = sh("rev-list", "--reverse", "HEAD").split("\n");
      expect(typedRefs()).toEqual(REFS.slice(0, index + 1));

      const second = harness();
      const result = await runResume(baseOpts(second, stepper(null)));

      expect(result).toEqual({ status: "completed", lastRef: REFS.at(-1) as string });
      expect(second.contexts[0]).toMatchObject({
        lastRef: ref,
        lastSeq: index + 1,
        workItemId: ID,
      });
      // same chain as an uninterrupted run: nothing repeated, nothing skipped
      expect(typedRefs()).toEqual(REFS);
      // append-only: every pre-interrupt commit is still, in order, the prefix of history
      const finalHistory = sh("rev-list", "--reverse", "HEAD").split("\n");
      expect(finalHistory.slice(0, afterInterrupt.length)).toEqual(afterInterrupt);
      expect(finalHistory.length).toBe(afterInterrupt.length + (REFS.length - index - 1));
      // the interrupted run released its lock
      expect(readdirSync(lockDir).length).toBe(0);
    },
  );

  it("rerun after completion adds no commits", async () => {
    fixture();
    await runResume(baseOpts(harness(), stepper(null)));
    const head = sh("rev-parse", "HEAD");
    const h = harness();
    const result = await runResume(baseOpts(h, stepper(null)));
    expect(result).toEqual({ status: "completed", lastRef: REFS.at(-1) as string });
    expect(sh("rev-parse", "HEAD")).toBe(head);
    expect(h.contexts).toHaveLength(1);
    expect(h.contexts[0]).toMatchObject({ lastRef: REFS.at(-1) as string, lastSeq: REFS.length });
  });
});

describe("ASDLC-1/AC-24 concurrent run for the same <ID> is refused by the lock", () => {
  it("second runResume returns locked without advancing; third succeeds after the first ends", async () => {
    fixture();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstHarness = harness();
    const first = runResume(
      baseOpts(firstHarness, async (ctx) => {
        if (ctx.lastRef === null) await gate;
        return stepper(null)(ctx);
      }),
    );
    // bounded; racing `first` makes an early rejection fail at once with its own message
    for (let attempt = 0; attempt < 200 && firstHarness.contexts.length === 0; attempt++) {
      await Promise.race([new Promise((resolve) => setTimeout(resolve, 5)), first]);
    }
    expect(firstHarness.contexts).toHaveLength(1);

    const secondHarness = harness();
    const second = await runResume(baseOpts(secondHarness, stepper(null)));
    expect(second).toEqual({ status: "locked" });
    expect(secondHarness.contexts).toEqual([]);
    expect(typedRefs()).toEqual([]);

    release();
    expect((await first).status).toBe("completed");
    expect(typedRefs()).toEqual(REFS);
    const third = await runResume(baseOpts(harness(), stepper(null)));
    expect(third.status).toBe("completed");
  });
});

// ── CI default advance (ASDLC-1/AC-24, ASDLC-1/AC-27) ────────────────────────
// The spec does not define how the CI advance drives phases; the contract pinned here is the
// minimum AC-24 + AC-27 need: one exec-harness phase run per advance, the orchestrator's typed
// commit pushed once without force, and "done" when no new typed commit appeared.

const realExec: Pr0ExecLike = async (cmd, args, opts) => {
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd: opts?.cwd,
    env: { ...process.env, ...opts?.env } as Record<string, string>,
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
};

type BackendCall = Parameters<PhaseRunBackend>[0];
/** Fake exec-harness backend: like the orchestrator, it makes the next typed commit in opts.cwd. */
function commitBackend(options: { cost?: number; calls?: BackendCall[] } = {}): PhaseRunBackend {
  return async (opts) => {
    options.calls?.push(opts);
    const dir = opts.cwd ?? "";
    const done = typedRefsIn(dir).length;
    if (done < REFS.length) typedCommitAt(dir, done + 1, REFS[done] as string);
    if (options.cost !== undefined) {
      mkdirSync(join(dir, ".tasks"), { recursive: true });
      writeFileSync(
        join(dir, ".tasks", `${ID}.json`),
        JSON.stringify({ id: ID, phase: "implementing", cost_usd: options.cost }),
      );
    }
    return {
      exitCode: 0,
      lastRun: {
        stopReason: "spawned_subagent",
        lastSpawn: { agent: "phase-test", exitCode: 0, parsedReturn: { status: "done" } },
      } as never,
    };
  };
}
const NO_GATES = { pr0_approved: false, unblock_requested: false, closeout_ready: false };
const FORCE_ARG = /^(-f|--force.*|--mirror|\+.*)$|:\+/;

describe("ASDLC-1/AC-24 + ASDLC-1/AC-27 default CI advance: one typed commit, one non-force push", () => {
  type ExecCall = { cmd: string; args: string[]; opts: unknown; head: string };
  const TOKEN_B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
  function spyExec(pushExit = 0): { exec: Pr0ExecLike; calls: ExecCall[] } {
    const calls: ExecCall[] = [];
    const exec: Pr0ExecLike = async (cmd, args, opts) => {
      calls.push({ cmd, args: [...args], opts, head: sh("rev-parse", "HEAD") });
      return args.includes("push") && pushExit !== 0
        ? { exitCode: pushExit, stdout: "", stderr: "! [rejected] non-fast-forward" }
        : { exitCode: 0, stdout: "", stderr: "" };
    };
    return { exec, calls };
  }
  const ctxAfter = (count: number): AdvanceContext => ({
    workItemId: ID,
    repoRoot: repo,
    lastRef: REFS[count - 1] as string,
    lastSeq: count,
    branch: BRANCH,
    gates: NO_GATES,
  });
  /** The orchestrator has switched to the task branch (ensureTaskBranch) before the advance. */
  function seed(count: number): void {
    fixture();
    sh("checkout", "-q", "-b", BRANCH);
    for (let index = 0; index < count; index++) typedCommit(index + 1, REFS[index] as string);
  }

  it("one advance: one backend run for this id in this repo, exactly one new typed commit seq+1, one push of it", async () => {
    seed(1);
    // ASDLC-1/AC-24 (F-019): the work item already spent 1; the returned figure is the running total
    write(".tasks/ASDLC-1.json", JSON.stringify({ id: ID, phase: "implementing", cost_usd: 1 }));
    const before = sh("rev-list", "--count", "HEAD");
    const backendCalls: BackendCall[] = [];
    const { exec, calls } = spyExec();
    const advance = createCiAdvance({
      runBackend: commitBackend({ cost: 1.25, calls: backendCalls }),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const result = await advance(ctxAfter(1));

    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]?.ticket).toBe(ID);
    // F-021: the advance asks the backend's resume entry; the orchestrator picks the next agent
    expect(backendCalls[0]?.phase).toBe("resume");
    expect(realpathSync(backendCalls[0]?.cwd ?? "")).toBe(realpathSync(repo));
    expect(Number(sh("rev-list", "--count", "HEAD"))).toBe(Number(before) + 1);
    const trailer = parseAccordTrailer(sh("log", "-1", "--format=%B"));
    expect(trailer).toMatchObject({ id: ID, seq: 2, ref: REFS[1] as string });
    expect(result).toEqual({ done: false, ref: REFS[1] as string, cost_usd: 1.25 });

    const pushes = calls.filter((call) => call.args.includes("push"));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]?.cmd).toBe("git");
    // pushed AFTER the typed commit exists, and it is the new commit that goes out
    expect(pushes[0]?.head).toBe(sh("rev-parse", "HEAD"));
    for (const arg of pushes[0]?.args ?? []) expect(arg).not.toMatch(FORCE_ARG);
    // ASDLC-1/AC-24 (F-018): the push carries the push token (checkouts persist no credentials)
    const carried = JSON.stringify([pushes[0]?.args, pushes[0]?.opts]);
    expect(carried.includes(TOKEN) || carried.includes(TOKEN_B64)).toBe(true);
    // ASDLC-1/AC-24 (F-016): the push goes to the task branch, never to main
    const pushArgs = pushes[0]?.args ?? [];
    expect(
      pushArgs.some((arg) =>
        /^(HEAD|stack\/ASDLC-1\/pr-1):(refs\/heads\/)?stack\/ASDLC-1\/pr-1$/.test(arg),
      ),
    ).toBe(true);
    for (const arg of pushArgs) {
      expect(arg).not.toMatch(/^(refs\/heads\/)?main$|:(refs\/heads\/)?main$/);
    }
  });

  it("HEAD on main (the branch switch did not happen): rejects, nothing is pushed to main", async () => {
    seed(1);
    sh("checkout", "-q", "main");
    const { exec, calls } = spyExec();
    const advance = createCiAdvance({
      runBackend: commitBackend(),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const error = await advance({ ...ctxAfter(1), branch: "main" }).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/main/);
    expect(error?.message).not.toContain(TOKEN);
    expect(pushCount(calls)).toBe(0);
  });

  it("an authorised /accord unblock <task> <reason> reaches the backend before the resume run", async () => {
    seed(1);
    const backendCalls: BackendCall[] = [];
    const { exec } = spyExec();
    const advance = createCiAdvance({
      runBackend: commitBackend({ calls: backendCalls }),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const gates = {
      ...NO_GATES,
      unblock_requested: true,
      unblock: { task: 3, reason: "fixture was flaky" },
    };
    await advance({ ...ctxAfter(1), gates });
    expect(backendCalls.map((call) => call.phase)).toEqual(["unblock", "resume"]);
    expect(backendCalls[0]?.ticket).toBe(ID);
    const unblockArgs = (backendCalls[0]?.extraArgs ?? []).join(" ");
    expect(unblockArgs).toMatch(/task/);
    expect(unblockArgs).toMatch(/(^|\D)3(\D|$)/);
    expect(unblockArgs).toContain("fixture was flaky");
  });

  it("a bare /accord unblock (no task) runs resume only", async () => {
    seed(1);
    const backendCalls: BackendCall[] = [];
    const { exec } = spyExec();
    const advance = createCiAdvance({
      runBackend: commitBackend({ calls: backendCalls }),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    await advance({ ...ctxAfter(1), gates: { ...NO_GATES, unblock_requested: true } });
    expect(backendCalls.map((call) => call.phase)).toEqual(["resume"]);
  });

  it("returns the work item's running cost_usd, not only this step's cost", async () => {
    seed(1);
    write(".tasks/ASDLC-1.json", JSON.stringify({ id: ID, phase: "implementing", cost_usd: 3 }));
    const { exec } = spyExec();
    const advance = createCiAdvance({
      runBackend: commitBackend(), // writes no cost: the total stays 3
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    expect(await advance(ctxAfter(1))).toEqual({
      done: false,
      ref: REFS[1] as string,
      cost_usd: 3,
    });
  });

  const blockedBackend: PhaseRunBackend = async () => ({
    exitCode: 0,
    lastRun: {
      stopReason: "spawned_subagent",
      lastSpawn: { agent: "phase-code", exitCode: 0, parsedReturn: { status: "blocked" } },
    } as never,
  });
  const stuckBackend: PhaseRunBackend = async () => ({ exitCode: 0, stalledReason: "stuck" });
  const pushCount = (calls: ExecCall[]) =>
    calls.filter((call) => call.args.includes("push")).length;

  it("backend reports a blocked task and makes no commit: gate_failed naming block, nothing pushed", async () => {
    seed(1);
    const { exec, calls } = spyExec();
    const advance = createCiAdvance({
      runBackend: blockedBackend,
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const result = await advance(ctxAfter(1));
    expect(result).toEqual({ done: false, gate_failed: expect.stringMatching(/block/i) });
    expect(pushCount(calls)).toBe(0);
  });

  it("backend stalls as stuck and makes no commit: gate_failed with a reason, nothing pushed", async () => {
    seed(1);
    const { exec, calls } = spyExec();
    const advance = createCiAdvance({
      runBackend: stuckBackend,
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const result = await advance(ctxAfter(1));
    expect(result).toEqual({ done: false, gate_failed: expect.stringMatching(/\S/) });
    expect(pushCount(calls)).toBe(0);
  });

  it("backend exits non-zero with no commit: rejects without leaking the token, nothing pushed", async () => {
    seed(1);
    const { exec, calls } = spyExec();
    const advance = createCiAdvance({
      runBackend: async () => ({ exitCode: 1 }),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const error = await advance(ctxAfter(1)).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain(TOKEN);
    expect(pushCount(calls)).toBe(0);
  });

  it("runResume wired to the real advance with a blocked backend: gate_failed, one alert, one PR comment", async () => {
    fixture();
    const h = harness();
    const base = baseOpts(h, async () => ({ done: true }));
    const real = createCiAdvance({
      runBackend: blockedBackend,
      exec: base.exec,
      env: base.env,
    });
    const result = await runResume({ ...base, advance: real });
    expect(result).toEqual({ status: "gate_failed", gate: expect.stringMatching(/block/i) });
    expect(h.logs.error).toHaveLength(1);
    expect(h.logs.error[0]).toMatch(/^stack\.ci\.alert work_item_id=ASDLC-1 condition=/);
    const comments = h.execCalls.filter(
      (call) => call.cmd === "gh" && call.args[0] === "pr" && call.args[1] === "comment",
    );
    expect(comments).toHaveLength(1);
    expect(h.execCalls.filter((call) => call.args.includes("push"))).toEqual([]);
  });

  it("no new typed commit: done, nothing pushed, history untouched", async () => {
    seed(REFS.length);
    const head = sh("rev-parse", "HEAD");
    const { exec, calls } = spyExec();
    const advance = createCiAdvance({
      runBackend: commitBackend(),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    expect(await advance(ctxAfter(REFS.length))).toEqual({ done: true });
    expect(calls.filter((call) => call.args.includes("push"))).toEqual([]);
    expect(sh("rev-parse", "HEAD")).toBe(head);
  });

  it("a rejected push is an error, never swallowed, and never retried with force", async () => {
    seed(1);
    const { exec, calls } = spyExec(1);
    const advance = createCiAdvance({
      runBackend: commitBackend(),
      exec,
      env: { ACCORD_CI_PUSH_TOKEN: TOKEN },
    });
    const error = await advance(ctxAfter(1)).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/push/i);
    expect(error?.message).not.toContain(TOKEN);
    expect(error?.message).not.toContain(TOKEN_B64);
    const pushes = calls.filter((call) => call.args.includes("push"));
    expect(pushes.length).toBeGreaterThan(0);
    for (const push of pushes) for (const arg of push.args) expect(arg).not.toMatch(FORCE_ARG);
  });
});

describe("ASDLC-1/AC-24 + ASDLC-1/AC-27 rerun from a fresh clone resumes from the pushed typed commit", () => {
  it.each(REFS.map((ref, index) => [index, ref] as const))(
    "interrupted after %i (%s) with commits pushed to the task branch: a fresh clone resumes from it; main is never pushed",
    async (index, ref) => {
      fixture({ plan: true, lock: true });
      const origin = withOrigin();
      const mainOnOrigin = gitIn(origin, "rev-parse", "main");
      const env = { ACCORD_CI_PUSH_TOKEN: TOKEN };

      // run 1 (clone A = repo, starts on main): the resume switches to the task branch, then
      // pushes every typed commit it makes there, and is interrupted
      const real = createCiAdvance({ runBackend: commitBackend(), exec: realExec, env });
      const first = harness();
      await expect(
        runResume({
          ...baseOpts(first, async (ctx) => {
            const result = await real(ctx);
            if (!result.done && "ref" in result && result.ref === ref) {
              throw new Error(`interrupted after ${ref}`);
            }
            return result;
          }),
          prNumber: undefined,
        }),
      ).rejects.toThrow(`interrupted after ${ref}`);
      expect(first.contexts[0]?.branch).toBe(BRANCH);
      expect(typedRefsIn(origin, BRANCH)).toEqual(REFS.slice(0, index + 1));
      expect(gitIn(origin, "rev-parse", "main")).toBe(mainOnOrigin);
      const afterInterrupt = gitIn(origin, "rev-list", "--reverse", BRANCH).split("\n");

      // run 2 (clone B): fresh checkout of main (the push-to-main trigger), nothing carried over
      const cloneB = join(sandbox, "clone-b");
      execFileSync("git", ["clone", "-q", "-b", "main", origin, cloneB]);
      gitIn(cloneB, "config", "user.email", "t@example.com");
      gitIn(cloneB, "config", "user.name", "t");
      gitIn(cloneB, "config", "commit.gpgsign", "false");
      expect(existsSync(join(cloneB, ".tasks"))).toBe(false);
      const second = harness();
      const advanceB = createCiAdvance({ runBackend: commitBackend(), exec: realExec, env });
      const result = await runResume({
        ...baseOpts(second, advanceB),
        repoRoot: cloneB,
        prNumber: undefined,
      });

      expect(result).toEqual({ status: "completed", lastRef: REFS.at(-1) as string });
      expect(second.contexts[0]).toMatchObject({
        lastRef: ref,
        lastSeq: index + 1,
        workItemId: ID,
        repoRoot: cloneB,
        branch: BRANCH,
      });
      expect(typedRefsIn(origin, BRANCH)).toEqual(REFS);
      const originFinal = gitIn(origin, "rev-list", "--reverse", BRANCH).split("\n");
      expect(originFinal.slice(0, afterInterrupt.length)).toEqual(afterInterrupt);
      expect(originFinal.length).toBe(afterInterrupt.length + (REFS.length - index - 1));
      // ASDLC-1/AC-27 + F-016: trunk is untouched by both runs
      expect(gitIn(origin, "rev-parse", "main")).toBe(mainOnOrigin);
      expect(readdirSync(lockDir)).toEqual([]);
    },
  );
});

// ── cost cap + gate failure + alert (ASDLC-1/AC-24) ──────────────────────────

describe("ASDLC-1/AC-24 cost cap (stack.ci.cost_cap_usd)", () => {
  const capped = { enabled: true, ci: { cost_cap_usd: 5 } };

  it("cost above the cap stops the run, logs stack.ci.alert at error, posts one PR comment", async () => {
    fixture({ stack: capped });
    const h = harness();
    const result = await runResume(baseOpts(h, stepper(null, 5.01)));
    expect(result).toEqual({ status: "cost_capped" });
    expect(h.contexts).toHaveLength(1); // stopped after the first step
    expect(typedRefs()).toEqual([REFS[0] as string]);
    expect(h.logs.error).toHaveLength(1);
    expect(h.logs.error[0]).toMatch(/^stack\.ci\.alert work_item_id=ASDLC-1 condition=\S*cost\S*/);
    for (const level of ["debug", "info", "warn"] as const) expect(h.logs[level]).toEqual([]);
    expect(h.execCalls).toHaveLength(1);
    const call = h.execCalls[0];
    expect(call?.cmd).toBe("gh");
    expect(call?.args.slice(0, 2)).toEqual(["pr", "comment"]);
    expect(call?.args).toContain("42");
    expect(call?.args.join("\n")).toContain(ID);
    expect(call?.env?.GH_TOKEN).toBe(TOKEN);
  });

  it("cost equal to the cap trips (checkCostCap uses >=)", async () => {
    fixture({ stack: capped });
    const h = harness();
    expect(await runResume(baseOpts(h, stepper(null, 5)))).toEqual({ status: "cost_capped" });
    expect(h.execCalls).toHaveLength(1);
  });

  it("cost below the cap continues to completion with no alert", async () => {
    fixture({ stack: capped });
    const h = harness();
    const result = await runResume(baseOpts(h, stepper(null, 4.99)));
    expect(result).toEqual({ status: "completed", lastRef: REFS.at(-1) as string });
    expect(h.logs.error).toEqual([]);
    expect(h.execCalls).toEqual([]);
  });

  it("cap is the sum reported by advance, not the per-step cost: cumulative figure trips", async () => {
    fixture({ stack: capped });
    const h = harness();
    let cumulative = 0;
    const result = await runResume(
      baseOpts(h, async (ctx) => {
        const step = await stepper(null)(ctx);
        if (step.done) return step;
        cumulative += 2;
        return { done: false, ref: (step as { ref: string }).ref, cost_usd: cumulative };
      }),
    );
    expect(result).toEqual({ status: "cost_capped" });
    expect(typedRefs()).toEqual(REFS.slice(0, 3)); // 2, 4, 6 >= 5 → stops after third step
  });

  it.each([
    ["unset", { enabled: true }],
    ["ci block without cap", { enabled: true, ci: {} }],
  ])("cap %s means no cap even at very high cost", async (_label, stack) => {
    fixture({ stack });
    const h = harness();
    const result = await runResume(baseOpts(h, stepper(null, 1_000_000)));
    expect(result.status).toBe("completed");
    expect(h.logs.error).toEqual([]);
    expect(h.execCalls).toEqual([]);
  });

  it("the cap-stopped run released its lock so a later run can resume", async () => {
    fixture({ stack: capped });
    await runResume(baseOpts(harness(), stepper(null, 6)));
    const lock = acquireResumeLock({ workItemId: ID, lockDir });
    expect(lock.acquired).toBe(true);
    if (lock.acquired) lock.release();
  });

  it.each([6, 5])(
    "work item already at cost_usd %p (cap 5): stops before any phase runs, one alert, lock released",
    async (cost) => {
      fixture({ stack: capped, cost });
      const h = harness();
      const result = await runResume(baseOpts(h, stepper(null, 0)));
      expect(result).toEqual({ status: "cost_capped" });
      expect(h.contexts).toEqual([]);
      expect(typedRefs()).toEqual([]);
      expect(h.logs.error).toHaveLength(1);
      expect(h.logs.error[0]).toMatch(/^stack\.ci\.alert work_item_id=ASDLC-1 condition=\S*cost/);
      expect(h.execCalls).toHaveLength(1);
      expect(h.execCalls[0]?.cmd).toBe("gh");
      expect(h.execCalls[0]?.args.slice(0, 3)).toEqual(["pr", "comment", "42"]);
      expect(readdirSync(lockDir)).toEqual([]);
    },
  );

  it("work item below the cap (cost_usd 4, cap 5) still runs phases", async () => {
    fixture({ stack: capped, cost: 4 });
    const h = harness();
    const result = await runResume(baseOpts(h, stepper(null, 4)));
    expect(h.contexts.length).toBeGreaterThan(0);
    expect(result).toEqual({ status: "completed", lastRef: REFS.at(-1) as string });
    expect(h.logs.error).toEqual([]);
    expect(h.execCalls).toEqual([]);
  });

  it("alert delivery failure is not swallowed: runResume rejects, lock released, one alert logged", async () => {
    fixture({ stack: capped });
    const h = harness();
    const failing = {
      ...baseOpts(h, stepper(null, 9)),
      exec: async () => ({ exitCode: 1, stdout: "", stderr: "HTTP 401: Bad credentials" }),
    };
    await expect(runResume(failing)).rejects.toThrow(/comment/i);
    expect(h.logs.error).toHaveLength(1);
    expect(readdirSync(lockDir)).toEqual([]);
  });

  it("dry run logs the alert but posts no PR comment", async () => {
    fixture({ stack: capped });
    const h = harness();
    const result = await runResume({ ...baseOpts(h, stepper(null, 9)), dryRun: true });
    expect(result).toEqual({ status: "cost_capped" });
    expect(h.logs.error).toHaveLength(1);
    expect(h.execCalls).toEqual([]);
  });
});

describe("ASDLC-1/AC-24 a failed gate raises the same alert", () => {
  it("gate_failed from a step stops the run with the same event and one PR comment", async () => {
    fixture();
    const h = harness();
    const result = await runResume(
      baseOpts(h, async (ctx) => {
        if (ctx.lastRef === null) {
          typedCommit(1, REFS[0] as string);
          return { done: false, ref: REFS[0] as string, cost_usd: 0 };
        }
        return { done: false, gate_failed: "verify" };
      }),
    );
    expect(result).toEqual({ status: "gate_failed", gate: "verify" });
    expect(h.contexts).toHaveLength(2);
    expect(h.logs.error).toHaveLength(1);
    expect(h.logs.error[0]).toMatch(/^stack\.ci\.alert work_item_id=ASDLC-1 condition=\S*gate\S*/);
    expect(h.logs.error[0]).toContain("verify");
    expect(h.execCalls).toHaveLength(1);
    expect(h.execCalls[0]?.cmd).toBe("gh");
    expect(h.execCalls[0]?.args.slice(0, 2)).toEqual(["pr", "comment"]);
    expect(h.execCalls[0]?.args).toContain("42");
    expect(readdirSync(lockDir)).toEqual([]);
  });

  it("cost-cap and gate-failure conditions differ", async () => {
    fixture({ stack: { enabled: true, ci: { cost_cap_usd: 1 } } });
    const costRun = harness();
    await runResume(baseOpts(costRun, stepper(null, 2)));
    rmSync(join(repo, ".tasks"), { recursive: true, force: true });
    const gateRun = harness();
    await runResume(baseOpts(gateRun, async () => ({ done: false, gate_failed: "closeout" })));
    expect(costRun.logs.error[0]).not.toBe(gateRun.logs.error[0]);
  });
});

// ── raiseAlert (ASDLC-1/AC-24) ───────────────────────────────────────────────

describe("ASDLC-1/AC-24 raiseAlert: stack.ci.alert plus PR comment via the push token", () => {
  function alertOpts(h: Harness, env: Record<string, string | undefined>) {
    const base = baseOpts(h, stepper(null));
    return {
      workItemId: ID,
      condition: "cost_cap_exceeded",
      prNumber: 42,
      env,
      exec: base.exec,
      logger: base.logger,
    };
  }

  it("logs exactly one error line with work_item_id and condition and posts one gh pr comment", async () => {
    const h = harness();
    await raiseAlert(alertOpts(h, { ACCORD_CI_PUSH_TOKEN: TOKEN }));
    expect(h.logs.error).toEqual([
      "stack.ci.alert work_item_id=ASDLC-1 condition=cost_cap_exceeded",
    ]);
    expect(h.execCalls).toHaveLength(1);
    const call = h.execCalls[0];
    expect(call?.cmd).toBe("gh");
    expect(call?.args.slice(0, 3)).toEqual(["pr", "comment", "42"]);
    const body = call?.args.join("\n") ?? "";
    expect(body).toContain(ID);
    expect(body).toContain("cost_cap_exceeded");
    expect(call?.env?.GH_TOKEN).toBe(TOKEN);
  });

  it("never puts the token in args, log lines or the comment body", async () => {
    const h = harness();
    await raiseAlert(alertOpts(h, { ACCORD_CI_PUSH_TOKEN: TOKEN }));
    const everything = JSON.stringify([h.execCalls.map((c) => c.args), h.logs]);
    expect(everything).not.toContain(TOKEN);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("token %s: throws MISSING_REQUIRED_SECRET and posts nothing", async (_label, value) => {
    const h = harness();
    const promise = raiseAlert(alertOpts(h, { ACCORD_CI_PUSH_TOKEN: value }));
    await expect(promise).rejects.toThrow("MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN");
    await expect(
      raiseAlert(alertOpts(harness(), { ACCORD_CI_PUSH_TOKEN: value })),
    ).rejects.toBeInstanceOf(MissingSecretError);
    expect(h.execCalls).toEqual([]);
  });

  it("gh failure (HTTP 401) rejects with a comment error that leaks no token; the alert is still logged once", async () => {
    const h = harness();
    const failing = {
      ...alertOpts(h, { ACCORD_CI_PUSH_TOKEN: TOKEN }),
      exec: async () => ({ exitCode: 1, stdout: "", stderr: "HTTP 401: Bad credentials" }),
    };
    const error = await raiseAlert(failing).then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toMatch(/comment/i);
    expect(error?.message).not.toContain(TOKEN);
    expect(h.logs.error).toEqual([
      "stack.ci.alert work_item_id=ASDLC-1 condition=cost_cap_exceeded",
    ]);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "prNumber %s (no work item PR found): logs the alert once, posts nothing, resolves",
    async (_label, prNumber) => {
      const h = harness();
      await raiseAlert({ ...alertOpts(h, { ACCORD_CI_PUSH_TOKEN: TOKEN }), prNumber });
      expect(h.logs.error).toEqual([
        "stack.ci.alert work_item_id=ASDLC-1 condition=cost_cap_exceeded",
      ]);
      expect(h.execCalls).toEqual([]);
    },
  );

  it("dry run logs the alert and posts nothing, even without a token", async () => {
    const h = harness();
    await raiseAlert({ ...alertOpts(h, {}), dryRun: true });
    expect(h.logs.error).toEqual([
      "stack.ci.alert work_item_id=ASDLC-1 condition=cost_cap_exceeded",
    ]);
    expect(h.execCalls).toEqual([]);
  });
});

// ── workflow (ASDLC-1/AC-24) ─────────────────────────────────────────────────

type Step = {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = {
  steps: Step[];
  concurrency?: unknown;
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
};
type Workflow = {
  on: {
    push?: { branches?: string[]; paths?: string[] };
    issue_comment?: { types?: string[] };
    pull_request?: unknown;
    pull_request_target?: unknown;
  };
  concurrency?: unknown;
  jobs: Record<string, Job>;
};
const workflowPath = join(ROOT, ".github/workflows/accord-driven.yml");
const workflowText = () => readFileSync(workflowPath, "utf8");
const workflowDoc = () => parseYaml(workflowText()) as Workflow;
const GATE_JOB = "resume-gate";
const gateJob = (): Job => workflowDoc().jobs[GATE_JOB] as Job;
const resumeJob = (): Job => workflowDoc().jobs.resume as Job;
const RESUME_RUN = /bun packages\/accord-ci\/src\/ci-driven\/resume\.ts/;
const gateStep = (): Step | undefined =>
  gateJob()?.steps.find((step) => typeof step.run === "string");
/** Step-output key the gate job exposes as `outputs.<name>` (`${{ steps.<gate>.outputs.<key> }}`). */
function gateOutputKey(name: string): string {
  const expression = gateJob()?.outputs?.[name] ?? "";
  return (
    new RegExp(
      `^\\$\\{\\{\\s*steps\\.${gateStep()?.id}\\.outputs\\.([A-Za-z0-9_-]+)\\s*\\}\\}$`,
    ).exec(expression)?.[1] ?? ""
  );
}

/** Substitute workflow expressions the way the Actions runtime would for a given fixture. */
function materializeExpressions(
  text: string,
  ref: string,
  extra: Record<string, string> = {},
): string {
  return text.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_match, expr: string) => {
    for (const [needle, value] of Object.entries(extra)) if (expr.includes(needle)) return value;
    if (/github\.ref(_name)?\b/.test(expr)) return ref;
    if (/event\.issue\.number/.test(expr)) return "42";
    return "main";
  });
}
function materializeEnv(
  step: Step | undefined,
  ref: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(step?.env ?? {}).map(([key, value]) => [
      key,
      materializeExpressions(String(value), ref, extra),
    ]),
  );
}
const inRoot = (script: string): string =>
  script.replaceAll("packages/accord-ci/", `${ROOT}/packages/accord-ci/`);

describe("ASDLC-1/AC-24 accord-driven workflow: post-PR0 triggers", () => {
  it("keeps the PR0 job and adds a gate job plus a resume job", () => {
    const jobs = workflowDoc().jobs;
    expect(Object.keys(jobs)).toEqual(expect.arrayContaining(["pr0", GATE_JOB, "resume"]));
  });

  it("triggers: push on accord/*/** and main, issue_comment created; never pull_request(_target)", () => {
    const on = workflowDoc().on;
    expect(on.push?.branches).toEqual(expect.arrayContaining(["accord/*/**", "main"]));
    // a paths filter on push would also filter the PR0 trigger; the gate script filters instead
    expect(on.push?.paths).toBeUndefined();
    expect(on.issue_comment?.types).toEqual(["created"]);
    expect(on.pull_request).toBeUndefined();
    expect(on.pull_request_target).toBeUndefined();
  });

  // Job-level and workflow-level concurrency cannot read step outputs, so the <ID> comes from a
  // separate gate job's outputs. Only a workflow concurrency group serialises runs across runners
  // (the on-disk lock lives on one runner), so this is the real per-<ID> lock.
  it("gate job outputs run, work_item_id and ref from its gate step", () => {
    expect(gateStep()?.id).toBeTruthy();
    expect(gateOutputKey("run")).not.toBe("");
    expect(gateOutputKey("work_item_id")).not.toBe("");
    expect(gateOutputKey("ref")).not.toBe("");
    // F-016: the PR number of a comment trigger is a gate output too
    expect(gateOutputKey("pr")).not.toBe("");
  });

  it("resume job needs the gate job, runs only when it said run, and has concurrency group accord-<ID> with cancel-in-progress false", () => {
    const job = resumeJob();
    expect([job.needs].flat()).toContain(GATE_JOB);
    expect(job.if ?? "").toMatch(/needs\.resume-gate\.outputs\.run == 'true'/);
    expect(job.concurrency).toEqual({
      group: "accord-${{ needs.resume-gate.outputs.work_item_id }}",
      "cancel-in-progress": false,
    });
    // no workflow-level group could stand in for it (it would serialise unrelated work items)
    expect(workflowDoc().concurrency).toBeUndefined();
  });

  it("resume job checks out the ref the gate chose (the PR branch for a comment trigger)", () => {
    const checkout = resumeJob().steps.find((step) => step.uses?.startsWith("actions/checkout"));
    expect(String(checkout?.with?.ref ?? "")).toMatch(
      /needs\.resume-gate\.outputs\.[A-Za-z0-9_-]+/,
    );
  });

  it.each([GATE_JOB, "resume"])(
    "%s job: checkout keeps no GITHUB_TOKEN and has full history",
    (name) => {
      const steps = workflowDoc().jobs[name]?.steps ?? [];
      const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout"));
      expect(checkout?.with?.["persist-credentials"]).toBe(false);
      expect(checkout?.with?.["fetch-depth"]).toBe(0);
    },
  );

  it("gate job: the first run step is the gate, only `uses` steps precede it, and it reads stack.enabled", () => {
    const steps = gateJob()?.steps ?? [];
    const firstRunIndex = steps.findIndex((step) => typeof step.run === "string");
    expect(firstRunIndex).toBeGreaterThan(0);
    for (const step of steps.slice(0, firstRunIndex)) expect(step.uses).toBeTruthy();
    expect(steps[firstRunIndex]?.id).toBeTruthy();
    expect(steps[firstRunIndex]?.run).toContain("enabled");
    // the gate never touches the push token
    for (const step of steps) {
      expect(JSON.stringify(step)).not.toContain("ACCORD_CI_PUSH_TOKEN");
    }
  });

  it("resume step wiring: id from the gate output, a PR-number source, and a git identity step before it", () => {
    const steps = resumeJob().steps;
    const resumeIndex = steps.findIndex((step) => RESUME_RUN.test(step.run ?? ""));
    expect(resumeIndex).toBeGreaterThan(-1);
    const envValues = Object.values(steps[resumeIndex]?.env ?? {}).map(String);
    expect(envValues.some((value) => /needs\.resume-gate\.outputs\.work_item_id/.test(value))).toBe(
      true,
    );
    // F-016: the PR number comes from the gate output only (event.issue.number is empty on push)
    expect(envValues.some((value) => /needs\.resume-gate\.outputs\.pr\b/.test(value))).toBe(true);
    expect(envValues.some((value) => /event\.issue\.number/.test(value))).toBe(false);
    const identity = (pattern: RegExp) =>
      steps.findIndex((step, index) => index < resumeIndex && pattern.test(step.run ?? ""));
    // F-022: workspace imports need Bun and installed deps before the resume step
    expect(
      steps.findIndex(
        (step, index) => index < resumeIndex && /^oven-sh\/setup-bun/.test(step.uses ?? ""),
      ),
    ).toBeGreaterThan(-1);
    expect(
      steps.findIndex(
        (step, index) =>
          index < resumeIndex && /bun install --frozen-lockfile/.test(step.run ?? ""),
      ),
    ).toBeGreaterThan(-1);
    expect(identity(/git config (--global )?user\.name/)).toBeGreaterThan(-1);
    expect(identity(/git config (--global )?user\.email/)).toBeGreaterThan(-1);
  });

  it("resume step runs resume.ts with the push token only via secrets env; no step echoes it", () => {
    const steps = resumeJob().steps;
    const resumeStep = steps.find((step) => RESUME_RUN.test(step.run ?? ""));
    expect(resumeStep?.env?.ACCORD_CI_PUSH_TOKEN).toBe("${{ secrets.ACCORD_CI_PUSH_TOKEN }}");
    for (const step of [...steps, ...gateJob().steps]) {
      expect(step.run ?? "").not.toContain("ACCORD_CI_PUSH_TOKEN");
      expect(step.run ?? "").not.toMatch(/secrets\./);
    }
    const lines = workflowText()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("ACCORD_CI_PUSH_TOKEN") && !line.startsWith("#"));
    for (const line of lines) {
      expect(line).toMatch(/^ACCORD_CI_PUSH_TOKEN: \$\{\{ secrets\.ACCORD_CI_PUSH_TOKEN \}\}$/);
    }
  });

  it("F-020: the gate step reads PRs with github.token (not the push token); pull-requests read is granted", () => {
    expect(gateStep()?.env?.GH_TOKEN).toMatch(/^\$\{\{\s*github\.token\s*\}\}$/);
    const doc = workflowDoc() as Workflow & { permissions?: Record<string, string> };
    const jobPerms = (gateJob() as Job & { permissions?: Record<string, string> }).permissions;
    const granted = { ...(doc.permissions ?? {}), ...(jobPerms ?? {}) };
    expect(["read", "write"]).toContain(granted["pull-requests"]);
  });

  it("append-only: no force push, amend or history rewrite in workflow or resume sources", () => {
    const texts = [
      workflowText(),
      readFileSync(join(ROOT, "packages/accord-ci/src/ci-driven/resume.ts"), "utf8"),
      readFileSync(join(ROOT, "packages/accord-ci/src/ci-driven/alert.ts"), "utf8"),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(
        /--force|--amend|push\s+(-\w*f\b|--force)|git\s+reset\s+--(hard|soft)|\+HEAD:|["']-f["']|["']\+refs\/|["']\+HEAD|--mirror/,
      );
      expect(text).not.toMatch(/rebase\b.*(-i|--interactive)|filter-branch/);
    }
  });

  it("no ci-driven source or the workflow prints the push token", () => {
    const dir = join(ROOT, "packages/accord-ci/src/ci-driven");
    const files = readdirSync(dir).map((name) => join(dir, name));
    files.push(workflowPath);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/console\.(log|error|warn).*PUSH_TOKEN/);
      expect(text).not.toMatch(/echo .*ACCORD_CI_PUSH_TOKEN/);
    }
  });

  describe("gate script (first run step of the gate job) executed as a dry run", () => {
    type RunOpts = {
      event: "push" | "issue_comment";
      payload: unknown;
      ref: string;
      /** What the fake `gh` answers for the PR head branch (comment trigger). */
      ghBranch?: string;
    };
    function runGate(opts: RunOpts): { exitCode: number; output: string; ghLog: string } {
      // guard: a missing gate job must fail every case, not pass the negative ones vacuously
      expect(gateStep()?.run).toBeTruthy();
      expect(gateOutputKey("run")).not.toBe("");
      const outFile = join(sandbox, "gate-output");
      const eventFile = join(sandbox, "event.json");
      const ghLogFile = join(sandbox, "gh.log");
      const binDir = join(sandbox, "bin");
      writeFileSync(outFile, "");
      writeFileSync(ghLogFile, "");
      writeFileSync(eventFile, JSON.stringify(opts.payload));
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        join(binDir, "gh"),
        [
          "#!/bin/sh",
          'printf \'%s\\n\' "$*" >> "$FAKE_GH_LOG"',
          // F-020: like real gh in Actions, refuse to run without GH_TOKEN
          '[ -n "$GH_TOKEN" ] || { echo "gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable." >&2; exit 4; }',
          'case "$*" in',
          '  *--jq*|*" -q "*) printf \'%s\\n\' "$FAKE_GH_BRANCH" ;;',
          '  *) printf \'{"headRefName":"%s","head":{"ref":"%s"}}\\n\' "$FAKE_GH_BRANCH" "$FAKE_GH_BRANCH" ;;',
          "esac",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const step = gateStep();
      const proc = Bun.spawnSync(
        ["bash", "-e", "-c", inRoot(materializeExpressions(step?.run ?? "", opts.ref))],
        {
          cwd: repo,
          env: {
            // the step's own env: block, expressions materialised; no PR branch is injected by hand
            ...materializeEnv(step, opts.ref),
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
            HOME: process.env.HOME ?? "",
            GITHUB_EVENT_NAME: opts.event,
            GITHUB_EVENT_PATH: eventFile,
            GITHUB_REF_NAME: opts.ref,
            GITHUB_OUTPUT: outFile,
            GITHUB_WORKSPACE: repo,
            FAKE_GH_LOG: ghLogFile,
            FAKE_GH_BRANCH: opts.ghBranch ?? "",
            CI: "true",
          },
        },
      );
      return {
        exitCode: proc.exitCode,
        output: readFileSync(outFile, "utf8"),
        ghLog: readFileSync(ghLogFile, "utf8"),
      };
    }
    const lines = (output: string) => output.split("\n");
    function pushPayload(files: Record<string, string>): { before: string; after: string } {
      const before = sh("rev-parse", "HEAD");
      for (const [rel, content] of Object.entries(files)) write(rel, content);
      commitAll("push");
      return { before, after: sh("rev-parse", "HEAD") };
    }
    const commentPayload = (body: string, assoc: string) => ({
      comment: { body, author_association: assoc },
      issue: { number: 42, pull_request: { url: "https://example.invalid/pr/42" } },
    });
    const LOCK = `docs/dev/${ID}/contract.lock.json`;

    it("push to main touching the lock file: run=true and work_item_id only; no ref=main, no PR number", () => {
      fixture();
      const payload = pushPayload({ [LOCK]: "{}\n" });
      const head = sh("rev-parse", "HEAD");
      const { exitCode, output } = runGate({ event: "push", payload, ref: "main" });
      expect(exitCode).toBe(0);
      expect(gateOutputKey("run")).not.toBe("");
      expect(lines(output)).toContain(`${gateOutputKey("run")}=true`);
      expect(lines(output)).toContain(`${gateOutputKey("work_item_id")}=${ID}`);
      // F-016: resume derives the stack branch itself; the job must not be pinned to main
      const nonEmpty = (key: string) =>
        lines(output).filter(
          (line) => line.startsWith(`${gateOutputKey(key)}=`) && line.length > key.length + 1,
        );
      expect(nonEmpty("ref")).toEqual([]);
      expect(nonEmpty("pr")).toEqual([]);
      expect(sh("rev-parse", "HEAD")).toBe(head);
    });

    it.each([
      ["accord/ASDLC-1/x", "PR0 branch before PR0 merges"],
      ["feature/x", "an unrelated branch"],
    ])("push of the lock file to %p (%s) ends green without running", (ref) => {
      fixture();
      const payload = pushPayload({ [LOCK]: "{}\n" });
      const { exitCode, output } = runGate({ event: "push", payload, ref });
      expect(exitCode).toBe(0);
      expect(lines(output)).not.toContain(`${gateOutputKey("run")}=true`);
    });

    it.each([
      ["approve", "/accord approve"],
      ["unblock", "/accord unblock"],
    ])(
      "authorised /accord %s comment: the PR head branch is resolved via gh from the issue number; run=true",
      (_label, body) => {
        fixture();
        const { exitCode, output, ghLog } = runGate({
          event: "issue_comment",
          payload: commentPayload(body, "COLLABORATOR"),
          ref: "main",
          ghBranch: `accord/${ID}/x`,
        });
        expect(exitCode).toBe(0);
        expect(ghLog).toContain("42");
        expect(lines(output)).toContain(`${gateOutputKey("run")}=true`);
        expect(lines(output)).toContain(`${gateOutputKey("work_item_id")}=${ID}`);
        expect(lines(output)).toContain(`${gateOutputKey("ref")}=accord/${ID}/x`);
        expect(lines(output)).toContain(`${gateOutputKey("pr")}=42`);
      },
    );

    it.each([`stack/${ID}/pr-1`, `stack/${ID}/closeout`])(
      "authorised comment on stack PR branch %p: run=true, ref is that branch, pr=42",
      (branch) => {
        fixture();
        const { exitCode, output } = runGate({
          event: "issue_comment",
          payload: commentPayload("/accord unblock 2 retry", "OWNER"),
          ref: "main",
          ghBranch: branch,
        });
        expect(exitCode).toBe(0);
        expect(lines(output)).toContain(`${gateOutputKey("run")}=true`);
        expect(lines(output)).toContain(`${gateOutputKey("work_item_id")}=${ID}`);
        expect(lines(output)).toContain(`${gateOutputKey("ref")}=${branch}`);
        expect(lines(output)).toContain(`${gateOutputKey("pr")}=42`);
      },
    );

    it("comment on a PR whose head branch is not accord/<ID>/<x> ends green without running", () => {
      fixture();
      const { exitCode, output, ghLog } = runGate({
        event: "issue_comment",
        payload: commentPayload("/accord approve", "OWNER"),
        ref: "main",
        ghBranch: "feature/x",
      });
      expect(exitCode).toBe(0);
      expect(ghLog).toContain("42");
      expect(lines(output)).not.toContain(`${gateOutputKey("run")}=true`);
    });

    it.each([
      ["stack.enabled false", { enabled: false }, true],
      ["stack key absent", "absent", true],
      ["no committed state", { enabled: true }, false],
    ])("%s: push trigger ends green without running", (_label, stack, withState) => {
      fixture({ stack, state: withState });
      const payload = pushPayload({ [LOCK]: "{}\n" });
      const { exitCode, output } = runGate({ event: "push", payload, ref: "main" });
      expect(exitCode).toBe(0);
      expect(lines(output)).not.toContain(`${gateOutputKey("run")}=true`);
    });

    it.each([
      ["stack.enabled false", { enabled: false }, true, "OWNER", "/accord approve"],
      ["stack key absent", "absent", true, "OWNER", "/accord unblock"],
      ["no committed state", { enabled: true }, false, "OWNER", "/accord approve"],
      ["unauthorised author", { enabled: true }, true, "NONE", "/accord approve"],
      ["not a gate command", { enabled: true }, true, "OWNER", "/accord approved"],
    ])(
      "%s: comment trigger ends green without running",
      (_label, stack, withState, assoc, body) => {
        fixture({ stack, state: withState });
        const { exitCode, output } = runGate({
          event: "issue_comment",
          payload: commentPayload(body, assoc),
          ref: "main",
          ghBranch: `accord/${ID}/x`,
        });
        expect(exitCode).toBe(0);
        expect(lines(output)).not.toContain(`${gateOutputKey("run")}=true`);
      },
    );

    it("push to main without a lock file ends green without running", () => {
      fixture();
      const payload = pushPayload({ "src/a.ts": "x\n" });
      const { exitCode, output } = runGate({ event: "push", payload, ref: "main" });
      expect(exitCode).toBe(0);
      expect(lines(output)).not.toContain(`${gateOutputKey("run")}=true`);
    });
  });

  describe("resume CLI entry (spawned as CI would, from the workflow's own command)", () => {
    const resumeStep = () => resumeJob().steps.find((step) => RESUME_RUN.test(step.run ?? ""));
    const gateValues = { "outputs.work_item_id": ID, "outputs.ref": "main", "outputs.pr": "42" };
    // push trigger: the gate gives no PR number; the resume CLI resolves the PR itself
    function runResumeStep(): { exitCode: number; stderr: string; output: string } {
      expect(resumeStep()?.run).toBeTruthy();
      const outFile = join(sandbox, "resume-output");
      writeFileSync(outFile, "");
      const step = resumeStep();
      const proc = Bun.spawnSync(
        ["bash", "-e", "-c", inRoot(materializeExpressions(step?.run ?? "", "main", gateValues))],
        {
          cwd: repo,
          env: {
            ...materializeEnv(step, "main", { "secrets.": "", ...gateValues }),
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? "",
            GITHUB_OUTPUT: outFile,
            GITHUB_WORKSPACE: repo,
            GITHUB_REF_NAME: "main",
            CI: "true",
          },
        },
      );
      return {
        exitCode: proc.exitCode,
        stderr: proc.stderr.toString(),
        output: readFileSync(outFile, "utf8"),
      };
    }

    it("stack disabled: exit 0, HEAD unchanged, GITHUB_OUTPUT status=skipped, no .tasks", () => {
      fixture({ stack: { enabled: false } });
      const before = sh("rev-parse", "HEAD");
      const result = runResumeStep();
      expect(result.exitCode).toBe(0);
      expect(sh("rev-parse", "HEAD")).toBe(before);
      expect(result.output.split("\n")).toContain("status=skipped");
      expect(existsSync(join(repo, ".tasks"))).toBe(false);
    });

    it("enabled with state but ACCORD_CI_PUSH_TOKEN missing: fails before any work", () => {
      fixture();
      const before = sh("rev-parse", "HEAD");
      const result = runResumeStep();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN");
      expect(sh("rev-parse", "HEAD")).toBe(before);
      expect(existsSync(join(repo, ".tasks"))).toBe(false);
    });
  });
});

// ── docs (ASDLC-1/AC-31) ─────────────────────────────────────────────────────

describe("ASDLC-1/AC-31 docs/ci/pre-merge-smoke.md covers resume mode", () => {
  const doc = () => readFileSync(join(ROOT, "docs/ci/pre-merge-smoke.md"), "utf8");

  it("names the sources, triggers, commands, lock, alert and this test", () => {
    const text = doc();
    for (const needle of [
      "packages/accord-ci/src/ci-driven/resume.ts",
      "packages/accord-ci/src/ci-driven/alert.ts",
      "contract.lock.json",
      "issue_comment",
      "/accord approve",
      "/accord unblock",
      "accord-<ID>",
      "cancel-in-progress",
      "stack.ci.alert",
      "stack.ci.cost_cap_usd",
      "bun test packages/accord-ci/tests/ci-driven-resume.test.ts",
    ]) {
      expect(text).toContain(needle);
    }
  });

  it("keeps the PR0 section and the token rule", () => {
    const text = doc();
    expect(text).toContain("packages/accord-ci/src/ci-driven/pr0.ts");
    expect(text).toContain("ACCORD_CI_PUSH_TOKEN");
  });
});
