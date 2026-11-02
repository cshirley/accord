import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DevHarnessConfig } from "../src/config/types.js";
import { computeStack } from "../src/stack/compute-stack.js";
import { openablePrs, validateFlags } from "../src/stack/depth.js";
import type { CreateOrUpdatePrInput, StackPr, StackProvider } from "../src/stack/provider.js";
import { stackSubmit } from "../src/stack/service.js";
import type { StackPlanTask } from "../src/stack/types.js";

// Pinned contract (spec leaves shapes open):
// Scope: this task (40) owns the depth-cap and flag half of ASDLC-1/AC-17 and TC-18. The merge half
//  (retarget by merging main, squash add/add resolution, differing conflict -> decisions[], clean
//  rebase/merge-commit bases) is owned by task 41 in this same file; AC-17 is PARTIAL until it lands.
//  openablePrs(stack, mergedPrs, maxDepth) -> number[]: ascending PR indexes (task PRs only, never the
//   contract or closeout PR) that may be open now: not merged, and per chain at most maxDepth unmerged
//   PRs open at once (a PR is openable when its unmerged transitive depends_on_prs ancestors plus itself
//   number <= maxDepth). Independent PRs branch from main and are never capped by another chain.
//   mergedPrs holds merged PR indexes (may include 0 contract / closeout; any order, not a prefix).
//  validateFlags(plan, requireFlag) -> { ok, violations: [{ task, rule }] } sorted by task id, rules:
//   "missing_flag"     non-final task has no (or blank) flag
//   "premature_enable" non-final task has kind "enable"
//   "missing_enable"   the final task does not have kind "enable" (the last task flips the flag)
//  requireFlag false -> { ok: true, violations: [] }.
//  stackSubmit reads stack.require_flag from devConfig (explicit true to enforce) and stack.sizing.max_depth.
//  Flag violations: { ok: false, text } naming the task and flag rule, with no provider call.

const ID = "ASDLC-1";
const FLAG = "evidence_stack";

function chainTasks(count: number, withFlags: boolean): StackPlanTask[] {
  return Array.from({ length: count }, (_unused, position) => {
    const id = position + 1;
    const isLast = id === count;
    return {
      id,
      title: `Task ${id}`,
      covers_ac: [`AC-${id}`],
      concern: `concern-${id}`,
      est_lines: 200,
      ...(id > 1 ? { depends_on: [id - 1] } : {}),
      ...(withFlags ? { flag: FLAG } : {}),
      ...(isLast && withFlags ? { kind: "enable" as const } : {}),
      files: [{ path: `src/t${id}.ts`, action: "add" }],
    };
  });
}

function independentTasks(count: number): StackPlanTask[] {
  return Array.from({ length: count }, (_unused, position) => {
    const id = position + 1;
    return {
      id,
      title: `Task ${id}`,
      covers_ac: [`AC-${id}`],
      concern: `concern-${id}`,
      est_lines: 200,
      flag: FLAG,
      files: [{ path: `src/t${id}.ts`, action: "add" }],
    };
  });
}

/** Decreasing-id chain: ids 80 -> 70 -> ... -> 10 (80 is first, 10 is last). Flag on all, enable on 10. */
function decreasingChain(): StackPlanTask[] {
  return [80, 70, 60, 50, 40, 30, 20, 10].map((id, position, ids) => ({
    id,
    title: `Task ${id}`,
    covers_ac: [`AC-${id}`],
    concern: `concern-${id}`,
    est_lines: 200,
    ...(position > 0 ? { depends_on: [ids[position - 1] as number] } : {}),
    flag: FLAG,
    ...(id === 10 ? { kind: "enable" as const } : {}),
    files: [{ path: `src/t${id}.ts`, action: "add" }],
  }));
}

const SIZING = { max_pr_lines: 400, min_pr_lines: 30, max_files: 10, max_depth: 6 };

function stackOf(count: number) {
  return computeStack({ tasks: chainTasks(count, true) }, SIZING);
}

describe("ASDLC-1/AC-17 openablePrs depth cap", () => {
  it("ASDLC-1/TC-18 chain of 8 with max_depth 6 opens exactly PRs 1..6", () => {
    const stack = stackOf(8);
    expect(stack.prs.filter((pr) => pr.kind === "task").length).toBe(8);
    expect(openablePrs(stack, [], 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ASDLC-1/TC-18 PR 7 is openable only after PR 1 merges", () => {
    const stack = stackOf(8);
    expect(openablePrs(stack, [], 6)).not.toContain(7);
    expect(openablePrs(stack, [1], 6)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(openablePrs(stack, [1, 2], 6)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("ASDLC-1/TC-18 never exceeds max_depth for any merge prefix and excludes merged PRs", () => {
    const stack = stackOf(8);
    for (const mergedCount of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const merged = Array.from({ length: mergedCount }, (_unused, position) => position + 1);
      const open = openablePrs(stack, merged, 6);
      expect(open.length).toBe(Math.min(6, 8 - mergedCount));
      for (const index of open) expect(merged).not.toContain(index);
      expect(open.every((index) => index >= 1 && index <= 8)).toBe(true);
    }
    expect(openablePrs(stack, [1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual([]);
  });

  it("ASDLC-1/AC-17 boundary: depth 1, depth equal to chain length, depth above chain length", () => {
    const stack = stackOf(8);
    expect(openablePrs(stack, [], 1)).toEqual([1]);
    expect(openablePrs(stack, [1], 1)).toEqual([2]);
    expect(openablePrs(stack, [], 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(openablePrs(stack, [], 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(openablePrs(stack, [], 20)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("ASDLC-1/AC-17 a chain shorter than max_depth opens all of it, never the contract or closeout PR", () => {
    const stack = stackOf(3);
    expect(openablePrs(stack, [], 6)).toEqual([1, 2, 3]);
  });
});

describe("ASDLC-1/AC-17 openablePrs per-chain cap and merged-set shapes", () => {
  const plan = (tasks: StackPlanTask[]) => computeStack({ tasks }, SIZING);
  const twoChains = (): StackPlanTask[] =>
    independentTasks(8).map((task) => ({
      ...task,
      ...(task.id === 2 || task.id === 3 || task.id === 4 ? { depends_on: [task.id - 1] } : {}),
      ...(task.id >= 6 ? { depends_on: [task.id - 1] } : {}),
    }));

  it("ASDLC-1/TC-18 8 independent tasks, max_depth 6: all 8 are openable (total PRs not capped)", () => {
    expect(openablePrs(plan(independentTasks(8)), [], 6)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("ASDLC-1/TC-18 chain 1..8 plus independent task 9: cap applies to the chain only", () => {
    const tasks = [...chainTasks(8, true), ...independentTasks(9).slice(8)];
    expect(openablePrs(plan(tasks), [], 6)).toEqual([1, 2, 3, 4, 5, 6, 9]);
  });

  it("ASDLC-1/TC-18 two chains 1-4 and 5-8, max_depth 3: each chain capped separately", () => {
    expect(openablePrs(plan(twoChains()), [], 3)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(openablePrs(plan(twoChains()), [1], 3)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it.each([
    ["contract PR 0 merged", [0], [1, 2, 3, 4, 5, 6]],
    ["out-of-order prefix [2,1]", [2, 1], [3, 4, 5, 6, 7, 8]],
    ["non-prefix [1,3]", [1, 3], [2, 4, 5, 6, 7, 8]],
    ["closeout PR 9 merged", [9], [1, 2, 3, 4, 5, 6]],
  ])("ASDLC-1/TC-18 merged set shape: %s", (_label, merged, expected) => {
    expect(openablePrs(stackOf(8), merged, 6)).toEqual(expected);
  });
});

describe("ASDLC-1/AC-17 validateFlags", () => {
  it("ASDLC-1/TC-18 valid chain: all non-final flagged, last task enables", () => {
    expect(validateFlags({ tasks: chainTasks(8, true) }, true)).toEqual({
      ok: true,
      violations: [],
    });
  });

  it.each([
    ["undefined flag", undefined],
    ["empty flag", ""],
    ["whitespace flag", "   "],
  ])("ASDLC-1/TC-18 non-final task with %s fails missing_flag", (_label, flag) => {
    const tasks = chainTasks(4, true);
    const target = tasks[1] as StackPlanTask;
    if (flag === undefined) delete target.flag;
    else target.flag = flag;
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [{ task: 2, rule: "missing_flag" }],
    });
  });

  it("ASDLC-1/TC-18 every unflagged non-final task is reported, sorted by task", () => {
    const tasks = chainTasks(5, true);
    delete (tasks[3] as StackPlanTask).flag;
    delete (tasks[0] as StackPlanTask).flag;
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [
        { task: 1, rule: "missing_flag" },
        { task: 4, rule: "missing_flag" },
      ],
    });
  });

  it("ASDLC-1/TC-18 a non-final task with kind enable fails premature_enable", () => {
    const tasks = chainTasks(4, true);
    (tasks[1] as StackPlanTask).kind = "enable";
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [{ task: 2, rule: "premature_enable" }],
    });
  });

  it("ASDLC-1/TC-18 the final task not flipping the flag fails missing_enable", () => {
    const tasks = chainTasks(4, true);
    delete (tasks[3] as StackPlanTask).kind;
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [{ task: 4, rule: "missing_enable" }],
    });
    (tasks[3] as StackPlanTask).kind = "feature";
    expect(validateFlags({ tasks }, true).violations).toEqual([
      { task: 4, rule: "missing_enable" },
    ]);
  });

  it("ASDLC-1/TC-18 only the last task (highest chain position) is final, regardless of array order", () => {
    const tasks = chainTasks(3, true).reverse();
    expect(validateFlags({ tasks }, true)).toEqual({ ok: true, violations: [] });
  });

  it("ASDLC-1/TC-18 decreasing-id chain 80..10: final is chain-last (10), valid when 10 enables", () => {
    expect(validateFlags({ tasks: decreasingChain() }, true)).toEqual({ ok: true, violations: [] });
  });

  it("ASDLC-1/TC-18 decreasing-id chain with enable moved to 80: sorted by task id", () => {
    const tasks = decreasingChain();
    for (const task of tasks) {
      if (task.id === 10) delete task.kind;
      if (task.id === 80) task.kind = "enable";
    }
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [
        { task: 10, rule: "missing_enable" },
        { task: 80, rule: "premature_enable" },
      ],
    });
  });

  it("ASDLC-1/TC-18 reversed array with unflagged tasks 1 and 4: sorted by task id", () => {
    const tasks = chainTasks(5, true).reverse();
    for (const task of tasks) if (task.id === 1 || task.id === 4) delete task.flag;
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [
        { task: 1, rule: "missing_flag" },
        { task: 4, rule: "missing_flag" },
      ],
    });
  });

  it("ASDLC-1/TC-18 single-task plan: the only task is final and must enable", () => {
    const task = chainTasks(1, false)[0] as StackPlanTask;
    expect(validateFlags({ tasks: [task] }, true)).toEqual({
      ok: false,
      violations: [{ task: 1, rule: "missing_enable" }],
    });
  });

  it("ASDLC-1/TC-18 empty plan has no violations", () => {
    expect(validateFlags({ tasks: [] }, true)).toEqual({ ok: true, violations: [] });
  });

  it("ASDLC-1/TC-18 non-final task both unflagged and enable reports missing_flag then premature_enable", () => {
    const tasks = chainTasks(4, true);
    const target = tasks[1] as StackPlanTask;
    delete target.flag;
    target.kind = "enable";
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [
        { task: 2, rule: "missing_flag" },
        { task: 2, rule: "premature_enable" },
      ],
    });
  });

  it("ASDLC-1/TC-18 final enable task without a flag is valid (final task needs kind only)", () => {
    const tasks = chainTasks(3, true);
    delete (tasks[2] as StackPlanTask).flag;
    expect(validateFlags({ tasks }, true)).toEqual({ ok: true, violations: [] });
  });

  it("ASDLC-1/TC-18 require_flag false ignores enable/flag rules on any plan shape", () => {
    const tasks = chainTasks(8, true);
    (tasks[1] as StackPlanTask).kind = "enable";
    delete (tasks[2] as StackPlanTask).flag;
    expect(validateFlags({ tasks }, false)).toEqual({ ok: true, violations: [] });
  });

  it("ASDLC-1/TC-18 require_flag false never reports violations", () => {
    expect(validateFlags({ tasks: chainTasks(4, false) }, false)).toEqual({
      ok: true,
      violations: [],
    });
  });

  it("ASDLC-1/TC-18 require_flag true on an unflagged chain reports every non-final task and the final", () => {
    expect(validateFlags({ tasks: chainTasks(3, false) }, true)).toEqual({
      ok: false,
      violations: [
        { task: 1, rule: "missing_flag" },
        { task: 2, rule: "missing_flag" },
        { task: 3, rule: "missing_enable" },
      ],
    });
  });
});

// --- stackSubmit integration -------------------------------------------------------------------
const cleanups: string[] = [];
let repo = "";
let originalCwd = "";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function config(extra: Record<string, unknown>): DevHarnessConfig {
  return {
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    stack: { enabled: true, provider: "gh", sizing: { max_depth: 6 }, ...extra },
  } as unknown as DevHarnessConfig;
}
function writePlan(tasks: StackPlanTask[]): void {
  write(
    join(repo, "docs", "dev", ID, "plan.json"),
    JSON.stringify({ work_item_id: ID, tasks }, null, 2),
  );
}

beforeEach(() => {
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-depth-")));
  const origin = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-depth-origin-")));
  cleanups.push(repo, origin);
  execFileSync("git", ["init", "-q", "--bare"], { cwd: origin });
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/o/r.git");
  git("config", `url.${origin}.pushInsteadOf`, "https://github.com/o/r.git");
  write(join(repo, "README.md"), "# repo\n");
  write(join(repo, "docs", "dev", ID, "spec.json"), JSON.stringify({ work_item_id: ID }));
  write(join(repo, "docs", "dev", ID, "contract.lock.json"), '{"locked":true}');
  writePlan(chainTasks(8, true));
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("tag", `accord/${ID}/contract`);
  git("push", "-q", "origin", "main");
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fake extends StackProvider {
  creates: CreateOrUpdatePrInput[];
  mapCalls: number;
  statusCalls: number;
  prs: Map<string, StackPr>;
}

function fakeProvider(
  preset: { task: number; state: StackPr["state"]; base?: string }[] = [],
): Fake {
  const prs = new Map<string, StackPr>();
  for (const { task, state, base } of preset) {
    const head = `accord/${ID}/task-${task}`;
    prs.set(head, {
      number: 200 + task,
      url: `https://github.com/o/r/pull/${200 + task}`,
      state,
      head,
      base: base ?? (task === 1 ? "main" : `accord/${ID}/task-${task - 1}`),
    });
  }
  const fake: Fake = {
    creates: [],
    mapCalls: 0,
    statusCalls: 0,
    prs,
    async createOrUpdatePr(input) {
      fake.creates.push(input);
      const existing = prs.get(input.head);
      const number = existing?.number ?? 101 + prs.size;
      prs.set(input.head, {
        number,
        url: `https://github.com/o/r/pull/${number}`,
        state: existing?.state ?? "open",
        head: input.head,
        base: input.base,
      });
      return { number, url: `https://github.com/o/r/pull/${number}` };
    },
    async upsertStackMapComment() {
      fake.mapCalls += 1;
    },
    async setEvidenceStatus() {
      fake.statusCalls += 1;
    },
    // Mirrors the gh provider: `gh pr list` without --state returns open PRs only.
    async listPrs(input) {
      const wanted = input?.state ?? "open";
      return [...prs.values()].filter(
        (pr) =>
          (input?.head === undefined || pr.head === input.head) &&
          (wanted === "all" || pr.state === wanted),
      );
    },
    async ensureBranch(input) {
      try {
        git("rev-parse", "--verify", "--quiet", `refs/heads/${input.branch}`);
      } catch {
        const baseSha = git("rev-parse", input.base).trim();
        const sha = git(
          "commit-tree",
          `${baseSha}^{tree}`,
          "-p",
          baseSha,
          "-m",
          input.branch,
        ).trim();
        git("update-ref", `refs/heads/${input.branch}`, sha);
      }
    },
    async pushBranch() {},
  };
  return fake;
}

const headOf = (task: number): string => `accord/${ID}/task-${task}`;

describe("ASDLC-1/AC-17 stackSubmit depth cap and flag validation", () => {
  it("ASDLC-1/TC-18 chain of 8 with max_depth 6 submits only PRs 1..6", async () => {
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: true }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(fake.creates.map((call) => call.head)).toEqual([1, 2, 3, 4, 5, 6].map(headOf));
    expect(fake.prs.has(headOf(7))).toBe(false);
    expect(fake.prs.has(headOf(8))).toBe(false);
    expect(result.text).not.toContain(headOf(7));
  });

  it("ASDLC-1/TC-18 after PR 1 merges, PR 7 opens and PR 1 is not recreated", async () => {
    const fake = fakeProvider([{ task: 1, state: "merged" }]);
    const result = await stackSubmit(ID, config({ require_flag: true }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    const heads = fake.creates.map((call) => call.head);
    expect(heads).toContain(headOf(7));
    expect(heads).not.toContain(headOf(1));
    expect(heads).not.toContain(headOf(8));
    expect(fake.prs.get(headOf(1))?.state).toBe("merged");
    expect(heads).toEqual([2, 3, 4, 5, 6, 7].map(headOf));
    expect(fake.creates.find((call) => call.head === headOf(2))?.base).toBe("main");
  });

  it("ASDLC-1/TC-18 max_depth from stack.sizing is honoured", async () => {
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: true, sizing: { max_depth: 3 } }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(fake.creates.map((call) => call.head).sort()).toEqual([1, 2, 3].map(headOf).sort());
  });

  it("ASDLC-1/TC-18 require_flag true and a non-final task without flag: reports it, opens nothing", async () => {
    const tasks = chainTasks(8, true);
    delete (tasks[2] as StackPlanTask).flag;
    writePlan(tasks);
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: true }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/\btask 3\b[^\n]*missing_flag/i);
    expect(fake.creates).toEqual([]);
  });

  it("ASDLC-1/TC-18 require_flag true and a non-final enable task: reports premature_enable, opens nothing", async () => {
    const tasks = chainTasks(8, true);
    (tasks[4] as StackPlanTask).kind = "enable";
    writePlan(tasks);
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: true }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/\btask 5\b[^\n]*premature_enable/i);
    expect(fake.creates).toEqual([]);
  });

  it("ASDLC-1/TC-18 require_flag false: unflagged chain is not rejected (depth cap still applies)", async () => {
    writePlan(chainTasks(8, false));
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: false }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(fake.creates.map((call) => call.head).sort()).toEqual(
      [1, 2, 3, 4, 5, 6].map(headOf).sort(),
    );
  });
});

const createdHeads = (fake: Fake): string[] => fake.creates.map((call) => call.head);

describe("ASDLC-1/AC-17 stackSubmit: total open vs new creations, chain order, defaults", () => {
  it.each([
    [
      "PRs 1..6 open",
      [1, 2, 3, 4, 5, 6].map((task) => ({ task, state: "open" as const })),
      [1, 2, 3, 4, 5, 6],
      [7, 8, 1],
    ],
    [
      "PR 1 merged, 2..6 open",
      [
        { task: 1, state: "merged" as const },
        ...[2, 3, 4, 5, 6].map((task) => ({ task, state: "open" as const })),
      ],
      [2, 3, 4, 5, 6, 7],
      [1, 8],
    ],
    [
      "PR 1 closed (unmerged), 2..6 open",
      [
        { task: 1, state: "closed" as const },
        ...[2, 3, 4, 5, 6].map((task) => ({ task, state: "open" as const })),
      ],
      null,
      [7, 8],
    ],
  ])(
    "ASDLC-1/TC-18 resubmit with %s caps total open PRs",
    async (_label, preset, expected, excluded) => {
      const fake = fakeProvider(preset);
      const result = await stackSubmit(ID, config({ require_flag: true }), {
        cwd: repo,
        provider: fake,
      });
      expect(result.ok).toBe(true);
      const heads = new Set(createdHeads(fake));
      if (expected !== null) expect(heads).toEqual(new Set(expected.map(headOf)));
      for (const task of excluded) {
        if (expected?.includes(task) !== true) expect(heads.has(headOf(task))).toBe(false);
      }
    },
  );

  it("ASDLC-1/TC-18 8 independent tasks, require_flag false, max_depth 6: all 8 heads created", async () => {
    writePlan(independentTasks(8));
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: false }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(new Set(createdHeads(fake))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(headOf)));
  });

  it("ASDLC-1/TC-18 decreasing-id chain with head task-80 merged: opens task-70..task-20 only", async () => {
    writePlan(decreasingChain());
    const fake = fakeProvider([{ task: 80, state: "merged", base: "main" }]);
    const result = await stackSubmit(ID, config({ require_flag: true }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(new Set(createdHeads(fake))).toEqual(new Set([70, 60, 50, 40, 30, 20].map(headOf)));
    expect(createdHeads(fake)).not.toContain(headOf(10));
    expect(createdHeads(fake)).not.toContain(headOf(80));
  });

  it("ASDLC-1/TC-18 default max_depth (no stack.sizing.max_depth) is 6", async () => {
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: true, sizing: {} }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(new Set(createdHeads(fake))).toEqual(new Set([1, 2, 3, 4, 5, 6].map(headOf)));
    expect(createdHeads(fake).length).toBe(6);
  });
});

describe("ASDLC-1/AC-17 stackSubmit require_flag absent or false", () => {
  // Decision note (needs human confirmation, docs fix belongs to task 42): accord-schema.json and
  // okf/references/stack-config.md say require_flag "Default: true", but existing stack-service tests
  // submit unflagged plans with require_flag absent and expect ok. These tests pin absent = off.
  it("ASDLC-1/TC-18 require_flag absent on an unflagged 8-chain: ok, creates heads 1..6", async () => {
    writePlan(chainTasks(8, false));
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({}), { cwd: repo, provider: fake });
    expect(result.ok).toBe(true);
    expect(new Set(createdHeads(fake))).toEqual(new Set([1, 2, 3, 4, 5, 6].map(headOf)));
  });

  it("ASDLC-1/TC-18 require_flag false ignores a premature enable and a missing flag", async () => {
    const tasks = chainTasks(8, true);
    (tasks[1] as StackPlanTask).kind = "enable";
    delete (tasks[2] as StackPlanTask).flag;
    writePlan(tasks);
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: false }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(true);
    expect(new Set(createdHeads(fake))).toEqual(new Set([1, 2, 3, 4, 5, 6].map(headOf)));
  });
});

describe("ASDLC-1/AC-17 stackSubmit reports every violation, validates before any side effect", () => {
  it.each([
    [
      "final task 8 missing enable",
      (tasks: StackPlanTask[]) => delete (tasks[7] as StackPlanTask).kind,
      [/\btask 8\b[^\n]*missing_enable/i],
    ],
    [
      "out-of-window task 7 missing flag",
      (tasks: StackPlanTask[]) => delete (tasks[6] as StackPlanTask).flag,
      [/\btask 7\b[^\n]*missing_flag/i],
    ],
    [
      "tasks 2 and 7 missing flags",
      (tasks: StackPlanTask[]) => {
        delete (tasks[1] as StackPlanTask).flag;
        delete (tasks[6] as StackPlanTask).flag;
      },
      [/\btask 2\b[^\n]*missing_flag/i, /\btask 7\b[^\n]*missing_flag/i],
    ],
  ])("ASDLC-1/TC-18 %s", async (_label, mutate, patterns) => {
    const tasks = chainTasks(8, true);
    mutate(tasks);
    writePlan(tasks);
    git("add", "-A");
    git("commit", "-q", "-m", "mutate plan");
    const fake = fakeProvider();
    const result = await stackSubmit(ID, config({ require_flag: true }), {
      cwd: repo,
      provider: fake,
    });
    expect(result.ok).toBe(false);
    for (const pattern of patterns) expect(result.text).toMatch(pattern);
    expect(fake.creates).toEqual([]);
    expect(fake.mapCalls).toBe(0);
    expect(fake.statusCalls).toBe(0);
    expect(git("branch", "--list", "accord/*").trim()).toBe("");
  });
});
