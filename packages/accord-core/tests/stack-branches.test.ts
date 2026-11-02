import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { getCloseoutBranchHook, registerCloseoutBranchHook } from "../src/commit/hooks.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import {
  branchFor,
  ensureCloseoutBranch,
  ensureTaskBranch,
  type StackBranchResult,
} from "../src/stack/branches.js";
import type { StackPr, StackProvider } from "../src/stack/provider.js";
import { stackReport, stackShow, stackSync } from "../src/stack/service.js";
import { runSubagentToolPreflight } from "../src/subagent/preflight-runner.js";

// Pinned contract (spec leaves shapes open):
//  branchFor(id, n) -> "stack/<id>/pr-<n>"; branchFor(id, "closeout") -> "stack/<id>/closeout".
//  ensureTaskBranch(id, taskId, devConfig, { cwd? }) -> { ok:true, branch, base } | { ok:false, reason }.
//   The PR index of a task comes from computeStack over <cwd>/docs/dev/<id>/plan.json.
//   Branches are created only for the FIRST task of a PR group; later members of the group get
//   ok:true with the group's branch and no switch.
//   Base: PR0 unmerged (origin/main lacks docs/dev/<id>/contract.lock.json) -> the PR0 tip, which
//   in these fixtures is the commit tagged accord/<id>/contract; PR0 merged -> origin/main;
//   depends_on chain -> the parent PR's branch.
//   A dirty tracked tree -> { ok:false, reason } matching /uncommitted|dirty/i, no switch.
//  ensureCloseoutBranch(id, devConfig, { cwd?, provider? }) fetches origin and branches from
//   origin/main; refuses (ok:false, /unmerged/i) while a listed PR whose head is stack/<id>/pr-*
//   is not merged.
//  The closeout hook registered via registerCloseoutBranchHook accepts (id, devConfig, { cwd })
//   and returns the same result as ensureCloseoutBranch.
//  Preflight reads the work item id and task id from the spawn brief text (`**work_item_id:**`,
//   `**task_id:**`) and the repo from process.cwd().

const ID = "ASDLC-9";
const ENABLED = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  verification_commands: ["bun test"],
  stack: { enabled: true, commits: "phase" },
} as unknown as DevHarnessConfig;
const DISABLED_PHASE = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  verification_commands: ["bun test"],
  stack: { enabled: false, commits: "phase" },
} as unknown as DevHarnessConfig;

const LOCKED = ["brief.md", "spec.json", "plan.json", "contract.lock.json"];

// tasks 1, 3 independent; 2 depends on 1 (chain); 4 and 5 are small same-concern -> one PR group.
const PLAN = {
  work_item_id: ID,
  tasks: [
    { id: 1, concern: "a", est_lines: 300, files: [{ path: "src/a.ts", action: "add" }] },
    {
      id: 2,
      concern: "b",
      est_lines: 300,
      depends_on: [1],
      files: [{ path: "src/b.ts", action: "add" }],
    },
    { id: 3, concern: "c", est_lines: 300, files: [{ path: "src/c.ts", action: "add" }] },
    { id: 4, concern: "d", est_lines: 10, files: [{ path: "src/d.ts", action: "add" }] },
    { id: 5, concern: "d", est_lines: 10, files: [{ path: "src/e.ts", action: "add" }] },
  ],
};

let originalCwd: string;
let repo: string;
let origin: string;
const cleanups: string[] = [];

function run(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function git(...args: string[]): string {
  return run(repo, ...args);
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function head(): string {
  return git("rev-parse", "--abbrev-ref", "HEAD");
}
function branches(): string[] {
  return git("branch", "--format=%(refname:short)").split("\n").filter(Boolean);
}
function ok(result: StackBranchResult): Extract<StackBranchResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result;
}
function fail(result: StackBranchResult): string {
  if (result.ok) throw new Error(`expected refusal, got branch ${result.branch}`);
  return result.reason;
}
function commitFile(rel: string, content: string): void {
  write(join(repo, rel), content);
  git("add", "-A");
  git("commit", "-q", "-m", `add ${rel}`);
}

/** PR0 merged = contract commit is on origin/main; unmerged = only on the work branch. */
function setup(prZeroMerged: boolean): void {
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", origin);
  write(join(repo, "README.md"), "# repo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("push", "-q", "origin", "main");
  git("checkout", "-q", "-b", "work/pr0");
  for (const name of LOCKED) write(join(repo, "docs", "dev", ID, name), `locked ${name}\n`);
  write(join(repo, "docs", "dev", ID, "plan.json"), JSON.stringify(PLAN, null, 2));
  git("add", "-A");
  git("commit", "-q", "-m", "lock contract (PR0)");
  git("tag", `accord/${ID}/contract`);
  if (prZeroMerged) {
    // Squash merge: origin/main gets the locked files but the tagged PR0 commit is NOT its ancestor.
    git("checkout", "-q", "main");
    git("merge", "-q", "--squash", "work/pr0");
    git("commit", "-q", "-m", "PR0 (squash)");
    git("push", "-q", "origin", "main");
    git("branch", "-q", "-D", "work/pr0");
  }
}

function expectLockedFiles(): void {
  for (const name of LOCKED) {
    expect(existsSync(join(repo, "docs", "dev", ID, name))).toBe(true);
  }
  expect(readFileSync(join(repo, "docs", "dev", ID, "brief.md"), "utf8")).toBe("locked brief.md\n");
}

beforeEach(() => {
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-branches-")));
  origin = realpathSync(mkdtempSync(join(tmpdir(), "accord-branches-origin-")));
  cleanups.push(repo, origin);
  execFileSync("git", ["init", "-q", "--bare", "--initial-branch=main"], { cwd: origin });
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DIRTY_ROWS: Array<[string, () => void]> = [
  ["unstaged modification", () => write(join(repo, "README.md"), "# modified\n")],
  [
    "staged modification",
    () => {
      write(join(repo, "README.md"), "# modified\n");
      git("add", "README.md");
    },
  ],
  [
    "staged new file",
    () => {
      write(join(repo, "src", "new.ts"), "export {};\n");
      git("add", "src/new.ts");
    },
  ],
];

describe("ASDLC-1/AC-11 branch naming", () => {
  it("ASDLC-1/AC-11 branchFor uses the stack/ namespace, not the CI accord/ namespace", () => {
    expect(branchFor(ID, 1)).toBe(`stack/${ID}/pr-1`);
    expect(branchFor(ID, 12)).toBe(`stack/${ID}/pr-12`);
    expect(branchFor(ID, "closeout")).toBe(`stack/${ID}/closeout`);
  });
});

describe("ASDLC-1/AC-11 ensureTaskBranch base selection", () => {
  it("ASDLC-1/AC-11 PR0 unmerged: branches from the PR0 tip so brief/spec/plan/lock stay in the tree", async () => {
    setup(false);
    const pr0Tip = git("rev-parse", `accord/${ID}/contract^{commit}`);
    expect(git("ls-tree", "-r", "--name-only", "origin/main")).not.toContain("contract.lock.json");

    const result = ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));

    expect(result.branch).toBe(`stack/${ID}/pr-1`);
    expect(head()).toBe(`stack/${ID}/pr-1`);
    expect(git("rev-parse", "HEAD")).toBe(pr0Tip);
    expectLockedFiles();
  });

  it("ASDLC-1/AC-11 PR0 merged: branches from origin/main", async () => {
    setup(true);
    const mainTip = git("rev-parse", "origin/main");

    const result = ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));

    expect(result.branch).toBe(`stack/${ID}/pr-1`);
    expect(head()).toBe(`stack/${ID}/pr-1`);
    expect(git("rev-parse", "HEAD")).toBe(mainTip);
    expect(git("rev-parse", "HEAD")).toBe(git("rev-parse", "origin/main"));
    expect(git("rev-parse", "HEAD")).not.toBe(git("rev-parse", `accord/${ID}/contract^{commit}`));
    expectLockedFiles();
  });

  it("ASDLC-1/AC-11 sibling task PR sees none of the previous group's files (PR0 unmerged)", async () => {
    setup(false);
    ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));
    commitFile("src/a.ts", "export const a = 1;\n");

    const result = ok(await ensureTaskBranch(ID, 3, ENABLED, { cwd: repo }));

    expect(result.branch).toBe(`stack/${ID}/pr-3`);
    expect(head()).toBe(`stack/${ID}/pr-3`);
    expect(existsSync(join(repo, "src", "a.ts"))).toBe(false);
    expectLockedFiles();
  });

  it("ASDLC-1/AC-11 sibling task PR sees none of the previous group's files (PR0 merged)", async () => {
    setup(true);
    ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));
    commitFile("src/a.ts", "export const a = 1;\n");

    ok(await ensureTaskBranch(ID, 3, ENABLED, { cwd: repo }));

    expect(head()).toBe(`stack/${ID}/pr-3`);
    expect(existsSync(join(repo, "src", "a.ts"))).toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(git("rev-parse", "origin/main"));
    expect(git("rev-parse", "HEAD")).not.toBe(git("rev-parse", `accord/${ID}/contract^{commit}`));
  });

  it("ASDLC-1/AC-11 depends_on chain: child branches from the parent PR branch", async () => {
    setup(false);
    ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));
    commitFile("src/a.ts", "export const a = 1;\n");
    const parentTip = git("rev-parse", "HEAD");
    // Move HEAD off the parent so "branch from current HEAD" cannot pass.
    ok(await ensureTaskBranch(ID, 3, ENABLED, { cwd: repo }));
    expect(head()).toBe(`stack/${ID}/pr-3`);

    const result = ok(await ensureTaskBranch(ID, 2, ENABLED, { cwd: repo }));

    expect(result.branch).toBe(`stack/${ID}/pr-2`);
    expect(head()).toBe(`stack/${ID}/pr-2`);
    expect(git("rev-parse", "HEAD")).toBe(parentTip);
    expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("ASDLC-1/AC-11 re-entry switches to the existing branch and keeps its commits (no reset, no force)", async () => {
    setup(false);
    ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));
    commitFile("src/a.ts", "export const a = 1;\n");
    const tip = git("rev-parse", "HEAD");
    ok(await ensureTaskBranch(ID, 3, ENABLED, { cwd: repo }));

    const again = ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));

    expect(again.branch).toBe(`stack/${ID}/pr-1`);
    expect(head()).toBe(`stack/${ID}/pr-1`);
    expect(git("rev-parse", "HEAD")).toBe(tip);
    expect(readFileSync(join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("ASDLC-1/AC-11 non-first member of a packed PR group stays on the group branch", async () => {
    setup(false);
    const first = ok(await ensureTaskBranch(ID, 4, ENABLED, { cwd: repo }));
    commitFile("src/d.ts", "export const d = 1;\n");
    const tip = git("rev-parse", "HEAD");

    const second = ok(await ensureTaskBranch(ID, 5, ENABLED, { cwd: repo }));

    expect(second.branch).toBe(first.branch);
    expect(head()).toBe(first.branch);
    expect(git("rev-parse", "HEAD")).toBe(tip);
    expect(branches().filter((name) => name.startsWith(`stack/${ID}/`))).toEqual([first.branch]);
  });
});

describe("ASDLC-1/AC-11 PR index derivation", () => {
  it("ASDLC-1/AC-11 branch index is the computed PR index, not the group's first task id", async () => {
    setup(false);
    const plan = {
      work_item_id: ID,
      tasks: [
        { id: 1, concern: "d", est_lines: 10, files: [{ path: "src/a.ts", action: "add" }] },
        { id: 2, concern: "d", est_lines: 10, files: [{ path: "src/b.ts", action: "add" }] },
        { id: 3, concern: "c", est_lines: 300, files: [{ path: "src/c.ts", action: "add" }] },
      ],
    };
    commitFile(`docs/dev/${ID}/plan.json`, JSON.stringify(plan, null, 2));

    const result = ok(await ensureTaskBranch(ID, 3, ENABLED, { cwd: repo }));

    expect(result.branch).toBe(`stack/${ID}/pr-2`);
    expect(head()).toBe(`stack/${ID}/pr-2`);
  });

  it("ASDLC-1/AC-11 grouping honours devConfig.stack.sizing", async () => {
    setup(false);
    const sized = {
      ...ENABLED,
      stack: { enabled: true, commits: "phase", sizing: { min_pr_lines: 5 } },
    } as unknown as DevHarnessConfig;
    ok(await ensureTaskBranch(ID, 4, sized, { cwd: repo }));
    const second = ok(await ensureTaskBranch(ID, 5, sized, { cwd: repo }));
    expect(second.branch).toBe(`stack/${ID}/pr-5`);
    expect(head()).toBe(`stack/${ID}/pr-5`);
  });
});

describe("ASDLC-1/AC-11 ensureTaskBranch refusals", () => {
  it("ASDLC-1/AC-11 dirty tree returns a reason and does not switch or create a branch", async () => {
    setup(false);
    const before = head();
    write(join(repo, "README.md"), "# modified\n");

    const reason = fail(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));

    expect(reason).toMatch(/uncommitted|dirty/i);
    expect(head()).toBe(before);
    expect(branches()).not.toContain(`stack/${ID}/pr-1`);
    expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# modified\n");
  });

  it.each(DIRTY_ROWS)(
    "ASDLC-1/AC-11 dirty (%s) refuses task branch switch",
    async (_name, arrange) => {
      setup(false);
      const before = head();
      arrange();

      const reason = fail(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));

      expect(reason).toMatch(/uncommitted|dirty/i);
      expect(head()).toBe(before);
      expect(branches()).not.toContain(`stack/${ID}/pr-1`);
    },
  );

  it("ASDLC-1/AC-11 untracked-only files do not block the switch", async () => {
    setup(false);
    write(join(repo, ".tasks", "x.json"), "{}");
    const result = ok(await ensureTaskBranch(ID, 1, ENABLED, { cwd: repo }));
    expect(result.branch).toBe(`stack/${ID}/pr-1`);
    expect(head()).toBe(`stack/${ID}/pr-1`);
  });

  it("ASDLC-1/AC-11 disabled stack creates nothing", async () => {
    setup(false);
    const before = head();
    const result = await ensureTaskBranch(ID, 1, DISABLED_PHASE, { cwd: repo });
    expect(result.ok).toBe(false);
    expect(head()).toBe(before);
    expect(branches()).not.toContain(`stack/${ID}/pr-1`);
  });

  it("ASDLC-1/AC-11 task absent from the plan is refused without creating a branch", async () => {
    setup(false);
    const before = head();
    const reason = fail(await ensureTaskBranch(ID, 99, ENABLED, { cwd: repo }));
    expect(reason).toMatch(/99/);
    expect(head()).toBe(before);
    expect(branches().filter((name) => name.startsWith("stack/"))).toEqual([]);
  });

  it("ASDLC-1/AC-11 unsafe work item id is refused without git side effects", async () => {
    setup(false);
    const before = head();
    // A plan exists where an unvalidated join(docs/dev, "../evil") would resolve it.
    write(join(repo, "docs", "evil", "plan.json"), JSON.stringify(PLAN));
    const reason = fail(await ensureTaskBranch("../evil", 1, ENABLED, { cwd: repo }));
    expect(reason).toMatch(/evil|work item id|invalid|unsafe/i);
    expect(reason).not.toMatch(/plan\.json|no plan/i);
    expect(head()).toBe(before);
    expect(branches().filter((name) => name.includes("evil"))).toEqual([]);
  });
});

describe("ASDLC-1/AC-11 preflight integration", () => {
  const brief = (taskId: number) =>
    `## phase-test\n\n**work_item_id:** ${ID}\n**task_id:** ${taskId}\n**title:** t\n`;
  const spawn = (agent: string, taskId: number) => ({ agent, task: brief(taskId) });
  const options = (config: DevHarnessConfig) => ({
    devConfig: config,
    availableToolNames: new Set<string>(),
  });

  it("ASDLC-1/AC-11 phase-test on the first task of a PR group switches to its branch", async () => {
    setup(false);
    const pr0Tip = git("rev-parse", `accord/${ID}/contract^{commit}`);

    const result = await runSubagentToolPreflight(spawn("phase-test", 1), options(ENABLED));

    expect(result.blockReason).toBeUndefined();
    expect(head()).toBe(`stack/${ID}/pr-1`);
    expect(git("rev-parse", "HEAD")).toBe(pr0Tip);
    expectLockedFiles();
  });

  it("ASDLC-1/AC-11 dirty tree yields a blockReason and leaves HEAD alone", async () => {
    setup(false);
    const before = head();
    write(join(repo, "README.md"), "# modified\n");

    const result = await runSubagentToolPreflight(spawn("phase-test", 1), options(ENABLED));

    expect(result.blockReason).toMatch(/uncommitted|dirty/i);
    expect(head()).toBe(before);
    expect(branches()).not.toContain(`stack/${ID}/pr-1`);
  });

  it("ASDLC-1/AC-11 phase-test for a non-first task of a PR group does not switch", async () => {
    setup(false);
    ok(await ensureTaskBranch(ID, 4, ENABLED, { cwd: repo }));
    commitFile("src/d.ts", "export const d = 1;\n");
    const tip = git("rev-parse", "HEAD");

    const result = await runSubagentToolPreflight(spawn("phase-test", 5), options(ENABLED));

    expect(result.blockReason).toBeUndefined();
    expect(head()).toBe(branchFor(ID, 4));
    expect(git("rev-parse", "HEAD")).toBe(tip);
    expect(branches().filter((name) => name.startsWith(`stack/${ID}/`))).toEqual([
      `stack/${ID}/pr-4`,
    ]);
  });

  it.each([
    ["stack disabled", DISABLED_PHASE, "phase-test"],
    ["no stack key", { test: ENABLED.test, verification_commands: ["bun test"] }, "phase-test"],
    ["phase-code", ENABLED, "phase-code"],
    ["review-code", ENABLED, "review-code"],
    ["phase-plan", ENABLED, "phase-plan"],
  ])("ASDLC-1/AC-11 no blockReason and no switch: %s", async (_name, config, agent) => {
    setup(false);
    const before = head();
    const result = await runSubagentToolPreflight(
      spawn(agent as string, 1),
      options(config as unknown as DevHarnessConfig),
    );
    expect(result.blockReason).toBeUndefined();
    expect(head()).toBe(before);
    expect(branches().filter((name) => name.startsWith("stack/"))).toEqual([]);
  });

  it("ASDLC-1/AC-11 non-first member: no blockReason", async () => {
    setup(false);
    const before = head();
    const result = await runSubagentToolPreflight(spawn("phase-test", 5), options(ENABLED));
    expect(result.blockReason).toBeUndefined();
    expect(head()).toBe(before);
  });

  it.each(DIRTY_ROWS)(
    "ASDLC-1/AC-11 preflight dirty (%s) yields blockReason",
    async (_name, arrange) => {
      setup(false);
      const before = head();
      arrange();
      const result = await runSubagentToolPreflight(spawn("phase-test", 1), options(ENABLED));
      expect(result.blockReason).toMatch(/uncommitted|dirty/i);
      expect(head()).toBe(before);
      expect(branches()).not.toContain(`stack/${ID}/pr-1`);
    },
  );

  it("ASDLC-1/AC-11 agents other than phase-test never switch branches", async () => {
    setup(false);
    const before = head();
    for (const agent of ["phase-code", "review-code", "phase-plan"]) {
      await runSubagentToolPreflight(spawn(agent, 1), options(ENABLED));
      expect(head()).toBe(before);
      expect(branches().filter((name) => name.startsWith("stack/"))).toEqual([]);
    }
  });

  it("ASDLC-1/AC-11 stack.enabled false is a no-op even with stack.commits phase", async () => {
    setup(false);
    const before = head();

    await runSubagentToolPreflight(spawn("phase-test", 1), options(DISABLED_PHASE));

    expect(head()).toBe(before);
    expect(branches().filter((name) => name.startsWith("stack/"))).toEqual([]);
  });

  it("ASDLC-1/AC-11 read-only stack status queries never switch branches", async () => {
    setup(false);
    const before = head();
    const provider: StackProvider = {
      createOrUpdatePr: async () => ({ number: 1, url: "u" }),
      upsertStackMapComment: async () => {},
      setEvidenceStatus: async () => {},
      listPrs: async () => [],
      ensureBranch: async () => {},
      pushBranch: async () => {},
      retarget: async () => {},
    };

    await stackShow(ID, ENABLED, { cwd: repo, provider });
    await stackSync(ID, ENABLED, { cwd: repo, provider });
    await stackReport(ID, ENABLED, { cwd: repo, provider });

    expect(head()).toBe(before);
    expect(branches().filter((name) => name.startsWith("stack/"))).toEqual([]);
  });
});

describe("ASDLC-1/AC-11 ensureCloseoutBranch", () => {
  function fakeProvider(prs: StackPr[]): StackProvider {
    return {
      createOrUpdatePr: async () => ({ number: 1, url: "u" }),
      upsertStackMapComment: async () => {},
      setEvidenceStatus: async () => {},
      // gh-faithful: state defaults to open; head filter applied.
      listPrs: async (input) =>
        prs.filter(
          (p) =>
            (!input?.head || p.head === input.head) &&
            ((input?.state ?? "open") === "all" || p.state === (input?.state ?? "open")),
        ),
      ensureBranch: async () => {},
      pushBranch: async () => {},
      retarget: async () => {},
    };
  }
  const allMerged = () => [pr(1, "merged"), pr(2, "merged"), pr(3, "merged"), pr(4, "merged")];
  const pr = (n: number, state: StackPr["state"]): StackPr => ({
    number: n,
    url: `https://example.test/pr/${n}`,
    state,
    head: `stack/${ID}/pr-${n}`,
    base: "main",
  });

  /** Advances origin/main from a second clone so only a fetch can see it. */
  function advanceOrigin(): string {
    const other = realpathSync(mkdtempSync(join(tmpdir(), "accord-branches-clone-")));
    cleanups.push(other);
    run(other, "clone", "-q", origin, ".");
    run(other, "config", "user.email", "t@example.com");
    run(other, "config", "user.name", "T");
    run(other, "config", "commit.gpgsign", "false");
    writeFileSync(join(other, "merged.txt"), "squash-merged task PRs\n");
    run(other, "add", "-A");
    run(other, "commit", "-q", "-m", "merge task PRs");
    run(other, "push", "-q", "origin", "main");
    return run(other, "rev-parse", "HEAD");
  }

  it("ASDLC-1/AC-11 switches to stack/<ID>/closeout from freshly fetched origin/main when all task PRs merged", async () => {
    setup(true);
    const staleMain = git("rev-parse", "origin/main");
    const freshMain = advanceOrigin();
    expect(freshMain).not.toBe(staleMain);

    const result = ok(
      await ensureCloseoutBranch(ID, ENABLED, {
        cwd: repo,
        provider: fakeProvider(allMerged()),
      }),
    );

    expect(result.branch).toBe(`stack/${ID}/closeout`);
    expect(head()).toBe(`stack/${ID}/closeout`);
    expect(git("rev-parse", "HEAD")).toBe(freshMain);
    expect(existsSync(join(repo, "merged.txt"))).toBe(true);
  });

  it("ASDLC-1/AC-11 refuses with a decision while a task PR is unmerged", async () => {
    setup(true);
    const before = head();
    advanceOrigin();

    const reason = fail(
      await ensureCloseoutBranch(ID, ENABLED, {
        cwd: repo,
        provider: fakeProvider([pr(1, "merged"), pr(2, "merged"), pr(3, "open"), pr(4, "merged")]),
      }),
    );

    expect(reason).toMatch(/unmerged/i);
    expect(reason).toContain(`pr-3`);
    expect(head()).toBe(before);
    expect(branches()).not.toContain(`stack/${ID}/closeout`);
  });

  it("ASDLC-1/AC-11 closed-but-unmerged task PR also blocks closeout", async () => {
    setup(true);
    const reason = fail(
      await ensureCloseoutBranch(ID, ENABLED, {
        cwd: repo,
        provider: fakeProvider([pr(1, "closed")]),
      }),
    );
    expect(reason).toMatch(/unmerged/i);
    expect(branches()).not.toContain(`stack/${ID}/closeout`);
  });

  it.each(DIRTY_ROWS)(
    "ASDLC-1/AC-11 dirty (%s) refuses closeout switch",
    async (_name, arrange) => {
      setup(true);
      const before = head();
      arrange();
      const reason = fail(
        await ensureCloseoutBranch(ID, ENABLED, { cwd: repo, provider: fakeProvider(allMerged()) }),
      );
      expect(reason).toMatch(/uncommitted|dirty/i);
      expect(head()).toBe(before);
      expect(branches()).not.toContain(`stack/${ID}/closeout`);
    },
  );

  it.each([
    [
      "unrelated and look-alike heads are ignored",
      [
        ...allMerged(),
        { ...pr(1, "open"), head: "stack/ASDLC-90/pr-1" },
        { ...pr(2, "open"), head: "feature/x" },
      ],
    ],
    [
      "own open closeout PR does not block",
      [...allMerged(), { ...pr(9, "open"), head: `stack/${ID}/closeout` }],
    ],
  ])("ASDLC-1/AC-11 closeout guard: %s", async (_name, prs) => {
    setup(true);
    const result = ok(
      await ensureCloseoutBranch(ID, ENABLED, { cwd: repo, provider: fakeProvider(prs) }),
    );
    expect(result.branch).toBe(`stack/${ID}/closeout`);
    expect(head()).toBe(`stack/${ID}/closeout`);
  });

  it("ASDLC-1/AC-11 closeout with stack disabled refuses and does not switch", async () => {
    setup(true);
    const before = head();
    const result = await ensureCloseoutBranch(ID, DISABLED_PHASE, {
      cwd: repo,
      provider: fakeProvider(allMerged()),
    });
    expect(result.ok).toBe(false);
    expect(head()).toBe(before);
    expect(branches()).not.toContain(`stack/${ID}/closeout`);
  });

  it("ASDLC-1/AC-11 closeout re-entry keeps existing closeout commits (no reset, no force)", async () => {
    setup(true);
    ok(await ensureCloseoutBranch(ID, ENABLED, { cwd: repo, provider: fakeProvider(allMerged()) }));
    commitFile(`docs/dev/${ID}/evidence/closeout.json`, "{}\n");
    const tip = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");

    const again = ok(
      await ensureCloseoutBranch(ID, ENABLED, { cwd: repo, provider: fakeProvider(allMerged()) }),
    );

    expect(again.branch).toBe(`stack/${ID}/closeout`);
    expect(head()).toBe(`stack/${ID}/closeout`);
    expect(git("rev-parse", "HEAD")).toBe(tip);
    expect(existsSync(join(repo, "docs", "dev", ID, "evidence", "closeout.json"))).toBe(true);
  });

  it.each([["src/index.ts"], ["src/tools/registry.ts"]])(
    "ASDLC-1/AC-11 closeout hook is registered at module load by importing only %s",
    (entry) => {
      const root = join(import.meta.dir, "..");
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-branches-probe-")));
      cleanups.push(dir);
      const file = join(dir, "probe.ts");
      writeFileSync(
        file,
        `import ${JSON.stringify(join(root, entry))};
import { getCloseoutBranchHook, registerCloseoutBranchHook } from ${JSON.stringify(join(root, "src/commit/hooks.ts"))};
console.log(typeof getCloseoutBranchHook());
`,
      );
      const out = execFileSync(process.execPath, [file], { cwd: originalCwd, encoding: "utf8" });
      expect(out.trim()).toBe("function");
    },
  );

  it("ASDLC-1/AC-11 registered closeout hook delegates to ensureCloseoutBranch", async () => {
    const previous = getCloseoutBranchHook();
    try {
      registerCloseoutBranchHook(undefined);
      // registration happens at branches.ts load; re-run it in a fresh process for the probe above,
      // here exercise delegation through an explicit registration of the module's own exports.
      const mod = await import("../src/stack/branches.js");
      registerCloseoutBranchHook(
        mod.ensureCloseoutBranch as unknown as Parameters<typeof registerCloseoutBranchHook>[0],
      );
      setup(true);
      const hook = getCloseoutBranchHook() as (...args: unknown[]) => unknown;
      const result = (await hook(ID, ENABLED, {
        cwd: repo,
        provider: fakeProvider([pr(1, "open")]),
      })) as StackBranchResult;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/unmerged/i);
      expect(branches()).not.toContain(`stack/${ID}/closeout`);
    } finally {
      registerCloseoutBranchHook(previous);
    }
  });
});
