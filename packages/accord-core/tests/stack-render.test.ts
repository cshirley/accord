import { describe, expect, test } from "bun:test";
import type { AccordTrailer } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { findBareAcRefs } from "@clive.shirley/accord-core/evidence/qualify-ac.js";
import {
  renderPrBrief,
  renderStackMap,
  renderStackReport,
  renderStackTable,
} from "@clive.shirley/accord-core/stack/render.js";
import type { StackPlan, StackPlanTask } from "@clive.shirley/accord-core/stack/types.js";

const ID = "ASDLC-1";
const LINK = "https://github.com/o/r/blob/abc1234def5678/docs/dev/ASDLC-1/spec.json";

function cells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function tableRows(md: string): string[][] {
  return md
    .split("\n")
    .filter((line) => line.trimStart().startsWith("|"))
    .map(cells)
    .filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
}

const brief = {
  workItemId: ID,
  contractLink: LINK,
  acs: [
    { id: "AC-6", text: "refs are qualified", tests: ["ASDLC-1/AC-6 qualified refs"] },
    {
      id: "AC-11",
      text: "stack map and brief",
      tests: ["ASDLC-1/AC-11 brief order", "ASDLC-1/AC-11 map"],
    },
  ],
  summary: "red 1 round, green 1 round, code review 2 rounds, 3 findings fixed",
  risks: ["RISK-ALPHA est_lines may drift"],
  readingOrder: [
    "packages/accord-core/src/stack/render.ts",
    "packages/accord-core/tests/stack-render.test.ts",
  ],
};

describe("ASDLC-1/AC-11 renderPrBrief", () => {
  test("ASDLC-1/AC-11 section order: contract link, ACs, summary, risks, reading order", () => {
    const md = renderPrBrief(brief);
    const positions = [
      md.indexOf(LINK),
      md.indexOf("ASDLC-1/AC-6"),
      md.indexOf("red 1 round, green 1 round"),
      md.indexOf("RISK-ALPHA"),
      md.indexOf("packages/accord-core/src/stack/render.ts"),
    ];
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(md.indexOf(LINK)).toBeLessThan(md.indexOf("ASDLC-1/AC-"));
    // F-013: first non-heading, non-empty line is the contract link
    const firstContent = md.split("\n").find((line) => line.trim() && !line.startsWith("#"));
    expect(firstContent).toContain(LINK);
    expect(md).not.toContain("ASDLC-1/ASDLC-1/");
    expect(md).not.toContain("undefined");
  });

  test("ASDLC-1/AC-11 each proving test appears after its own AC and before the next AC", () => {
    const md = renderPrBrief(brief);
    const at = (needle: string) => md.indexOf(needle);
    expect(at("refs are qualified")).toBeGreaterThanOrEqual(0);
    expect(at("refs are qualified")).toBeLessThan(at("ASDLC-1/AC-6 qualified refs"));
    expect(at("ASDLC-1/AC-6 qualified refs")).toBeLessThan(at("stack map and brief"));
    expect(at("stack map and brief")).toBeLessThan(at("ASDLC-1/AC-11 brief order"));
    expect(at("ASDLC-1/AC-11 brief order")).toBeLessThan(at("ASDLC-1/AC-11 map"));
  });

  test("ASDLC-1/AC-6 qualifies refs in every free-text brief field", () => {
    const md = renderPrBrief({
      ...brief,
      summary: "fixed TC-4 findings",
      risks: ["AC-3 boundary may drift"],
      acs: [
        {
          id: "AC-6",
          text: "see AC-2, ASDLC-1/AC-4 and OTHER-7/AC-1",
          tests: ["AC-6 legacy name"],
        },
      ],
    });
    expect(md).toContain("ASDLC-1/AC-3 boundary may drift");
    expect(md).toContain("ASDLC-1/TC-4");
    expect(md).toContain("ASDLC-1/AC-6 legacy name");
    expect(md).toContain("ASDLC-1/AC-2");
    expect(md).toContain("ASDLC-1/AC-4");
    expect(md).toContain("OTHER-7/AC-1");
    expect(md).not.toContain("ASDLC-1/OTHER-7");
    expect(md).not.toContain("ASDLC-1/ASDLC-1/");
    expect(findBareAcRefs(md)).toEqual([]);
  });

  test("ASDLC-1/AC-6 uses the workItemId parameter, not a hardcoded prefix", () => {
    const md = renderPrBrief({
      ...brief,
      workItemId: "FEAT-9",
      acs: [{ id: "AC-6", text: "see AC-2", tests: [] }],
      summary: "ok",
      risks: [],
    });
    expect(md).toContain("FEAT-9/AC-6");
    expect(md).toContain("FEAT-9/AC-2");
    expect(md).not.toContain("ASDLC-1/AC-");
  });

  test("ASDLC-1/AC-11 lists each AC with its proving tests and text", () => {
    const md = renderPrBrief(brief);
    expect(md).toContain("ASDLC-1/AC-11");
    expect(md).toContain("refs are qualified");
    expect(md).toContain("stack map and brief");
    expect(md).toContain("ASDLC-1/AC-6 qualified refs");
    expect(md).toContain("ASDLC-1/AC-11 brief order");
    expect(md).toContain("ASDLC-1/AC-11 map");
  });

  test("ASDLC-1/AC-11 reading order keeps the given non-sorted sequence", () => {
    const md = renderPrBrief({
      ...brief,
      readingOrder: ["src/b.ts", "tests/a.test.ts", "docs/c.md"],
    });
    const b = md.indexOf("src/b.ts");
    const a = md.indexOf("tests/a.test.ts");
    const c = md.indexOf("docs/c.md");
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(a);
    expect(a).toBeLessThan(c);
  });

  test("ASDLC-1/AC-6 qualifies bare and already-qualified AC ids, no bare refs", () => {
    const md = renderPrBrief({
      ...brief,
      acs: [
        { id: "AC-6", tests: [] },
        { id: "ASDLC-1/AC-11", tests: [] },
      ],
    });
    expect(md).toContain("ASDLC-1/AC-6");
    expect(md).toContain("ASDLC-1/AC-11");
    expect(md).not.toContain("ASDLC-1/ASDLC-1/");
    expect(findBareAcRefs(md)).toEqual([]);
  });

  test("ASDLC-1/AC-6 qualifies bare refs written inside AC text", () => {
    const md = renderPrBrief({
      ...brief,
      acs: [{ id: "AC-6", text: "see AC-2 and TC-3 for detail", tests: [] }],
    });
    expect(md).toContain("ASDLC-1/AC-2");
    expect(md).toContain("ASDLC-1/TC-3");
    expect(findBareAcRefs(md)).toEqual([]);
  });

  test("ASDLC-1/AC-11 empty risks still render without dropping other sections", () => {
    const md = renderPrBrief({ ...brief, risks: [] });
    expect(md).not.toContain("RISK-ALPHA");
    expect(md).toContain("red 1 round");
    expect(md).toContain("tests/stack-render.test.ts");
  });
});

const entries = [
  {
    pr: { index: 0, kind: "contract" as const, tasks: [], concern: null },
    url: "https://github.com/o/r/pull/100",
    acs: [],
  },
  {
    pr: { index: 1, kind: "task" as const, tasks: [4, 5], concern: "api", depends_on_prs: [0] },
    url: "https://github.com/o/r/pull/101",
    acs: ["AC-6", "AC-11"],
  },
  {
    pr: { index: 2, kind: "task" as const, tasks: [9], concern: "cli", depends_on_prs: [1] },
    url: "https://github.com/o/r/pull/102",
    acs: ["AC-2"],
  },
];

describe("ASDLC-1/AC-11 renderStackMap", () => {
  test("ASDLC-1/AC-11 lists position, PR link and qualified AC coverage per PR in order", () => {
    const md = renderStackMap(ID, entries);
    const first = md.indexOf("pull/100");
    const second = md.indexOf("pull/101");
    const third = md.indexOf("pull/102");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    const line101 = md.split("\n").find((line) => line.includes("pull/101")) ?? "";
    expect(line101).toContain("ASDLC-1/AC-6");
    expect(line101).toContain("ASDLC-1/AC-11");
    expect(line101).not.toContain("ASDLC-1/AC-2");
    const line102 = md.split("\n").find((line) => line.includes("pull/102")) ?? "";
    expect(line102).toContain("ASDLC-1/AC-2");
  });

  test("ASDLC-1/AC-11 shows 1-based position out of total", () => {
    const md = renderStackMap(ID, entries);
    const line102 = md.split("\n").find((line) => line.includes("pull/102")) ?? "";
    expect(line102).toMatch(/3\s*(\/|of)\s*3/);
    const line100 = md.split("\n").find((line) => line.includes("pull/100")) ?? "";
    expect(line100).toMatch(/1\s*(\/|of)\s*3/);
  });

  test("ASDLC-1/AC-6 stack map has no bare AC refs", () => {
    expect(findBareAcRefs(renderStackMap(ID, entries))).toEqual([]);
  });

  test("ASDLC-1/AC-6 map does not double-prefix already-qualified ACs", () => {
    const md = renderStackMap(ID, [{ ...entries[1]!, acs: ["ASDLC-1/AC-6", "AC-11"] }]);
    const line = md.split("\n").find((l) => l.includes("pull/101")) ?? "";
    expect(line).toContain("ASDLC-1/AC-6");
    expect(line).toContain("ASDLC-1/AC-11");
    expect(md).not.toContain("ASDLC-1/ASDLC-1/");
  });

  test("ASDLC-1/AC-11 position is array-based, with closeout, when pr.index does not start at 0", () => {
    const md = renderStackMap(ID, [
      { ...entries[1]!, pr: { ...entries[1]!.pr, index: 5 } },
      {
        pr: { index: 6, kind: "closeout" as const, tasks: [] },
        url: "https://github.com/o/r/pull/106",
        acs: [],
      },
    ]);
    const l1 = md.split("\n").find((l) => l.includes("pull/101")) ?? "";
    const l2 = md.split("\n").find((l) => l.includes("pull/106")) ?? "";
    expect(l1).toMatch(/1\s*(\/|of)\s*2/);
    expect(l2).toMatch(/2\s*(\/|of)\s*2/);
  });

  test("ASDLC-1/AC-6 map uses the workItemId parameter", () => {
    const md = renderStackMap("FEAT-9", entries);
    expect(md).toContain("FEAT-9/AC-6");
    expect(md).not.toContain("ASDLC-1/AC-");
  });
});

const tasks: StackPlanTask[] = [
  {
    id: 4,
    covers_ac: ["AC-6"],
    est_lines: 120,
    concern: "api",
    files: [{ path: "a.ts", action: "add" }],
  },
  {
    id: 5,
    covers_ac: ["AC-11"],
    est_lines: 80,
    concern: "api",
    files: [{ path: "b.ts", action: "add" }],
  },
  {
    id: 9,
    covers_ac: ["AC-2", "AC-3"],
    est_lines: 55,
    concern: "cli",
    depends_on: [4],
    files: [{ path: "c.ts", action: "add" }],
  },
];
const plan: StackPlan = {
  pr_count: 2,
  flags: [],
  prs: [
    {
      index: 1,
      kind: "task",
      tasks: [4, 5],
      est_lines: 200,
      files: 2,
      concern: "api",
      depends_on_prs: [],
    },
    {
      index: 2,
      kind: "task",
      tasks: [9],
      est_lines: 55,
      files: 1,
      concern: "cli",
      depends_on_prs: [1],
    },
  ],
};

describe("ASDLC-1/AC-11 renderStackTable", () => {
  test("ASDLC-1/AC-11 header columns are exactly PR, Tasks, Concern, ACs, Est. LOC, Depends on", () => {
    const rows = tableRows(renderStackTable(ID, plan, tasks));
    expect(rows[0]).toEqual(["PR", "Tasks", "Concern", "ACs", "Est. LOC", "Depends on"]);
  });

  test("ASDLC-1/AC-11 one row per PR with tasks, concern, qualified ACs, LOC and dependencies", () => {
    const rows = tableRows(renderStackTable(ID, plan, tasks));
    expect(rows).toHaveLength(3);
    const [, first, second] = rows as [string[], string[], string[]];
    expect(first[0]).toBe("1");
    expect(first[1]).toBe("4, 5");
    expect(first[2]).toBe("api");
    expect(first[3]).toBe("ASDLC-1/AC-6, ASDLC-1/AC-11");
    expect(first[4]).toBe("200");
    expect(first[5]).toBe("-");
    expect(second[0]).toBe("2");
    expect(second[1]).toBe("9");
    expect(second[2]).toBe("cli");
    expect(second[3]).toBe("ASDLC-1/AC-2, ASDLC-1/AC-3");
    expect(second[4]).toBe("55");
    expect(second[5]).toBe("1");
  });

  test("ASDLC-1/AC-6 table has no bare AC refs", () => {
    expect(findBareAcRefs(renderStackTable(ID, plan, tasks))).toEqual([]);
  });

  test("ASDLC-1/AC-6 table does not double-prefix qualified covers_ac and uses workItemId", () => {
    const mixed = tasks.map((t) => (t.id === 4 ? { ...t, covers_ac: ["ASDLC-1/AC-6"] } : t));
    const md = renderStackTable(ID, plan, mixed);
    expect(tableRows(md)[1]?.[3]).toBe("ASDLC-1/AC-6, ASDLC-1/AC-11");
    expect(md).not.toContain("ASDLC-1/ASDLC-1/");
    const other = renderStackTable("FEAT-9", plan, tasks);
    expect(other).toContain("FEAT-9/AC-6");
    expect(other).not.toContain("ASDLC-1/AC-");
  });

  test("ASDLC-1/AC-11 contract and closeout PRs render placeholder cells; duplicate ACs deduped", () => {
    const withEnds: StackPlan = {
      pr_count: 4,
      flags: [],
      prs: [
        { index: 0, kind: "contract", tasks: [], concern: null },
        {
          index: 1,
          kind: "task",
          tasks: [4, 5],
          est_lines: 200,
          files: 2,
          concern: "api",
          depends_on_prs: [0],
        },
        {
          index: 2,
          kind: "task",
          tasks: [9],
          est_lines: 55,
          files: 1,
          concern: "cli",
          depends_on_prs: [1],
        },
        { index: 3, kind: "closeout", tasks: [] },
      ],
    };
    const overlap = tasks.map((t) => (t.id === 5 ? { ...t, covers_ac: ["AC-6", "AC-11"] } : t));
    const md = renderStackTable(ID, withEnds, overlap);
    const rows = tableRows(md);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(["0", "-", "contract", "-", "-", "-"]);
    expect(rows[2]?.[3]).toBe("ASDLC-1/AC-6, ASDLC-1/AC-11");
    expect(rows[2]?.[5]).toBe("0");
    expect(rows[4]).toEqual(["3", "-", "closeout", "-", "-", "-"]);
    expect(md).not.toMatch(/undefined|null|NaN/);
  });
});

function trailer(fields: Record<string, string | number | string[]>): AccordTrailer {
  return {
    v: 1,
    id: ID,
    task: 27,
    seq: 1,
    ref: "T1/phase-test",
    agent: "phase-test",
    loop: "T",
    round: 1,
    outcome: "ok",
    ...fields,
  } as AccordTrailer;
}

describe("ASDLC-1/AC-11 renderStackReport", () => {
  const rows = [
    {
      pr: 1,
      task: 4,
      trailers: [
        trailer({
          loop: "T",
          round: 1,
          outcome: "red",
          crit: 1,
          warn: 2,
          sugg: 0,
          seq: 1,
          t_pass: 3,
          t_fail: 4,
          tok_in: 100,
          tok_out: 50,
          usd_u: 1000,
        }),
        trailer({
          loop: "T",
          round: 2,
          outcome: "green",
          crit: 0,
          warn: 1,
          sugg: 1,
          seq: 2,
          t_pass: 7,
          t_fail: 0,
          tok_in: 200,
          tok_out: 25,
          usd_u: 500,
        }),
        trailer({
          loop: "C",
          round: 3,
          outcome: "ok",
          crit: 0,
          warn: 0,
          sugg: 4,
          tok_in: 10,
          tok_out: 5,
          usd_u: 7,
        }),
      ],
    },
    {
      pr: 2,
      task: 9,
      trailers: [
        trailer({
          task: 9,
          loop: "C",
          round: 1,
          outcome: "ok",
          crit: 2,
          warn: 0,
          sugg: 0,
          tok_in: 1,
          tok_out: 2,
          usd_u: 3,
        }),
      ],
    },
  ];

  test("ASDLC-1/AC-11 header has rounds, findings, tests, tokens, cost columns", () => {
    const header = (tableRows(renderStackReport(ID, rows))[0] ?? []).map((cell) =>
      cell.toLowerCase(),
    );
    for (const column of ["pr", "task", "loop", "rounds", "findings", "tests", "tokens", "cost"]) {
      expect(header.some((cell) => cell.startsWith(column))).toBe(true);
    }
  });

  test("ASDLC-1/AC-11 one row per PR and loop with rolled-up values from trailers", () => {
    const md = renderStackReport(ID, rows);
    const [header, ...body] = tableRows(md) as [string[], ...string[][]];
    const col = (name: string) => header.findIndex((cell) => cell.toLowerCase().startsWith(name));
    expect(body).toHaveLength(3);
    const find = (pr: string, loop: string) =>
      body.find((row) => row[col("pr")] === pr && row[col("loop")] === loop) as string[];
    const loopT = find("1", "T");
    expect(loopT[col("task")]).toBe("4");
    expect(loopT[col("rounds")]).toBe("2"); // max round
    expect(loopT[col("findings")]).toBe("5"); // 1+2+0 + 0+1+1
    expect(loopT[col("tests")]).toBe("7/0"); // pass/fail of latest test-bearing trailer
    expect(loopT[col("tokens")]).toBe("375"); // 100+50+200+25
    expect(loopT[col("cost")]).toBe("1500 usd_u"); // usd_u 1000+500
    const loopC = find("1", "C");
    expect(loopC[col("rounds")]).toBe("3");
    expect(loopC[col("findings")]).toBe("4");
    expect(loopC[col("tokens")]).toBe("15");
    expect(loopC[col("cost")]).toBe("7 usd_u");
    const other = find("2", "C");
    expect(other[col("task")]).toBe("9");
    expect(other[col("rounds")]).toBe("1");
    expect(other[col("findings")]).toBe("2");
    expect(other[col("tokens")]).toBe("3");
  });

  test("ASDLC-1/AC-11 latest test-bearing trailer is by highest round/seq, not array order", () => {
    const [first, second] = (rows[0] as (typeof rows)[0]).trailers;
    const md = renderStackReport(ID, [
      { pr: 1, task: 4, trailers: [second as AccordTrailer, first as AccordTrailer] },
    ]);
    const [header, ...body] = tableRows(md) as [string[], ...string[][]];
    const col = (name: string) => header.findIndex((cell) => cell.toLowerCase().startsWith(name));
    expect(body[0]?.[col("tests")]).toBe("7/0");
  });

  test("ASDLC-1/AC-11 PR with several tasks gets one row per task and loop", () => {
    const md = renderStackReport(ID, [
      {
        pr: 1,
        task: 4,
        trailers: [trailer({ loop: "T", round: 1, crit: 1, tok_in: 1, tok_out: 1, usd_u: 1 })],
      },
      {
        pr: 1,
        task: 5,
        trailers: [
          trailer({ task: 5, loop: "T", round: 1, crit: 1, tok_in: 4, tok_out: 6, usd_u: 9 }),
        ],
      },
    ]);
    const [header, ...body] = tableRows(md) as [string[], ...string[][]];
    const col = (name: string) => header.findIndex((cell) => cell.toLowerCase().startsWith(name));
    expect(body).toHaveLength(2);
    const t5 = body.find((r) => r[col("task")] === "5") as string[];
    expect(t5[col("pr")]).toBe("1");
    expect(t5[col("findings")]).toBe("1");
    expect(t5[col("tokens")]).toBe("10");
    expect(t5[col("cost")]).toBe("9 usd_u");
    const t4 = body.find((r) => r[col("task")] === "4") as string[];
    expect(t4[col("tokens")]).toBe("2");
  });

  test("ASDLC-1/AC-11 absent optional trailer keys do not leak NaN/undefined", () => {
    const md = renderStackReport(ID, [
      {
        pr: 1,
        task: 4,
        trailers: [
          trailer({ loop: "C", round: 1, seq: 1 }),
          trailer({ loop: "C", round: 2, seq: 2, crit: 2, tok_in: 1, tok_out: 2, usd_u: 3 }),
        ],
      },
    ]);
    const [header, ...body] = tableRows(md) as [string[], ...string[][]];
    const col = (name: string) => header.findIndex((cell) => cell.toLowerCase().startsWith(name));
    expect(body).toHaveLength(1);
    expect(body[0]?.[col("findings")]).toBe("2");
    expect(body[0]?.[col("tokens")]).toBe("3");
    expect(body[0]?.[col("tests")]).toBe("-");
    expect(md).not.toMatch(/NaN|undefined|null/);
  });

  test("ASDLC-1/AC-11 empty rows render a header only, no data rows", () => {
    expect(tableRows(renderStackReport(ID, []))).toHaveLength(1);
  });

  test("ASDLC-1/AC-6 report has no bare AC refs even when trailers carry ac=", () => {
    const md = renderStackReport(ID, [
      { pr: 1, task: 4, trailers: [trailer({ ac: ["AC-6", "AC-11"], loop: "T" })] },
    ]);
    expect(findBareAcRefs(md)).toEqual([]);
    expect(md).not.toMatch(/(?<![A-Za-z0-9_/])(?:AC|TC)-\d+/);
    expect(md).not.toContain("ac=");
  });
});
