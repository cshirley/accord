import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type AccordTrailer, buildCommitMessage } from "../src/commit/commit-grammar";
import {
  readTimeline,
  renderTimelineMarkdown,
  renderTimelineTsv,
  type TimelineRow,
} from "../src/evidence/timeline";
import { createTempGitRepo, type TempGitRepo } from "./helpers/temp-git-repo";

// ASDLC-1/AC-4 (TC-4 at core level): timeline rendered from git trailers only.
// Contract pinned here (spec leaves exact shape open; documented in the test):
//  - rows, in commit order (oldest first):
//    { ref, task, agent, loop, round, outcome, model?, counts, tokens: {in,out}, cost: {usd_u} }
//    counts holds only the keys present on the trailer, from
//    crit warn sugg addressed disputed wont_fix ac_pass ac_fail t_pass t_fail.
//  - columns (md and tsv) = the keys the documented awk extraction (plan section 3.2e) groups
//    and sums by, named after the trailer keys; absent value = empty cell:
//    ref task agent loop round outcome crit warn sugg addressed disputed wont_fix ac_pass ac_fail
//    t_pass t_fail model tok_in tok_out usd_u
//  - tsv: header line + one line per row, tab separated, trailing "\n". No header-less variant.
//  - md: pipe table, header, `| --- |` separator, rows.
const ID = "ASDLC-1";
const COLUMNS = [
  "ref",
  "task",
  "agent",
  "loop",
  "round",
  "outcome",
  "crit",
  "warn",
  "sugg",
  "addressed",
  "disputed",
  "wont_fix",
  "ac_pass",
  "ac_fail",
  "t_pass",
  "t_fail",
  "model",
  "tok_in",
  "tok_out",
  "usd_u",
];

function trailer(
  over: Partial<AccordTrailer> & { seq: number; ref: string; outcome: string },
): AccordTrailer {
  return {
    v: 1,
    id: ID,
    task: 2,
    agent: "phase-test",
    loop: "test",
    round: 1,
    ...over,
  } as AccordTrailer;
}

// seq restarts per task (spec: commit order within the task PR); commit order != seq order.
const SEQUENCE: { summary: string; t: AccordTrailer }[] = [
  {
    summary: "4 failing tests",
    t: trailer({
      seq: 1,
      ref: "T1/phase-test",
      outcome: "red",
      t_pass: 0,
      t_fail: 4,
      tok_in: 1000,
      tok_out: 200,
      usd_u: 60000,
      model: "sonnet",
    }),
  },
  {
    summary: "review findings",
    t: trailer({
      seq: 2,
      ref: "T1/review-test",
      agent: "review-test",
      outcome: "findings",
      crit: 1,
      warn: 2,
      sugg: 0,
      tok_in: 3000,
      tok_out: 500,
      usd_u: 120000,
      model: "opus",
    }),
  },
  {
    summary: "other task (3)",
    t: trailer({
      seq: 1,
      task: 3,
      ref: "T1/phase-test",
      outcome: "red",
      t_pass: 0,
      t_fail: 1,
      tok_in: 7,
      tok_out: 8,
      usd_u: 9,
      model: "haiku",
    }),
  },
  {
    summary: "fix responses",
    t: trailer({
      seq: 3,
      ref: "T2/phase-test",
      round: 2,
      outcome: "fixed",
      addressed: 2,
      disputed: 0,
      wont_fix: 1,
      tok_in: 400,
      tok_out: 100,
      usd_u: 10000,
      model: "sonnet",
    }),
  },
  {
    summary: "green",
    t: trailer({
      seq: 4,
      ref: "C1/phase-code",
      agent: "phase-code",
      loop: "code",
      outcome: "green",
      t_pass: 4,
      t_fail: 0,
      tok_in: 5000,
      tok_out: 900,
      usd_u: 250000,
      model: "sonnet",
    }),
  },
  {
    summary: "verify",
    t: trailer({
      seq: 5,
      ref: "V1/phase-verify-task",
      agent: "phase-verify-task",
      loop: "verify",
      outcome: "pass",
      ac_pass: 4,
      ac_fail: 0,
      model: "sonnet",
    }),
  },
];
const OTHER_ITEM = trailer({
  seq: 1,
  id: "ASDLC-2",
  ref: "T1/phase-test",
  outcome: "red",
  t_fail: 9,
  tok_in: 99,
  tok_out: 99,
  usd_u: 99,
});

const TASK2_ROWS: TimelineRow[] = [
  {
    ref: "T1/phase-test",
    task: 2,
    agent: "phase-test",
    loop: "test",
    round: 1,
    outcome: "red",
    model: "sonnet",
    counts: { t_pass: 0, t_fail: 4 },
    tokens: { in: 1000, out: 200 },
    cost: { usd_u: 60000 },
  },
  {
    ref: "T1/review-test",
    task: 2,
    agent: "review-test",
    loop: "test",
    round: 1,
    outcome: "findings",
    model: "opus",
    counts: { crit: 1, warn: 2, sugg: 0 },
    tokens: { in: 3000, out: 500 },
    cost: { usd_u: 120000 },
  },
  {
    ref: "T2/phase-test",
    task: 2,
    agent: "phase-test",
    loop: "test",
    round: 2,
    outcome: "fixed",
    model: "sonnet",
    counts: { addressed: 2, disputed: 0, wont_fix: 1 },
    tokens: { in: 400, out: 100 },
    cost: { usd_u: 10000 },
  },
  {
    ref: "C1/phase-code",
    task: 2,
    agent: "phase-code",
    loop: "code",
    round: 1,
    outcome: "green",
    model: "sonnet",
    counts: { t_pass: 4, t_fail: 0 },
    tokens: { in: 5000, out: 900 },
    cost: { usd_u: 250000 },
  },
  {
    ref: "V1/phase-verify-task",
    task: 2,
    agent: "phase-verify-task",
    loop: "verify",
    round: 1,
    outcome: "pass",
    model: "sonnet",
    counts: { ac_pass: 4, ac_fail: 0 },
    tokens: {},
    cost: {},
  },
];

// Cells in COLUMNS order for TASK2_ROWS ("" = key absent on the trailer).
const E = "";
const TASK2_CELLS: string[][] = [
  [
    "T1/phase-test",
    "2",
    "phase-test",
    "test",
    "1",
    "red",
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    "0",
    "4",
    "sonnet",
    "1000",
    "200",
    "60000",
  ],
  [
    "T1/review-test",
    "2",
    "review-test",
    "test",
    "1",
    "findings",
    "1",
    "2",
    "0",
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    "opus",
    "3000",
    "500",
    "120000",
  ],
  [
    "T2/phase-test",
    "2",
    "phase-test",
    "test",
    "2",
    "fixed",
    E,
    E,
    E,
    "2",
    "0",
    "1",
    E,
    E,
    E,
    E,
    "sonnet",
    "400",
    "100",
    "10000",
  ],
  [
    "C1/phase-code",
    "2",
    "phase-code",
    "code",
    "1",
    "green",
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    E,
    "4",
    "0",
    "sonnet",
    "5000",
    "900",
    "250000",
  ],
  [
    "V1/phase-verify-task",
    "2",
    "phase-verify-task",
    "verify",
    "1",
    "pass",
    E,
    E,
    E,
    E,
    E,
    E,
    "4",
    "0",
    E,
    E,
    "sonnet",
    E,
    E,
    E,
  ],
];

const TSV_TASK2 = `${[COLUMNS, ...TASK2_CELLS].map((cells) => cells.join("\t")).join("\n")}\n`;

const MD_TASK2 = `${[
  `| ${COLUMNS.join(" | ")} |`,
  `| ${COLUMNS.map(() => "---").join(" | ")} |`,
  ...TASK2_CELLS.map((cells) => `| ${cells.join(" | ")} |`),
].join("\n")}\n`;

let repo: TempGitRepo;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  repo = await createTempGitRepo();
  await repo.commitFiles({ "README.md": "init" }, "init: no trailer");
  for (const { summary, t } of SEQUENCE) {
    await repo.commitFiles(
      { [`f${t.seq}-${t.task}.txt`]: summary },
      buildCommitMessage({ summary, body: "body text", trailer: t }),
    );
  }
  // Plain commit mentioning Accord in prose but without a trailer: must be skipped.
  await repo.commitFiles({ "notes.txt": "x" }, "chore: mentions Accord: v=1 in the subject only");
  await repo.commitFiles(
    { "o.txt": "o" },
    buildCommitMessage({ summary: "other item", trailer: OTHER_ITEM }),
  );
  process.chdir(repo.dir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await repo.cleanup();
});

describe("ASDLC-1/AC-4 readTimeline", () => {
  it("ASDLC-1/AC-4 returns rows for one work item built from trailers, in commit order", async () => {
    const rows = await readTimeline(ID, {});
    expect(rows.map((r) => r.ref)).toEqual([
      "T1/phase-test",
      "T1/review-test",
      "T1/phase-test", // task 3 (seq restarts at 1): a sort by seq would move it
      "T2/phase-test",
      "C1/phase-code",
      "V1/phase-verify-task",
    ]);
    expect(rows.map((r) => r.outcome)).toEqual([
      "red",
      "findings",
      "red",
      "fixed",
      "green",
      "pass",
    ]);
  });

  it("ASDLC-1/AC-4 task filter keeps only task-<N> rows with exact counts, tokens and cost", async () => {
    const rows = await readTimeline(ID, { task: 2 });
    expect(rows).toEqual(TASK2_ROWS);
  });

  it("ASDLC-1/AC-4 task filter for task 3 returns only its row", async () => {
    const rows = await readTimeline(ID, { task: 3 });
    expect(rows).toEqual([
      {
        ref: "T1/phase-test",
        task: 3,
        agent: "phase-test",
        loop: "test",
        round: 1,
        outcome: "red",
        model: "haiku",
        counts: { t_pass: 0, t_fail: 1 },
        tokens: { in: 7, out: 8 },
        cost: { usd_u: 9 },
      },
    ]);
  });

  it("ASDLC-1/AC-4 task filter with no matching task returns []", async () => {
    expect(await readTimeline(ID, { task: 99 })).toEqual([]);
  });

  it("ASDLC-1/AC-4 other work item's commits are excluded; unknown id yields []", async () => {
    const other = await readTimeline("ASDLC-2", {});
    expect(other).toEqual([
      {
        ref: "T1/phase-test",
        task: 2,
        agent: "phase-test",
        loop: "test",
        round: 1,
        outcome: "red",
        counts: { t_fail: 9 },
        tokens: { in: 99, out: 99 },
        cost: { usd_u: 99 },
      },
    ]);
    expect(await readTimeline("ASDLC-77", {})).toEqual([]);
  });

  it("ASDLC-1/AC-4 commits without an Accord trailer are skipped", async () => {
    const rows = await readTimeline(ID, {});
    expect(rows).toHaveLength(6); // init + prose-only commit contribute nothing
  });

  it("ASDLC-1/AC-4 reads git only: works with no .tasks/ or docs/dev in the repo", async () => {
    expect(existsSync(join(repo.dir, ".tasks"))).toBe(false);
    expect(existsSync(join(repo.dir, "docs"))).toBe(false);
    expect(await readTimeline(ID, { task: 2 })).toEqual(TASK2_ROWS);
  });

  it("ASDLC-1/AC-4 ignores a conflicting .tasks/ file (trailers are the only source)", async () => {
    mkdirSync(join(repo.dir, ".tasks"), { recursive: true });
    writeFileSync(
      join(repo.dir, ".tasks", `${ID}-task-2.json`),
      JSON.stringify({ log: [{ ref: "T9/bogus", outcome: "bogus" }] }),
    );
    expect(await readTimeline(ID, { task: 2 })).toEqual(TASK2_ROWS);
  });
});

describe("ASDLC-1/AC-4 renderers", () => {
  it("ASDLC-1/AC-4 renderTimelineTsv matches expected text", async () => {
    expect(renderTimelineTsv(await readTimeline(ID, { task: 2 }))).toBe(TSV_TASK2);
  });

  it("ASDLC-1/AC-4 renderTimelineMarkdown matches expected text", async () => {
    expect(renderTimelineMarkdown(await readTimeline(ID, { task: 2 }))).toBe(MD_TASK2);
  });

  it("ASDLC-1/AC-4 empty timeline renders header only (tsv) and header+separator (md)", () => {
    expect(renderTimelineTsv([])).toBe(`${COLUMNS.join("\t")}\n`);
    expect(renderTimelineMarkdown([])).toBe(
      `| ${COLUMNS.join(" | ")} |\n| ${COLUMNS.map(() => "---").join(" | ")} |\n`,
    );
  });

  it("ASDLC-1/AC-4 tsv has the documented columns; every line has the same column count", async () => {
    const text = renderTimelineTsv(await readTimeline(ID, {}));
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.slice(0, -1).split("\n");
    expect(lines[0]?.split("\t")).toEqual(COLUMNS);
    for (const line of lines) expect(line.split("\t")).toHaveLength(COLUMNS.length);
    expect(lines).toHaveLength(7);
  });

  it("ASDLC-1/AC-4 tsv columns agree with the documented awk extraction over git log", async () => {
    const tsvPath = join(repo.dir, ".timeline.tsv");
    writeFileSync(tsvPath, renderTimelineTsv(await readTimeline(ID, {})));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
    env.LC_ALL = "C";
    const run = (script: string): string => {
      const res = spawnSync("bash", ["-c", script], { cwd: repo.dir, encoding: "utf8", env });
      if (res.status !== 0) throw new Error(`${script}: ${res.stderr}`);
      return res.stdout;
    };
    // Documented awk (plan 3.2e) with the range dropped and an id filter added (repo also holds ASDLC-2).
    const END =
      'END { for (l in rounds) printf "%s rounds=%d crit=%d warn=%d\\n", l, rounds[l], crit[l], warn[l]; for (a in usd) printf "%s usd=%.2f\\n", a, usd[a]/1e6; for (m in tok) printf "%s tokens=%d\\n", m, tok[m] }';
    const fromGit = run(
      `git log --reverse --format='%H%x09%(trailers:key=Accord,valueonly,unfold)' | awk -F'\\t' '$2!="" { n=split($2,p," "); delete r; for(i=1;i<=n;i++){split(p[i],kv,"="); r[kv[1]]=kv[2]}; if (r["id"]!="ASDLC-1") next; if (r["outcome"]=="findings") { crit[r["loop"]]+=r["crit"]; warn[r["loop"]]+=r["warn"] } if (r["round"]+0 > rounds[r["loop"]]) rounds[r["loop"]]=r["round"]; usd[r["agent"]]+=r["usd_u"]; tok[r["model"]]+=r["tok_in"]+r["tok_out"] } ${END}' | sort`,
    );
    // Same extraction reading the tsv fields by header name.
    const fromTsv = run(
      `awk -F'\\t' 'NR==1 { for(i=1;i<=NF;i++) c[$i]=i; next } { l=$(c["loop"]); if ($(c["outcome"])=="findings") { crit[l]+=$(c["crit"]); warn[l]+=$(c["warn"]) } if ($(c["round"])+0 > rounds[l]) rounds[l]=$(c["round"]); usd[$(c["agent"])]+=$(c["usd_u"]); tok[$(c["model"])]+=$(c["tok_in"])+$(c["tok_out"]) } ${END}' '${tsvPath}' | sort`,
    );
    // Hand-computed over ASDLC-1 (tasks 2 and 3; ASDLC-2 excluded):
    //  rounds per loop: test max(1,1,1,2)=2, code 1, verify 1; findings only on the review-test commit: crit 1, warn 2.
    //  usd by agent: phase-test 60000+9+10000=70009 -> 0.07; review-test 120000 -> 0.12;
    //    phase-code 250000 -> 0.25; phase-verify-task none -> 0.00.
    //  tokens by model: sonnet (1000+200)+(400+100)+(5000+900)=7600; opus 3000+500=3500; haiku 7+8=15.
    const expected = [
      "code rounds=1 crit=0 warn=0",
      "haiku tokens=15",
      "opus tokens=3500",
      "phase-code usd=0.25",
      "phase-test usd=0.07",
      "phase-verify-task usd=0.00",
      "review-test usd=0.12",
      "sonnet tokens=7600",
      "test rounds=2 crit=1 warn=2",
      "verify rounds=1 crit=0 warn=0",
      "",
    ].join("\n");
    expect(fromGit).toBe(expected);
    expect(fromTsv).toBe(expected);
  });
});

describe("ASDLC-1/AC-4 trailer-only and exact selection", () => {
  it("ASDLC-1/AC-4 only a real trailer block counts; subject and prose never supply fields", async () => {
    const subj = (n: string): string => `[ASDLC-1][task-2] ${n}: x`;
    const line = (ref: string, extra = ""): string =>
      `Accord: v=1 id=ASDLC-1 task=2 seq=9 ref=${ref} agent=x loop=test round=9 outcome=bogus${extra}`;
    // title only: git does not treat a lone subject as a trailer
    await repo.commitFiles({ "a.txt": "a" }, line("T9/title"));
    // trailer-shaped line in a body paragraph that is not the last paragraph
    await repo.commitFiles(
      { "b.txt": "b" },
      `${subj("T9/body")}\n\n${line("T9/body")}\n\nfinal prose paragraph.`,
    );
    // prose Accord line in the middle
    await repo.commitFiles(
      { "c.txt": "c" },
      `${subj("T9/prose")}\n\nAccord: see ADR-12 for details\n\nmore prose`,
    );
    // subject disagrees with the trailer: the trailer wins
    await repo.commitFiles(
      { "d.txt": "d" },
      `[ASDLC-1][task-2] T9/subj: x\n\nAccord: v=1 id=ASDLC-1 task=3 seq=2 ref=T2/phase-test agent=phase-test loop=test round=2 outcome=fixed`,
    );
    const all = await readTimeline(ID, {});
    expect(all.filter((r) => /^T9\//.test(r.ref))).toEqual([]);
    expect(all.filter((r) => r.outcome === "bogus")).toEqual([]);
    const task3 = await readTimeline(ID, { task: 3 });
    expect(task3.find((r) => r.ref === "T2/phase-test")).toEqual({
      ref: "T2/phase-test",
      task: 3,
      agent: "phase-test",
      loop: "test",
      round: 2,
      outcome: "fixed",
      counts: {},
      tokens: {},
      cost: {},
    });
    expect(task3.every((r) => r.agent !== "subj")).toBe(true);
    expect(await readTimeline(ID, { task: 2 })).toEqual(TASK2_ROWS);
  });

  it("ASDLC-1/AC-4 realistic, co-trailer and folded trailers yield exact rows", async () => {
    const real = buildCommitMessage({
      summary: "review findings",
      trailer: {
        v: 1,
        id: ID,
        task: 7,
        seq: 1,
        ref: "T1/review-test",
        agent: "review-test",
        loop: "test",
        round: 1,
        outcome: "findings",
        crit: 1,
        warn: 2,
        sugg: 0,
        open_crit: 1,
        files: 3,
        spawns: 1,
        ms: 45000,
        retry: 0,
        tok_in: 18200,
        tok_out: 1900,
        cache_r: 500,
        cache_w: 600,
        usd_u: 118000,
        model: "sonnet",
        x_custom: 1,
      } as AccordTrailer,
    });
    await repo.commitFiles({ "r1.txt": "1" }, real);
    await repo.commitFiles(
      { "r2.txt": "2" },
      "[ASDLC-1][task-7] T2/phase-test: co\n\nbody\n\nSigned-off-by: A <a@example.invalid>\nAccord: v=1 id=ASDLC-1 task=7 seq=2 ref=T2/phase-test agent=phase-test loop=test round=2 outcome=fixed addressed=1\nCo-authored-by: B <b@example.invalid>",
    );
    await repo.commitFiles(
      { "r3.txt": "3" },
      "[ASDLC-1][task-7] C1/phase-code: folded\n\nAccord: v=1 id=ASDLC-1 task=7 seq=3 ref=C1/phase-code\n agent=phase-code loop=code round=1 outcome=green t_pass=3 t_fail=0",
    );
    expect(await readTimeline(ID, { task: 7 })).toEqual([
      {
        ref: "T1/review-test",
        task: 7,
        agent: "review-test",
        loop: "test",
        round: 1,
        outcome: "findings",
        model: "sonnet",
        counts: { crit: 1, warn: 2, sugg: 0 },
        tokens: { in: 18200, out: 1900 },
        cost: { usd_u: 118000 },
      },
      {
        ref: "T2/phase-test",
        task: 7,
        agent: "phase-test",
        loop: "test",
        round: 2,
        outcome: "fixed",
        counts: { addressed: 1 },
        tokens: {},
        cost: {},
      },
      {
        ref: "C1/phase-code",
        task: 7,
        agent: "phase-code",
        loop: "code",
        round: 1,
        outcome: "green",
        counts: { t_pass: 3, t_fail: 0 },
        tokens: {},
        cost: {},
      },
    ]);
  });

  it("ASDLC-1/AC-4 id and task filters use exact equality, not prefixes", async () => {
    await repo.commitFiles(
      { "p1.txt": "1" },
      buildCommitMessage({
        summary: "prefix id",
        trailer: trailer({
          seq: 1,
          id: "ASDLC-10",
          ref: "T1/phase-test",
          outcome: "red",
          t_fail: 5,
        }),
      }),
    );
    await repo.commitFiles(
      { "p2.txt": "2" },
      buildCommitMessage({
        summary: "prefix task",
        trailer: trailer({ seq: 1, task: 20, ref: "T1/phase-test", outcome: "red", t_fail: 6 }),
      }),
    );
    expect(await readTimeline(ID, { task: 2 })).toEqual(TASK2_ROWS);
    expect((await readTimeline(ID, {})).filter((r) => r.counts.t_fail === 5)).toEqual([]);
    expect(await readTimeline(ID, { task: 20 })).toEqual([
      {
        ref: "T1/phase-test",
        task: 20,
        agent: "phase-test",
        loop: "test",
        round: 1,
        outcome: "red",
        counts: { t_fail: 6 },
        tokens: {},
        cost: {},
      },
    ]);
    expect(await readTimeline("ASDLC-10", {})).toEqual([
      {
        ref: "T1/phase-test",
        task: 2,
        agent: "phase-test",
        loop: "test",
        round: 1,
        outcome: "red",
        counts: { t_fail: 5 },
        tokens: {},
        cost: {},
      },
    ]);
  });

  it("ASDLC-1/AC-4 honours an explicit cwd instead of process.cwd()", async () => {
    process.chdir(originalCwd);
    expect(await readTimeline(ID, { task: 2, cwd: repo.dir })).toEqual(TASK2_ROWS);
  });
});
