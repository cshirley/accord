import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AccordTrailer,
  buildCommitMessage,
} from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { createTempGitRepo, type TempGitRepo } from "../../accord-core/tests/helpers/temp-git-repo";

const ID = "ASDLC-1";
const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const HEADER = [
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

// Golden rows, written cell by cell (absent trailer value = empty cell).
const ROW_T2_RED = [
  "T1/phase-test",
  "2",
  "phase-test",
  "test",
  "1",
  "red",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "0",
  "4",
  "sonnet",
  "1000",
  "200",
  "60000",
];
const ROW_T2_REVIEW = [
  "T1/review-test",
  "2",
  "review-test",
  "test",
  "1",
  "findings",
  "1",
  "2",
  "0",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "opus",
  "3000",
  "500",
  "120000",
];
const ROW_T3_RED = [
  "T1/phase-test",
  "3",
  "phase-test",
  "test",
  "1",
  "red",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "0",
  "1",
  "haiku",
  "7",
  "8",
  "9",
];

const tsvOf = (rows: string[][]): string =>
  `${[HEADER, ...rows].map((cells) => cells.join("\t")).join("\n")}\n`;
const mdOf = (rows: string[][]): string => {
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  return `${[line(HEADER), line(HEADER.map(() => "---")), ...rows.map(line)].join("\n")}\n`;
};

function trailer(over: Partial<AccordTrailer>): AccordTrailer {
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

let repo: TempGitRepo;

beforeEach(async () => {
  repo = await createTempGitRepo();
  await repo.commitFiles({ "README.md": "x" }, "chore: init");
  const commits: { summary: string; t: AccordTrailer }[] = [
    {
      summary: "red",
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
      summary: "review",
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
      summary: "other task",
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
      summary: "other work item",
      t: trailer({
        seq: 1,
        id: "ASDLC-2",
        ref: "T1/phase-test",
        outcome: "red",
        t_fail: 9,
        tok_in: 99,
        tok_out: 99,
        usd_u: 99,
      }),
    },
  ];
  for (const [index, commit] of commits.entries()) {
    await repo.commitFiles(
      { [`f${index}.txt`]: String(index) },
      buildCommitMessage({ summary: commit.summary, trailer: commit.t }),
    );
  }
});

afterEach(async () => {
  await repo.cleanup();
});

function accord(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(key)) {
      delete env[key];
    }
  }
  const res = spawnSync("bun", [MAIN, ...args, "--cwd", repo.dir], { encoding: "utf8", env });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe("ASDLC-1/AC-4 accord evidence", () => {
  it("ASDLC-1/TC-4 default format is md: all rows of the work item in commit order", () => {
    const res = accord("evidence", ID);
    expect(res.status).toBe(0);
    expect(res.stdout.trimEnd()).toBe(mdOf([ROW_T2_RED, ROW_T2_REVIEW, ROW_T3_RED]).trimEnd());
  });

  it("ASDLC-1/TC-4 --format md equals the default output", () => {
    const res = accord("evidence", ID, "--format", "md");
    expect(res.status).toBe(0);
    expect(res.stdout.trimEnd()).toBe(mdOf([ROW_T2_RED, ROW_T2_REVIEW, ROW_T3_RED]).trimEnd());
  });

  it("ASDLC-1/TC-4 --format tsv prints header plus one tab-separated line per commit", () => {
    const res = accord("evidence", ID, "--format", "tsv");
    expect(res.status).toBe(0);
    expect(res.stdout.trimEnd()).toBe(tsvOf([ROW_T2_RED, ROW_T2_REVIEW, ROW_T3_RED]).trimEnd());
  });

  it("ASDLC-1/TC-4 task-2 filters to that task (md)", () => {
    const res = accord("evidence", ID, "task-2");
    expect(res.status).toBe(0);
    expect(res.stdout.trimEnd()).toBe(mdOf([ROW_T2_RED, ROW_T2_REVIEW]).trimEnd());
  });

  it("ASDLC-1/TC-4 task-2 with --format tsv filters to that task", () => {
    const res = accord("evidence", ID, "task-2", "--format", "tsv");
    expect(res.status).toBe(0);
    expect(res.stdout.trimEnd()).toBe(tsvOf([ROW_T2_RED, ROW_T2_REVIEW]).trimEnd());
  });

  it("ASDLC-1/TC-4 --format may precede the task selector", () => {
    const res = accord("evidence", ID, "--format", "tsv", "task-3");
    expect(res.status).toBe(0);
    expect(res.stdout.trimEnd()).toBe(tsvOf([ROW_T3_RED]).trimEnd());
  });

  it("ASDLC-1/TC-4 tsv columns match the documented awk extraction (sum usd_u by task)", () => {
    const res = accord("evidence", ID, "--format", "tsv");
    expect(res.status).toBe(0);
    const lines = res.stdout.trimEnd().split("\n");
    const header = lines[0]?.split("\t") ?? [];
    expect(header).toEqual(HEADER);
    const taskCol = header.indexOf("task");
    const usdCol = header.indexOf("usd_u");
    const totals: Record<string, number> = {};
    for (const line of lines.slice(1)) {
      const cells = line.split("\t");
      expect(cells).toHaveLength(HEADER.length);
      const task = cells[taskCol] ?? "";
      totals[task] = (totals[task] ?? 0) + Number(cells[usdCol]);
    }
    expect(totals).toEqual({ "2": 180000, "3": 9 });
  });

  it("ASDLC-1/TC-4 unknown format exits non-zero naming the format and the valid values", () => {
    const res = accord("evidence", ID, "--format", "xml");
    expect(res.status).not.toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toMatch(/format/i);
    expect(res.stderr).toContain("xml");
    expect(res.stderr).toMatch(/md/);
    expect(res.stderr).toMatch(/tsv/);
  });

  it("ASDLC-1/TC-4 work item id is required", () => {
    const res = accord("evidence");
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/evidence requires a work item id/);
  });
});

describe("ASDLC-1/AC-28 evidence adapter is thin", () => {
  const source = (): string =>
    readFileSync(join(import.meta.dir, "..", "src", "commands", "evidence.ts"), "utf8");

  it("ASDLC-1/AC-28 commands/evidence.ts delegates to accord-core timeline and renderers", () => {
    const text = source();
    expect(text).toMatch(/@clive\.shirley\/accord-core\/evidence\/timeline/);
    for (const symbol of ["readTimeline", "renderTimelineMarkdown", "renderTimelineTsv"]) {
      expect(text).toContain(symbol);
    }
  });

  it("ASDLC-1/AC-28 adapter does not shell out to git or parse trailers itself", () => {
    const text = source();
    expect(text).not.toMatch(/child_process|Bun\.spawn|execa/);
    expect(text).not.toMatch(/parseAccordTrailer|%\(trailers/);
    expect(text).not.toMatch(/from\s+["'][^"']*pi-(accord|subagent|coding-agent)/);
  });
});
