import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";

// Real git repos plus shims: several seconds per scenario on a loaded machine.
setDefaultTimeout(60_000);

import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
import type { DevHarnessConfig } from "../src/config/types.js";
import { computeStack } from "../src/stack/compute-stack.js";
import { openablePrs, validateFlags } from "../src/stack/depth.js";
import { createGhStackProvider } from "../src/stack/gh-provider.js";
import { advanceStack } from "../src/stack/merge-bottom-up.js";
import type { CreateOrUpdatePrInput, StackPr, StackProvider } from "../src/stack/provider.js";
import { stackSubmit } from "../src/stack/service.js";
import type { StackPlanTask } from "../src/stack/types.js";
import { loadWorkItem } from "../src/work-items/io.js";

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
    if (flag === undefined) Reflect.deleteProperty(target, "flag");
    else target.flag = flag;
    expect(validateFlags({ tasks }, true)).toEqual({
      ok: false,
      violations: [{ task: 2, rule: "missing_flag" }],
    });
  });

  it("ASDLC-1/TC-18 every unflagged non-final task is reported, sorted by task", () => {
    const tasks = chainTasks(5, true);
    Reflect.deleteProperty(tasks[3] as StackPlanTask, "flag");
    Reflect.deleteProperty(tasks[0] as StackPlanTask, "flag");
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
    Reflect.deleteProperty(tasks[3] as StackPlanTask, "kind");
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
      if (task.id === 10) Reflect.deleteProperty(task, "kind");
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
    for (const task of tasks)
      if (task.id === 1 || task.id === 4) Reflect.deleteProperty(task, "flag");
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
    Reflect.deleteProperty(target, "flag");
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
    Reflect.deleteProperty(tasks[2] as StackPlanTask, "flag");
    expect(validateFlags({ tasks }, true)).toEqual({ ok: true, violations: [] });
  });

  it("ASDLC-1/TC-18 require_flag false ignores enable/flag rules on any plan shape", () => {
    const tasks = chainTasks(8, true);
    (tasks[1] as StackPlanTask).kind = "enable";
    Reflect.deleteProperty(tasks[2] as StackPlanTask, "flag");
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
  retargets: { pr: number; base: string }[];
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
    retargets: [],
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
    async retarget(pr, base) {
      fake.retargets.push({ pr, base });
      for (const [head, entry] of prs) if (entry.number === pr) prs.set(head, { ...entry, base });
    },
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
    Reflect.deleteProperty(tasks[2] as StackPlanTask, "flag");
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
    Reflect.deleteProperty(tasks[2] as StackPlanTask, "flag");
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
      (tasks: StackPlanTask[]) => Reflect.deleteProperty(tasks[7] as StackPlanTask, "kind"),
      [/\btask 8\b[^\n]*missing_enable/i],
    ],
    [
      "out-of-window task 7 missing flag",
      (tasks: StackPlanTask[]) => Reflect.deleteProperty(tasks[6] as StackPlanTask, "flag"),
      [/\btask 7\b[^\n]*missing_flag/i],
    ],
    [
      "tasks 2 and 7 missing flags",
      (tasks: StackPlanTask[]) => {
        Reflect.deleteProperty(tasks[1] as StackPlanTask, "flag");
        Reflect.deleteProperty(tasks[6] as StackPlanTask, "flag");
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

// ---------------------------------------------------------------------------------------------
// Task 41: bottom-up merge. Pinned contract (spec leaves shapes open):
//  advanceStack(workItemId, devConfig, { cwd, provider? }) -> Promise<{ ok, text }>, same shape as
//  stackSubmit. With no provider it resolves one from stack.provider (gh). Does nothing and returns
//  { ok: false, text: /stack.enabled is false/ } when stack.enabled is false.
//  For each open task PR whose base PR (provider.listPrs state "all") is merged it:
//   brings in the MERGED main (GitHub merged the base, local main may be stale: the impl fetches
//   origin; either `main` or `origin/main` may appear in the `git merge` call), checks out the child
//   branch, runs `git merge` (never rebase/amend/reset/force), resolves conflicts by the rule, makes
//   a merge commit, pushes the child branch without force (provider.pushBranch or git push), calls
//   provider.retarget(prNumber, "main"), restores the branch that was checked out before, then
//   submits the next queued PR (stackSubmit semantics: PR 7 of the depth-6 chain once PR 1 merged).
//  Rule: for each conflicted path, if `main:<path>` equals the base PR head blob, keep the child's
//   version; any other conflict (including a path absent from the base head, or an unreadable base
//   head) aborts the merge (no MERGE_HEAD, tree clean, child tip unchanged, nothing pushed/retargeted/
//   opened) and appends to .tasks/<ID>.json decisions[] a { status: "pending" } entry whose question
//   names the path. Result is { ok: false } with the path in text. A second run adds no decision.
//  provider.retarget(pr, base) -> gh: `gh pr edit <pr> --base <base>`.
// ---------------------------------------------------------------------------------------------

const REAL_GIT = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const US = "\x1f";
const RS = "\x1e";

interface Shim {
  dir: string;
  log: string;
  calls(tool: "git" | "gh"): string[][];
  order(): { tool: string; args: string[] }[];
}

function installShims(): { shim: Shim; restore: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-shim-")));
  cleanups.push(dir);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  const origin = originDir();
  // fetch-like commands reach the local bare origin even though the remote URL stays on GitHub.
  const viaOrigin = `exec "${REAL_GIT}" -c url.${origin}.insteadOf=https://github.com/o/r.git "$@"`;
  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh\nprintf 'git\\037' >> "${log}"; printf '%s\\037' "$@" >> "${log}"; printf '\\036' >> "${log}"\ncase "$1" in\n  fetch|pull|ls-remote) ${viaOrigin};;\n  remote) if [ "$2" = update ]; then ${viaOrigin}; fi;;\nesac\nexec "${REAL_GIT}" "$@"\n`,
  );
  const prList = [201, 202, 203, 204, 205, 206].map((number) => ({
    number,
    url: `https://github.com/o/r/pull/${number}`,
    state: number === 201 ? "MERGED" : "OPEN",
    headRefName: headOf(number - 200),
    baseRefName: number <= 202 ? (number === 201 ? "main" : headOf(1)) : headOf(number - 201),
  }));
  writeFileSync(join(dir, "pr-list.json"), JSON.stringify(prList));
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh\nprintf 'gh\\037' >> "${log}"; printf '%s\\037' "$@" >> "${log}"; printf '\\036' >> "${log}"\ncase "$1 $2" in\n  "pr list") cat "${join(dir, "pr-list.json")}";;\n  "pr edit") sed "s|\\(\\"number\\":$3,[^}]*\\"baseRefName\\":\\)\\"[^\\"]*\\"|\\1\\"$5\\"|" "${join(dir, "pr-list.json")}" > "${join(dir, "pr-list.tmp")}" && mv "${join(dir, "pr-list.tmp")}" "${join(dir, "pr-list.json")}";;\n  "pr create") echo https://github.com/o/r/pull/207;;\n  "api "*) case "$*" in *"/status"*) printf '{}';; *) printf '[]';; esac;;\nesac\nexit 0\n`,
  );
  chmodSync(join(dir, "git"), 0o755);
  chmodSync(join(dir, "gh"), 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${dir}:${priorPath}`;
  const order = () =>
    readFileSync(log, "utf8")
      .split(RS)
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.split(US).filter((part) => part.length > 0))
      .map((parts) => ({ tool: parts[0] as string, args: parts.slice(1) }));
  return {
    shim: {
      dir,
      log,
      calls: (tool) =>
        order()
          .filter((entry) => entry.tool === tool)
          .map((entry) => entry.args),
      order,
    },
    restore() {
      process.env.PATH = priorPath;
    },
  };
}

function originDir(): string {
  const key = git("config", "--get-regexp", "^url\\..*\\.pushinsteadof$").split(/\s/)[0] as string;
  return key.slice("url.".length, -".pushinsteadof".length);
}
function originRef(branch: string): string {
  try {
    return execFileSync("git", ["rev-parse", `refs/heads/${branch}`], {
      cwd: originDir(),
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}
const sha = (ref: string): string => git("rev-parse", ref).trim();
const currentBranch = (): string => git("symbolic-ref", "--short", "HEAD").trim();
function commitFiles(files: Record<string, string>, message: string): void {
  for (const [path, content] of Object.entries(files)) write(join(repo, path), content);
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

/** Work in a throwaway clone of origin, as GitHub does when it merges a PR. Local main stays stale. */
function originWork(steps: (run: (...args: string[]) => string) => void): void {
  const clone = realpathSync(mkdtempSync(join(tmpdir(), "accord-origin-work-")));
  cleanups.push(clone);
  const run = (...args: string[]): string =>
    execFileSync(
      REAL_GIT,
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: clone, encoding: "utf8" },
    );
  execFileSync(REAL_GIT, ["clone", "-q", "-b", "main", originDir(), clone]);
  steps(run);
}

type BaseMode = "squash" | "rebase" | "merge-commit";
interface Scenario {
  mode: BaseMode;
  baseFiles: Record<string, string>;
  childFiles: Record<string, string>;
  mainAfter?: Record<string, string>;
}
interface Built {
  childBefore: string;
  baseHead: string;
  /** origin's main after the base PR merged (local main is still the pre-merge commit). */
  mainTip: string;
}

// Main-side work outside the base PR: a new file and an edit to an existing file.
const MAIN_EXTRA = { "src/other.ts": "other pr\n", "README.md": "# repo\nmain edit\n" };
function expectMainWork(branch: string): void {
  expect(git("show", `${branch}:src/other.ts`)).toBe("other pr\n");
  expect(git("show", `${branch}:README.md`)).toBe("# repo\nmain edit\n");
}

function buildScenario(scenario: Scenario): Built {
  git("checkout", "-q", "-b", headOf(1), "main");
  commitFiles(scenario.baseFiles, "base 1");
  commitFiles({ "src/base-extra.ts": "extra\n" }, "base 2");
  const baseHead = sha(headOf(1));
  git("checkout", "-q", "-b", headOf(2));
  commitFiles({ "src/t2.ts": "t2\n", ...scenario.childFiles }, "child");
  const childBefore = sha(headOf(2));
  for (const branch of [headOf(1), headOf(2)]) {
    git("push", "-q", "origin", `refs/heads/${branch}:refs/heads/${branch}`);
  }
  // GitHub merges the base PR onto origin's main; local main is not updated.
  originWork((run) => {
    if (scenario.mode === "squash") {
      run("merge", "-q", "--squash", `origin/${headOf(1)}`);
      run("commit", "-q", "-m", "base (#1)");
    } else if (scenario.mode === "rebase") {
      // A rebase merge rewrites commits. Pin a distinct committer date so the rewritten shas can
      // never equal the originals when both run in the same second (that made the test flaky).
      const previousDate = process.env.GIT_COMMITTER_DATE;
      process.env.GIT_COMMITTER_DATE = "2030-01-01T00:00:00Z";
      try {
        run("cherry-pick", `main..origin/${headOf(1)}`);
      } finally {
        if (previousDate === undefined) delete process.env.GIT_COMMITTER_DATE;
        else process.env.GIT_COMMITTER_DATE = previousDate;
      }
    } else {
      run("merge", "-q", "--no-ff", "-m", "Merge base", `origin/${headOf(1)}`);
    }
    if (scenario.mainAfter) {
      for (const [path, content] of Object.entries(scenario.mainAfter)) {
        const full = join(run("rev-parse", "--show-toplevel").trim(), path);
        write(full, content);
      }
      run("add", "-A");
      run("commit", "-q", "-m", "main moves on");
    }
    run("push", "-q", "origin", "main");
  });
  git("checkout", "-q", "-b", "scratch", "main");
  return { childBefore, baseHead, mainTip: originRef("main") };
}

function seedWorkItem(decisions: unknown[] = []): void {
  mkdirSync(join(repo, ".tasks"), { recursive: true });
  write(join(repo, ".git", "info", "exclude"), ".tasks/\n");
  write(
    join(repo, ".tasks", `${ID}.json`),
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Bottom-up",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1, 2, 3, 4, 5, 6, 7, 8],
      spec: null,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: null,
      decisions,
      deviations: [],
      cost_usd: 0,
    }),
  );
}

function pushingFake(preset: Parameters<typeof fakeProvider>[0]): Fake {
  const fake = fakeProvider(preset);
  // Real non-force push so the origin ref can be observed.
  fake.pushBranch = async ({ branch }) => {
    // Branches of other open PRs (and newly queued ones) have no local fixture ref: nothing to push.
    try {
      git("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    } catch {
      return;
    }
    git("push", "origin", `refs/heads/${branch}:refs/heads/${branch}`);
  };
  return fake;
}

const CHAIN_PRESET: Parameters<typeof fakeProvider>[0] = [
  { task: 1, state: "merged" },
  { task: 2, state: "open" },
  { task: 3, state: "open" },
  { task: 4, state: "open" },
  { task: 5, state: "open" },
  { task: 6, state: "open" },
];

function forbiddenGitCalls(
  calls: string[][],
  protectedBranches: string[] = [headOf(2)],
): string[][] {
  return calls.filter((args) => {
    const command = args[0];
    const generic = args.some(
      (arg) =>
        arg === "rebase" ||
        arg === "--rebase" ||
        arg === "--amend" ||
        arg === "reset" ||
        arg === "-f" ||
        arg === "--force" ||
        arg === "--force-with-lease" ||
        arg === "--mirror" ||
        arg === "filter-branch" ||
        arg.startsWith("--force") ||
        (arg.startsWith("+") && arg.includes(":")),
    );
    const prunePush = command === "push" && args.includes("--prune");
    const shortForce = command === "push" && args.some((arg) => /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg));
    const touchesProtected = args.some((arg) =>
      protectedBranches.some(
        (branch) =>
          arg === branch ||
          arg === `refs/heads/${branch}` ||
          arg === `:${branch}` ||
          arg === `:refs/heads/${branch}`,
      ),
    );
    const rewrite =
      touchesProtected &&
      (command === "update-ref" ||
        (command === "branch" &&
          args.some((arg) => /^(-f|-D|-d|-M|-m|--delete|--move)$/.test(arg))) ||
        (command === "checkout" && args.includes("-B")) ||
        (command === "switch" && args.includes("-C")) ||
        (command === "push" && args.some((arg) => arg.startsWith(":") || arg === "--delete")));
    return generic || prunePush || shortForce || rewrite;
  });
}

async function advance(
  fake: Fake | undefined,
  extra: Record<string, unknown> = {},
): Promise<{ result: { ok: boolean; text: string }; shim: Shim }> {
  const { shim, restore } = installShims();
  try {
    const result = await advanceStack(ID, config({ require_flag: true, ...extra }), {
      cwd: repo,
      ...(fake ? { provider: fake } : {}),
    });
    return { result, shim };
  } finally {
    restore();
  }
}

function parentsOf(ref: string): string[] {
  return git("rev-list", "--parents", "-n", "1", ref).trim().split(" ").slice(1);
}
const mergesMain = (calls: string[][]): boolean =>
  calls.some(
    (args) => args[0] === "merge" && (args.includes("main") || args.includes("origin/main")),
  );

function expectStopped(built: Built, fake: Fake, calls: string[][]): void {
  expect(sha(headOf(2))).toBe(built.childBefore);
  expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
  expect(git("status", "--porcelain", "--untracked-files=no").trim()).toBe("");
  expect(originRef(headOf(2))).toBe(built.childBefore);
  expect(fake.retargets).toEqual([]);
  expect(fake.creates).toEqual([]);
  expect(forbiddenGitCalls(calls)).toEqual([]);
}

describe("ASDLC-1/AC-17 advanceStack merges main into the next PR (squash base)", () => {
  const base = { "src/t1.ts": "base v1\n", "src/u.ts": "u v1\n" };
  const child = { "src/t1.ts": "base v1\nchild line\n", "src/u.ts": "u v1\nchild u\n" };

  beforeEach(() => seedWorkItem());

  it("ASDLC-1/TC-18 add/add on paths where main equals base head keeps the child's version, merges, pushes, retargets and opens PR 7", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: base,
      childFiles: child,
      mainAfter: MAIN_EXTRA,
    });
    // Local main is stale: the merged base lives only on origin.
    expect(sha("main")).not.toBe(built.mainTip);
    const fake = pushingFake(CHAIN_PRESET);
    const { result, shim } = await advance(fake);

    expect(result.ok).toBe(true);
    const tip = sha(headOf(2));
    // Real merge commit: two parents, one is the MERGED main tip, one is the old child tip.
    expect(parentsOf(headOf(2)).sort()).toEqual([built.mainTip, built.childBefore].sort());
    expect(git("show", `${headOf(2)}:src/t1.ts`)).toBe("base v1\nchild line\n");
    expect(git("show", `${headOf(2)}:src/u.ts`)).toBe("u v1\nchild u\n");
    expect(git("show", `${headOf(2)}:src/t2.ts`)).toBe("t2\n");
    expect(git("show", `${headOf(2)}:src/base-extra.ts`)).toBe("extra\n");
    // Main's own work outside the base PR is carried, not dropped.
    expectMainWork(headOf(2));
    expect(git("status", "--porcelain", "--untracked-files=no").trim()).toBe("");
    expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
    // Pushed without force: origin has the merge commit as a fast-forward of the old tip.
    expect(originRef(headOf(2))).toBe(tip);
    expect(
      execFileSync(REAL_GIT, ["merge-base", "--is-ancestor", built.childBefore, tip], {
        cwd: originDir(),
      }),
    ).toBeDefined();
    // Retargeted PR 202 to main, next queued PR 7 opened.
    expect(fake.retargets).toEqual([{ pr: 202, base: "main" }]);
    expect(fake.prs.get(headOf(2))?.base).toBe("main");
    expect(fake.creates.map((call) => call.head)).toContain(headOf(7));
    expect(fake.creates.map((call) => call.head)).not.toContain(headOf(8));
    expect(fake.creates.find((call) => call.head === headOf(7))?.base).toBe(headOf(6));
    expect(mergesMain(shim.calls("git"))).toBe(true);
    expect(forbiddenGitCalls(shim.calls("git"))).toEqual([]);
    expect(git("reflog", "--format=%gs", headOf(2))).not.toMatch(/amend|reset|rebase/);
    // No decision for a rule-resolved conflict.
    expect(loadWorkItem(ID, repo)?.decisions).toEqual([]);
    // The branch checked out before the advance is checked out again.
    expect(currentBranch()).toBe("scratch");

    // F-011: advancing again is a no-op (the PR is already on main).
    const again = await advance(fake);
    expect(again.result.ok).toBe(true);
    expect(sha(headOf(2))).toBe(tip);
    expect(fake.retargets).toEqual([{ pr: 202, base: "main" }]);
    expect(currentBranch()).toBe("scratch");
  });

  it("ASDLC-1/TC-18 a squash base where only one file overlaps resolves that file, still merges the rest and carries main's work", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: { "src/t1.ts": "base v1\nchild line\n" },
      mainAfter: MAIN_EXTRA,
    });
    const fake = pushingFake(CHAIN_PRESET);
    const { result } = await advance(fake);
    expect(result.ok).toBe(true);
    expect(parentsOf(headOf(2)).sort()).toEqual([built.mainTip, built.childBefore].sort());
    expect(git("show", `${headOf(2)}:src/t1.ts`)).toBe("base v1\nchild line\n");
    expect(git("show", `${headOf(2)}:src/t2.ts`)).toBe("t2\n");
    expect(git("show", `${headOf(2)}:src/base-extra.ts`)).toBe("extra\n");
    expectMainWork(headOf(2));
    expect(fake.retargets).toEqual([{ pr: 202, base: "main" }]);
  });

  it("ASDLC-1/TC-18 a conflicted path where main differs from the base PR head stops the advance and raises a decision", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: base,
      childFiles: child,
      mainAfter: { "src/t1.ts": "base v1\nhotfix on main\n" },
    });
    const fake = pushingFake(CHAIN_PRESET);
    const { result, shim } = await advance(fake);

    expect(result.ok).toBe(false);
    expect(result.text).toContain("src/t1.ts");
    expectStopped(built, fake, shim.calls("git"));
    expect(fake.prs.get(headOf(2))?.base).toBe(headOf(1));
    // decisions[] entry, never a silent resolution.
    const decisions = loadWorkItem(ID, repo)?.decisions ?? [];
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.status).toBe("pending");
    expect(decisions[0]?.question).toContain("src/t1.ts");
    expect(decisions[0]?.question).not.toContain("src/u.ts");
    expect(currentBranch()).toBe("scratch");
  });

  it("ASDLC-1/TC-18 the decision is appended to existing decisions with the full Decision shape", async () => {
    const seed = {
      id: "other-1",
      source: "needs_input",
      status: "pending",
      question: "Pick a DB?",
      asked_at: "2026-01-01T00:00:00.000Z",
    };
    seedWorkItem([seed]);
    buildScenario({
      mode: "squash",
      baseFiles: base,
      childFiles: child,
      mainAfter: { "src/t1.ts": "base v1\nhotfix on main\n" },
    });
    const { result } = await advance(pushingFake(CHAIN_PRESET));
    expect(result.ok).toBe(false);
    const decisions = loadWorkItem(ID, repo)?.decisions ?? [];
    expect(decisions.length).toBe(2);
    expect(decisions[0]).toEqual(seed);
    expect(decisions[1]).toMatchObject({
      id: expect.any(String),
      source: expect.any(String),
      status: "pending",
      question: expect.stringContaining("src/t1.ts"),
      asked_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(decisions[1]?.id).not.toBe("other-1");
  });

  it("ASDLC-1/TC-18 one resolvable and one differing conflict: the whole advance stops, nothing is partly resolved", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: base,
      childFiles: child,
      mainAfter: { "src/u.ts": "u v1\nhotfix on main\n" },
    });
    const fake = pushingFake(CHAIN_PRESET);
    const { result, shim } = await advance(fake);

    expect(result.ok).toBe(false);
    expectStopped(built, fake, shim.calls("git"));
    const decisions = loadWorkItem(ID, repo)?.decisions ?? [];
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.question).toContain("src/u.ts");
    expect(decisions[0]?.question).not.toContain("src/t1.ts");
  });

  it("ASDLC-1/TC-18 running advance again after a stop stops again without duplicating the decision", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: base,
      childFiles: child,
      mainAfter: { "src/t1.ts": "base v1\nhotfix on main\n" },
    });
    const fake = pushingFake(CHAIN_PRESET);
    const first = await advance(fake);
    const second = await advance(fake);
    expect(first.result.ok).toBe(false);
    expect(second.result.ok).toBe(false);
    expect(second.result.text).toContain("src/t1.ts");
    expectStopped(built, fake, second.shim.calls("git"));
    const decisions = loadWorkItem(ID, repo)?.decisions ?? [];
    expect(decisions.length).toBe(1);
    expect(decisions[0]?.status).toBe("pending");
  });

  // Resolution rule partitions: the child's version is kept only when main:<path> equals the base
  // PR head blob; every other conflict stops.
  it.each([
    {
      label: "path missing from the base head",
      mode: "squash" as BaseMode,
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: {},
      mainAfter: { "src/t2.ts": "main t2\n" },
      ok: false,
      path: "src/t2.ts",
    },
    {
      label: "main is a prefix (deletion) of the child",
      mode: "squash" as BaseMode,
      baseFiles: { "src/t1.ts": "a\nb\n" },
      childFiles: { "src/t1.ts": "a\nb\nc\n" },
      mainAfter: { "src/t1.ts": "a\n" },
      ok: false,
      path: "src/t1.ts",
    },
    {
      label: "child rewrote the file, main equals base head",
      mode: "squash" as BaseMode,
      baseFiles: { "src/t1.ts": "base v1\nold\n" },
      childFiles: { "src/t1.ts": "new\n" },
      ok: true,
      file: ["src/t1.ts", "new\n"],
    },
    {
      label: "modify/modify on an existing file, main equals base head",
      mode: "squash" as BaseMode,
      baseFiles: { "README.md": "# repo base\n" },
      childFiles: { "README.md": "# repo base child\n" },
      ok: true,
      file: ["README.md", "# repo base child\n"],
    },
    {
      label: "rebase base, child edited a base-added file",
      mode: "rebase" as BaseMode,
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: { "src/t1.ts": "base v1\nchild line\n" },
      ok: true,
      file: ["src/t1.ts", "base v1\nchild line\n"],
    },
    {
      label: "base head ref is gone",
      mode: "squash" as BaseMode,
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: { "src/t1.ts": "base v1\nchild line\n" },
      gone: true,
      ok: false,
      path: undefined,
    },
  ] as {
    label: string;
    mode: BaseMode;
    baseFiles: Record<string, string>;
    childFiles: Record<string, string>;
    mainAfter?: Record<string, string>;
    gone?: boolean;
    ok: boolean;
    path?: string;
    file?: [string, string];
  }[])("ASDLC-1/TC-18 rule partition: $label", async (row) => {
    const built = buildScenario(row);
    if (row.gone) {
      git("branch", "-q", "-D", headOf(1));
      execFileSync(REAL_GIT, ["branch", "-q", "-D", headOf(1)], { cwd: originDir() });
      execFileSync(REAL_GIT, ["update-ref", "-d", `refs/remotes/origin/${headOf(1)}`], {
        cwd: repo,
      });
    }
    const fake = pushingFake(CHAIN_PRESET);
    const { result, shim } = await advance(fake);
    expect(result.ok).toBe(row.ok);
    const decisions = loadWorkItem(ID, repo)?.decisions ?? [];
    if (row.ok) {
      expect(parentsOf(headOf(2)).sort()).toEqual([built.mainTip, built.childBefore].sort());
      const [path, content] = row.file as [string, string];
      expect(git("show", `${headOf(2)}:${path}`)).toBe(content);
      expect(decisions).toEqual([]);
      expect(fake.retargets).toEqual([{ pr: 202, base: "main" }]);
      expect(originRef(headOf(2))).toBe(sha(headOf(2)));
      expect(forbiddenGitCalls(shim.calls("git"))).toEqual([]);
    } else {
      expectStopped(built, fake, shim.calls("git"));
      expect(decisions.length).toBe(1);
      expect(decisions[0]?.status).toBe("pending");
      if (row.path) expect(decisions[0]?.question).toContain(row.path);
    }
  });
});

describe("ASDLC-1/AC-17 advanceStack with rebase-merged and merge-commit bases", () => {
  beforeEach(() => seedWorkItem());

  // A rebase-merge rewrites the base commits; a child edit of a base-added file is an add/add
  // conflict resolved by the rule (see the rule partition table above).
  const cases: { mode: BaseMode; childFiles: Record<string, string> }[] = [
    { mode: "rebase", childFiles: {} },
    { mode: "merge-commit", childFiles: { "src/t1.ts": "base v1\nchild line\n" } },
  ];

  for (const { mode, childFiles } of cases) {
    it(`ASDLC-1/TC-18 ${mode} base merges cleanly: merge commit, no decision, push without force, retarget, open PR 7`, async () => {
      const built = buildScenario({
        mode,
        baseFiles: { "src/t1.ts": "base v1\n" },
        childFiles,
        mainAfter: MAIN_EXTRA,
      });
      const fake = pushingFake(CHAIN_PRESET);
      const { result, shim } = await advance(fake);

      expect(result.ok).toBe(true);
      expect(parentsOf(headOf(2)).sort()).toEqual([built.mainTip, built.childBefore].sort());
      expect(git("show", `${headOf(2)}:src/t2.ts`)).toBe("t2\n");
      expect(git("show", `${headOf(2)}:src/t1.ts`)).toBe(childFiles["src/t1.ts"] ?? "base v1\n");
      expectMainWork(headOf(2));
      expect(originRef(headOf(2))).toBe(sha(headOf(2)));
      expect(fake.retargets).toEqual([{ pr: 202, base: "main" }]);
      expect(fake.creates.map((call) => call.head)).toContain(headOf(7));
      expect(fake.creates.find((call) => call.head === headOf(7))?.base).toBe(headOf(6));
      expect(loadWorkItem(ID, repo)?.decisions).toEqual([]);
      expect(forbiddenGitCalls(shim.calls("git"))).toEqual([]);
      expect(git("status", "--porcelain", "--untracked-files=no").trim()).toBe("");
    });
  }

  it("ASDLC-1/TC-18 no base merged: nothing is merged, pushed, retargeted, and PR 7 stays closed", async () => {
    buildScenario({
      mode: "merge-commit",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: {},
    });
    const before = sha(headOf(2));
    const fake = pushingFake(
      CHAIN_PRESET.map((entry) =>
        entry.task === 1 ? { ...entry, state: "open" as const } : entry,
      ),
    );
    const { result, shim } = await advance(fake);
    expect(result.ok).toBe(true);
    expect(sha(headOf(2))).toBe(before);
    expect(fake.retargets).toEqual([]);
    expect(fake.creates.map((call) => call.head)).not.toContain(headOf(7));
    expect(shim.calls("git").some((args) => args[0] === "merge")).toBe(false);
  });

  it("ASDLC-1/TC-18 a closed (unmerged) base is not advanced", async () => {
    buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: {},
    });
    const before = sha(headOf(2));
    const fake = pushingFake(
      CHAIN_PRESET.map((entry) =>
        entry.task === 1 ? { ...entry, state: "closed" as const } : entry,
      ),
    );
    const { result, shim } = await advance(fake);
    expect(result.ok).toBe(true);
    expect(shim.calls("git").some((args) => args[0] === "merge")).toBe(false);
    expect(sha(headOf(2))).toBe(before);
    expect(fake.retargets).toEqual([]);
    expect(fake.creates.map((call) => call.head)).not.toContain(headOf(7));
  });

  it("ASDLC-1/TC-18 a PR whose base is still open is left alone while its sibling advances", async () => {
    buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: {},
    });
    git("checkout", "-q", "-b", headOf(3), headOf(2));
    commitFiles({ "src/t3.ts": "t3\n" }, "child 3");
    const task3Before = sha(headOf(3));
    git("checkout", "-q", "scratch");
    const fake = pushingFake(CHAIN_PRESET);
    const { result } = await advance(fake);
    expect(result.ok).toBe(true);
    expect(sha(headOf(3))).toBe(task3Before);
    expect(fake.retargets).toEqual([{ pr: 202, base: "main" }]);
  });

  it("ASDLC-1/TC-18 second chain level: after PRs 1 and 2 merged, PR 3 gets main merged, is retargeted and PR 8 opens", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: {},
    });
    git("checkout", "-q", "-b", headOf(3), headOf(2));
    commitFiles({ "src/t2.ts": "t2\nt3 edit\n", "src/t3.ts": "t3\n" }, "child 3");
    git("push", "-q", "origin", `refs/heads/${headOf(3)}:refs/heads/${headOf(3)}`);
    const task3Before = sha(headOf(3));
    git("checkout", "-q", "scratch");
    // GitHub: task-2 is advanced (main merged in), then squash-merged onto main.
    originWork((run) => {
      run("checkout", "-q", "-b", "t2-adv", `origin/${headOf(2)}`);
      run("merge", "-q", "-X", "ours", "-m", "advance", "main");
      run("push", "-q", "origin", `t2-adv:refs/heads/${headOf(2)}`);
      run("checkout", "-q", "main");
      run("merge", "-q", "--squash", "t2-adv");
      run("commit", "-q", "-m", "task 2 (#2)");
      run("push", "-q", "origin", "main");
    });
    const mainTip = originRef("main");
    expect(mainTip).not.toBe(built.mainTip);
    const fake = pushingFake([
      { task: 1, state: "merged" },
      { task: 2, state: "merged" },
      ...[3, 4, 5, 6, 7].map((task) => ({ task, state: "open" as const })),
    ]);
    const { result, shim } = await advance(fake);
    expect(result.ok).toBe(true);
    expect(parentsOf(headOf(3)).sort()).toEqual([mainTip, task3Before].sort());
    expect(git("show", `${headOf(3)}:src/t2.ts`)).toBe("t2\nt3 edit\n");
    expect(git("show", `${headOf(3)}:src/t3.ts`)).toBe("t3\n");
    expect(fake.retargets).toEqual([{ pr: 203, base: "main" }]);
    expect(fake.creates.map((call) => call.head)).toContain(headOf(8));
    expect(fake.creates.find((call) => call.head === headOf(8))?.base).toBe(headOf(7));
    expect(originRef(headOf(3))).toBe(sha(headOf(3)));
    expect(forbiddenGitCalls(shim.calls("git"), [headOf(3)])).toEqual([]);
    expect(loadWorkItem(ID, repo)?.decisions).toEqual([]);
  });
});

describe("ASDLC-1/AC-17 advanceStack backward compatibility and production wiring", () => {
  beforeEach(() => seedWorkItem());

  it("ASDLC-1/TC-18 stack.enabled false: nothing is merged, pushed, retargeted or opened", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: { "src/t1.ts": "base v1\nchild line\n" },
    });
    const fake = pushingFake(CHAIN_PRESET);
    const { result, shim } = await advance(fake, { enabled: false });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/stack.enabled is false/);
    expect(shim.calls("git").some((args) => args[0] === "merge")).toBe(false);
    expect(shim.calls("git").some((args) => args[0] === "push")).toBe(false);
    expect(sha(headOf(2))).toBe(built.childBefore);
    expect(fake.retargets).toEqual([]);
    expect(fake.creates).toEqual([]);
  });

  it("ASDLC-1/TC-18 without an injected provider the gh provider retargets after the push", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: { "src/t1.ts": "base v1\nchild line\n" },
    });
    const { result, shim } = await advance(undefined);
    expect(result.ok).toBe(true);
    expect(parentsOf(headOf(2)).sort()).toEqual([built.mainTip, built.childBefore].sort());
    const retargets = shim
      .calls("gh")
      .filter((args) => args[0] === "pr" && args[1] === "edit" && args.includes("--base"));
    expect(retargets).toEqual([["pr", "edit", "202", "--base", "main"]]);
    const events = shim.order();
    const pushIndex = events.findIndex(
      (event) =>
        event.tool === "git" &&
        event.args[0] === "push" &&
        event.args.some((arg) => arg.includes(headOf(2))),
    );
    const retargetIndex = events.findIndex(
      (event) => event.tool === "gh" && event.args.includes("--base") && event.args[1] === "edit",
    );
    expect(pushIndex).toBeGreaterThanOrEqual(0);
    expect(retargetIndex).toBeGreaterThan(pushIndex);
    // ASDLC-1/AC-27: no gh call forces anything.
    expect(
      shim
        .calls("gh")
        .flat()
        .some((arg) => arg.startsWith("--force")),
    ).toBe(false);
    expect(forbiddenGitCalls(shim.calls("git"))).toEqual([]);
  });
});

describe("ASDLC-1/AC-27 advanceStack keeps evidence append-only", () => {
  beforeEach(() => seedWorkItem());

  it("ASDLC-1/AC-27 the old child tip stays an ancestor of the new tip and no git call rewrites or force-pushes", async () => {
    const built = buildScenario({
      mode: "squash",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: { "src/t1.ts": "base v1\nchild line\n" },
    });
    const fake = pushingFake(CHAIN_PRESET);
    const { result, shim } = await advance(fake);
    expect(result.ok).toBe(true);
    expect(sha(headOf(2))).not.toBe(built.childBefore);
    expect(() => git("merge-base", "--is-ancestor", built.childBefore, headOf(2))).not.toThrow();
    expect(forbiddenGitCalls(shim.calls("git"))).toEqual([]);
    const pushes = shim.calls("git").filter((args) => args[0] === "push");
    expect(pushes.length).toBeGreaterThan(0);
    // Success-path pushes are real fast-forwards of the pushed origin ref.
    expect(originRef(headOf(2))).toBe(sha(headOf(2)));
  });

  it("ASDLC-1/AC-27 a diverged remote child ref is never overwritten (push is not forced)", async () => {
    const built = buildScenario({
      mode: "merge-commit",
      baseFiles: { "src/t1.ts": "base v1\n" },
      childFiles: {},
    });
    // Remote child branch holds a commit the local branch lacks.
    originWork((run) => {
      run("checkout", "-q", "-b", "remote-side", `origin/${headOf(2)}`);
      write(join(run("rev-parse", "--show-toplevel").trim(), "src/remote-only.ts"), "r\n");
      run("add", "-A");
      run("commit", "-q", "-m", "remote only");
      run("push", "-q", "origin", `remote-side:refs/heads/${headOf(2)}`);
    });
    const remoteTip = originRef(headOf(2));
    expect(remoteTip).not.toBe(built.childBefore);
    const fake = pushingFake(CHAIN_PRESET);
    // The rejected non-fast-forward push is reported, not thrown, and nothing is forced.
    const { result, shim } = await advance(fake);
    expect(result.ok).toBe(false);
    expect(originRef(headOf(2))).toBe(remoteTip);
    expect(forbiddenGitCalls(shim.calls("git"))).toEqual([]);
    expect(fake.retargets).toEqual([]);
  });
});

describe("ASDLC-1/AC-17 gh provider retarget", () => {
  it("ASDLC-1/TC-18 retarget runs exactly `gh pr edit <pr> --base <base>`", async () => {
    const { shim, restore } = installShims();
    try {
      await createGhStackProvider({ cwd: repo }).retarget(202, "main");
    } finally {
      restore();
    }
    expect(shim.calls("gh")).toEqual([["pr", "edit", "202", "--base", "main"]]);
  });

  it("ASDLC-1/TC-18 retarget passes a hostile base verbatim as one argument", async () => {
    const { shim, restore } = installShims();
    try {
      await createGhStackProvider({ cwd: repo }).retarget(7, "main; rm -rf /");
    } finally {
      restore();
    }
    expect(shim.calls("gh")).toEqual([["pr", "edit", "7", "--base", "main; rm -rf /"]]);
  });
});
