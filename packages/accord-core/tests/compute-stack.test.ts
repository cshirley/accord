import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeStack } from "../src/stack/compute-stack.js";
import type { StackPlanTask, StackSizing } from "../src/stack/types.js";

const golden = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/stack/compute-stack.golden.json"), "utf8"),
) as {
  input: { plan: { tasks: StackPlanTask[] }; sizing: StackSizing };
  expected: ReturnType<typeof computeStack>;
};

const SIZING: StackSizing = {
  max_pr_lines: 400,
  min_pr_lines: 30,
  max_files: 10,
  max_depth: 6,
  merge_small_same_concern: true,
};

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function task(id: number, over: Partial<StackPlanTask> = {}, fileCount = 1): StackPlanTask {
  return {
    id,
    title: `task ${id}`,
    covers_ac: ["AC-1"],
    est_lines: 100,
    concern: `c${id}`,
    kind: "feature",
    depends_on: [],
    files: Array.from({ length: fileCount }, (_, k) => ({
      path: `src/t${id}/f${k}.ts`,
      action: "add",
    })),
    ...over,
  };
}

function groupsOf(tasks: StackPlanTask[], sizing: StackSizing = SIZING): number[][] {
  return computeStack({ tasks }, sizing)
    .prs.filter((pr) => pr.kind === "task")
    .map((pr) => pr.tasks);
}

describe("ASDLC-1/AC-10 computeStack golden plan (ASDLC-1/TC-11)", () => {
  test("ASDLC-1/AC-10 golden fixture output matches exactly", () => {
    expect(computeStack(golden.input.plan, golden.input.sizing)).toEqual(golden.expected);
  });

  test("ASDLC-1/AC-10 two runs give byte-identical JSON", () => {
    const first = JSON.stringify(computeStack(golden.input.plan, golden.input.sizing));
    const second = JSON.stringify(computeStack(golden.input.plan, golden.input.sizing));
    expect(first.length).toBeGreaterThan(100);
    expect(second).toBe(first);
  });

  test("ASDLC-1/AC-10 input task order does not change output and input is not mutated", () => {
    // Frozen input: any in-place write by computeStack throws TypeError (ESM is strict).
    const frozen = deepFreeze(structuredClone(golden.input));
    const shuffled = deepFreeze([...structuredClone(golden.input.plan.tasks)].reverse());
    const forward = JSON.stringify(computeStack(frozen.plan, frozen.sizing));
    const reversed = JSON.stringify(computeStack({ tasks: shuffled }, frozen.sizing));
    expect(reversed).toBe(forward);
    expect(shuffled.map((t) => t.id)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(JSON.stringify(frozen)).toBe(JSON.stringify(golden.input));
    expect(forward).toBe(JSON.stringify(golden.expected));
  });

  test("ASDLC-1/AC-10 PR count is 2 plus packed groups, PR0 first, closeout last", () => {
    const result = computeStack(golden.input.plan, golden.input.sizing);
    const taskGroups = result.prs.filter((pr) => pr.kind === "task");
    expect(taskGroups).toHaveLength(13);
    expect(result.pr_count).toBe(15);
    expect(result.prs).toHaveLength(15);
    expect(result.prs[0]).toEqual({ index: 0, kind: "contract", tasks: [] });
    expect(result.prs[result.prs.length - 1]).toEqual({
      index: 14,
      kind: "closeout",
      tasks: [],
    });
    expect(result.prs.map((pr) => pr.index)).toEqual(result.prs.map((_, position) => position));
  });
});

describe("ASDLC-1/AC-10 merge rules", () => {
  test("adjacent same-concern tasks below min_pr_lines merge within budget", () => {
    const tasks = [
      task(1, { est_lines: 10, concern: "a" }),
      task(2, { est_lines: 15, concern: "a" }),
    ];
    const result = computeStack({ tasks }, SIZING);
    expect(result.prs[1]).toMatchObject({ kind: "task", tasks: [1, 2], est_lines: 25 });
    expect(result.pr_count).toBe(3);
  });

  test("different concerns do not merge even when both are tiny", () => {
    const tasks = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "b" }),
    ];
    expect(groupsOf(tasks)).toEqual([[1], [2]]);
  });

  test("merge_small_same_concern=false disables merging", () => {
    const tasks = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "a" }),
    ];
    expect(groupsOf(tasks, { ...SIZING, merge_small_same_concern: false })).toEqual([[1], [2]]);
  });

  test("min_pr_lines boundary: 29 merges, 30 does not", () => {
    const small = (n: number) => [
      task(1, { est_lines: n, concern: "a" }),
      task(2, { est_lines: n, concern: "a" }),
    ];
    expect(groupsOf(small(29))).toEqual([[1, 2]]);
    expect(groupsOf(small(30))).toEqual([[1], [2]]);
  });

  test("max_pr_lines boundary on merge: combined 400 merges, 401 does not", () => {
    const pair = (second: number) => [
      task(1, { est_lines: 380, concern: "a" }),
      task(2, { est_lines: second, concern: "a" }),
    ];
    expect(groupsOf(pair(20))).toEqual([[1, 2]]);
    expect(groupsOf(pair(21))).toEqual([[1], [2]]);
  });

  test("merged files over max_files do not merge", () => {
    const tasks = [
      task(1, { est_lines: 5, concern: "a" }, 6),
      task(2, { est_lines: 5, concern: "a" }, 5),
    ];
    expect(groupsOf(tasks)).toEqual([[1], [2]]);
    const fits = [
      task(1, { est_lines: 5, concern: "a" }, 5),
      task(2, { est_lines: 5, concern: "a" }, 5),
    ];
    expect(groupsOf(fits)).toEqual([[1, 2]]);
  });

  test.each(["refactor", "schema"] as const)("%s task is never merged", (kind) => {
    const lead = [
      task(1, { est_lines: 5, concern: "a", kind }),
      task(2, { est_lines: 5, concern: "a" }),
    ];
    expect(groupsOf(lead)).toEqual([[1], [2]]);
    const trail = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "a", kind }),
    ];
    expect(groupsOf(trail)).toEqual([[1], [2]]);
  });

  test("flag task is never merged", () => {
    const lead = [
      task(1, { est_lines: 5, concern: "a", flag: "x" }),
      task(2, { est_lines: 5, concern: "a" }),
    ];
    expect(groupsOf(lead)).toEqual([[1], [2]]);
    const trail = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "a", flag: "x" }),
    ];
    expect(groupsOf(trail)).toEqual([[1], [2]]);
  });

  test("merged group sums est_lines and unions files", () => {
    const tasks = [
      task(1, { est_lines: 7, concern: "a" }, 2),
      task(2, { est_lines: 8, concern: "a" }, 3),
    ];
    expect(computeStack({ tasks }, SIZING).prs[1]).toMatchObject({
      tasks: [1, 2],
      est_lines: 15,
      files: 5,
      concern: "a",
    });
  });
});

describe("ASDLC-1/AC-10 flag for re-plan, never split", () => {
  test("est_lines boundary: 400 not flagged, 401 flagged alone and unsplit", () => {
    const ok = computeStack({ tasks: [task(1, { est_lines: 400 })] }, SIZING);
    expect(ok.flags).toEqual([]);
    const over = computeStack({ tasks: [task(1, { est_lines: 401 })] }, SIZING);
    expect(over.flags).toEqual([{ task: 1, reasons: ["max_pr_lines"] }]);
    expect(over.prs.filter((pr) => pr.kind === "task").map((pr) => pr.tasks)).toEqual([[1]]);
    expect(over.pr_count).toBe(3);
  });

  test("files boundary: 10 not flagged, 11 flagged alone and unsplit", () => {
    const ok = computeStack({ tasks: [task(1, { est_lines: 50 }, 10)] }, SIZING);
    expect(ok.flags).toEqual([]);
    const over = computeStack({ tasks: [task(1, { est_lines: 50 }, 11)] }, SIZING);
    expect(over.flags).toEqual([{ task: 1, reasons: ["max_files"] }]);
    expect(over.prs.filter((pr) => pr.kind === "task").map((pr) => pr.tasks)).toEqual([[1]]);
  });

  test("task over both limits lists both reasons", () => {
    const result = computeStack({ tasks: [task(1, { est_lines: 900 }, 12)] }, SIZING);
    expect(result.flags).toEqual([{ task: 1, reasons: ["max_pr_lines", "max_files"] }]);
  });

  test("flagged task is not merged with a small same-concern neighbour", () => {
    const tasks = [
      task(1, { est_lines: 500, concern: "a" }),
      task(2, { est_lines: 5, concern: "a" }),
    ];
    expect(groupsOf(tasks)).toEqual([[1], [2]]);
    expect(computeStack({ tasks }, SIZING).flags.map((flag) => flag.task)).toEqual([1]);
  });

  test("custom sizing limits are honoured", () => {
    const result = computeStack(
      { tasks: [task(1, { est_lines: 60 })] },
      { ...SIZING, max_pr_lines: 50 },
    );
    expect(result.flags).toEqual([{ task: 1, reasons: ["max_pr_lines"] }]);
  });
});

describe("ASDLC-1/AC-10 order and siblings", () => {
  test("independent tasks are siblings with no parent PR", () => {
    const result = computeStack({ tasks: [task(1), task(2), task(3)] }, SIZING);
    const groups = result.prs.filter((pr) => pr.kind === "task");
    expect(groups.map((pr) => pr.depends_on_prs)).toEqual([[], [], []]);
  });

  test("ASDLC-1/AC-10 ties among ready tasks break by smallest task id", () => {
    const tasks = [task(1, { depends_on: [3] }), task(2), task(3)];
    expect(groupsOf(tasks)).toEqual([[2], [3], [1]]);
  });

  test("a depends_on chain stacks each PR on its base PR", () => {
    const tasks = [task(1), task(2, { depends_on: [1] }), task(3, { depends_on: [2] })];
    const groups = computeStack({ tasks }, SIZING).prs.filter((pr) => pr.kind === "task");
    expect(groups.map((pr) => pr.depends_on_prs)).toEqual([[], [1], [2]]);
  });

  test("topological order holds when a low id depends on a high id", () => {
    const tasks = [task(1, { depends_on: [3] }), task(2), task(3, { depends_on: [2] })];
    const groups = groupsOf(tasks).flat();
    expect([...groups].sort()).toEqual([1, 2, 3]);
    expect(groups.indexOf(2)).toBeLessThan(groups.indexOf(3));
    expect(groups.indexOf(3)).toBeLessThan(groups.indexOf(1));
    const result = computeStack({ tasks }, SIZING);
    expect(result.prs[0]?.kind).toBe("contract");
    expect(result.prs[result.prs.length - 1]?.kind).toBe("closeout");
  });
});

const paths = (...names: string[]) => names.map((path) => ({ path, action: "add" }));
const prsOf = (tasks: StackPlanTask[], sizing: StackSizing = SIZING) =>
  computeStack({ tasks }, sizing).prs.filter((pr) => pr.kind === "task");

describe("ASDLC-1/AC-10 adjacency, group packing and overlap", () => {
  test("ASDLC-1/AC-10 non-adjacent same-concern tasks do not merge", () => {
    expect(
      groupsOf([
        task(1, { est_lines: 5, concern: "a" }),
        task(2, { est_lines: 5, concern: "b" }),
        task(3, { est_lines: 5, concern: "a" }),
      ]),
    ).toEqual([[1], [2], [3]]);
    const reordered = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "a", depends_on: [3] }),
      task(3, { est_lines: 5, concern: "b", depends_on: [1] }),
    ];
    expect(groupsOf(reordered)).toEqual([[1], [3], [2]]);
    expect(prsOf(reordered).map((pr) => pr.depends_on_prs)).toEqual([[], [1], [2]]);
  });

  test.each([
    {
      name: "three tiny tasks pack into one",
      lines: [10, 10, 10],
      fileCount: 1,
      expected: [[1, 2, 3]],
    },
    {
      name: "running total over budget splits third",
      lines: [10, 10, 385],
      fileCount: 1,
      expected: [[1, 2], [3]],
    },
    {
      name: "running files over max_files splits third",
      lines: [5, 5, 5],
      fileCount: 4,
      expected: [[1, 2], [3]],
    },
    {
      name: "group total (40) not below min: 100 starts a new group",
      lines: [20, 20, 100],
      fileCount: 1,
      expected: [[1, 2], [3]],
    },
    {
      name: "group total (155) not below min: 150 starts a new group",
      lines: [5, 150, 150],
      fileCount: 1,
      expected: [[1, 2], [3]],
    },
  ])("ASDLC-1/AC-10 group packing: $name", ({ lines, fileCount, expected }) => {
    const tasks = lines.map((est, offset) =>
      task(offset + 1, { est_lines: est, concern: "a" }, fileCount),
    );
    expect(groupsOf(tasks)).toEqual(expected as unknown as number[][]);
    if (expected.length === 1) {
      expect(prsOf(tasks)[0]).toMatchObject({ est_lines: 30, files: 3 });
    }
  });

  test("ASDLC-1/AC-10 small-then-big merges when within budget", () => {
    const pair = (first: number) => [
      task(1, { est_lines: first, concern: "a" }),
      task(2, { est_lines: 380, concern: "a" }),
    ];
    expect(groupsOf(pair(20))).toEqual([[1, 2]]);
    expect(groupsOf(pair(21))).toEqual([[1], [2]]);
  });

  test.each(["interface", undefined] as const)("ASDLC-1/AC-10 kind %p tasks merge", (kind) => {
    const make = (id: number) => {
      const { kind: _omitted, ...rest } = task(id, { est_lines: 5, concern: "a" });
      return (kind === undefined ? rest : { ...rest, kind }) as StackPlanTask;
    };
    expect(groupsOf([make(1), make(2)])).toEqual([[1, 2]]);
  });

  test("ASDLC-1/AC-10 overlapping files are unioned, not summed", () => {
    const tasks = [
      task(1, { est_lines: 5, concern: "a", files: paths("src/x.ts", "src/y.ts") }),
      task(2, { est_lines: 5, concern: "a", files: paths("src/x.ts") }),
    ];
    expect(prsOf(tasks)[0]).toMatchObject({ tasks: [1, 2], files: 2 });
    const wide = [
      task(1, {
        est_lines: 5,
        concern: "a",
        files: paths("a1", "a2", "s1", "s2", "a5", "a6"),
      }),
      task(2, { est_lines: 5, concern: "a", files: paths("s1", "s2", "b3", "b4", "b5") }),
    ];
    expect(groupsOf(wide)).toEqual([[1, 2]]);
  });

  test("ASDLC-1/AC-10 depends_on_prs for merged and multi-dependency groups", () => {
    const chained = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "a", depends_on: [1] }),
    ];
    const chainPrs = prsOf(chained);
    expect(chainPrs).toHaveLength(1);
    expect(chainPrs[0]).toMatchObject({ tasks: [1, 2], depends_on_prs: [] });
    const multi = [
      task(1, { est_lines: 5, concern: "a" }),
      task(2, { est_lines: 5, concern: "a" }),
      task(3, { depends_on: [2, 1] }),
    ];
    expect(prsOf(multi).map((pr) => pr.depends_on_prs)).toEqual([[], [1]]);
  });

  test("ASDLC-1/AC-10 merge_small_same_concern missing defaults to merging", () => {
    const { merge_small_same_concern: _omit, ...noFlag } = SIZING;
    expect(
      groupsOf(
        [task(1, { est_lines: 5, concern: "a" }), task(2, { est_lines: 5, concern: "a" })],
        noFlag,
      ),
    ).toEqual([[1, 2]]);
  });

  test.each([
    {
      name: "max_files 3",
      sizing: { max_files: 3 },
      tasks: () => [task(1, { est_lines: 50, concern: "a" }, 4)],
      groups: [[1]],
      flags: [{ task: 1, reasons: ["max_files"] }],
    },
    {
      name: "min_pr_lines 50",
      sizing: { min_pr_lines: 50 },
      tasks: () => [
        task(1, { est_lines: 40, concern: "a" }),
        task(2, { est_lines: 40, concern: "a" }),
      ],
      groups: [[1, 2]],
      flags: [],
    },
    {
      name: "max_pr_lines 100 merge budget",
      sizing: { max_pr_lines: 100 },
      tasks: () => [
        task(1, { est_lines: 90, concern: "a" }),
        task(2, { est_lines: 20, concern: "a" }),
      ],
      groups: [[1], [2]],
      flags: [],
    },
  ])("ASDLC-1/AC-10 custom sizing: $name", ({ sizing, tasks, groups, flags }) => {
    const result = computeStack({ tasks: tasks() }, { ...SIZING, ...sizing });
    expect(result.prs.filter((pr) => pr.kind === "task").map((pr) => pr.tasks)).toEqual(
      groups as unknown as number[][],
    );
    expect(result.flags as unknown).toEqual(flags);
  });

  test("ASDLC-1/AC-10 zero task groups gives contract and closeout only", () => {
    expect(computeStack({ tasks: [] }, SIZING)).toEqual({
      prs: [
        { index: 0, kind: "contract", tasks: [] },
        { index: 1, kind: "closeout", tasks: [] },
      ],
      flags: [],
      pr_count: 2,
    });
  });

  test("ASDLC-1/AC-10 legacy tasks without concern or est_lines", () => {
    const withoutConcern = (id: number) => {
      const { concern: _omitted, ...rest } = task(id, { est_lines: 5 });
      return rest as StackPlanTask;
    };
    const noConcern = [withoutConcern(1), withoutConcern(2)];
    expect(groupsOf(noConcern)).toEqual([[1], [2]]);
    const { est_lines: _est, ...noEstRest } = task(1);
    const noEst = noEstRest as StackPlanTask;
    const result = computeStack({ tasks: [noEst] }, SIZING);
    expect(result.flags).toEqual([]);
    expect(Number.isFinite(result.prs[1]?.est_lines)).toBe(true);
    expect(JSON.parse(JSON.stringify(result)).prs[1].est_lines).not.toBeNull();
  });
});
