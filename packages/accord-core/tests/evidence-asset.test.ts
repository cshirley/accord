import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AccordTrailer, buildCommitMessage } from "../src/commit/commit-grammar";
import type { DevHarnessConfig } from "../src/config/types";
import { buildEvidenceAsset, writeEvidenceAssets } from "../src/evidence/asset";
import { measureActualLines } from "../src/evidence/lines";
import { findBareAcRefs } from "../src/evidence/qualify-ac";
import { createTempGitRepo, type TempGitRepo } from "./helpers/temp-git-repo";

// Contract pinned by these tests (the spec leaves exact shapes open):
//  - buildEvidenceAsset(id, taskIds, {cwd, config}) -> one { task, md, json } per task id, in the
//    order given; pure function of git commits (typed Accord trailers), commit bodies, review
//    files and plan.json. No timestamps, so output is byte-identical across runs.
//  - writeEvidenceAssets(id, taskIds, {cwd, config}) writes docs/dev/<ID>/evidence/task-<N>.{md,json}
//    and returns the repo-relative paths written.
//  - json: { work_item_id, task, acs[qualified, sorted], loops: { <loop>: { rounds (max round seen),
//    findings {crit,warn,sugg} (summed), responses {addressed,disputed,wont_fix} (summed) } },
//    tests { red {pass,fail}, green {pass,fail} } (from trailers with outcome red / green),
//    tokens {in,out}, cost {usd_u}, size {est_lines (plan.json tasks[].est_lines),
//    act_prod_lines, act_test_lines} }.
//  - red / green excerpts come from the commit BODY of the commit whose trailer outcome is
//    red / green. Findings come from the committed docs/dev/<ID>/reviews/task-<N>/*.md files.
//    Review-to-fix patches are `git diff <review commit>..<next phase commit>` minus reviews/ state/.
//  - actual size: measureActualLines(cwd, base, head, {testPattern}) over
//    <first task commit>^..<last task commit>; changed lines = added + deleted per git numstat.
//    Generated files are files named *.generated.*.
// Note: the ASDLC-1/AC-12 block below is plan-directed (task step 3), not in task.covers_ac.
const ID = "ASDLC-1";
const TEST_PATTERN = "**/*.test.ts";

// Seeds are built at runtime so no full token literal is ever committed.
const GH_TOKEN = ["ghp", "_", "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6"].join("");
const BEARER_TOKEN = ["Bearer ", "q9Zx", "Lm3Rt7", "Vb2Nk8Pw4Hs"].join("");
const BEARER_VALUE = BEARER_TOKEN.slice("Bearer ".length);
const USER_NAME = ["jd", "oe", "-user"].join("");
const HOME_PATH = ["/Users/", USER_NAME, "/src/app/x.ts"].join("");

const CONFIG = {
  test: { command: "bun test", file_pattern: TEST_PATTERN },
  stack: { enabled: true, commits: "phase" },
} as unknown as DevHarnessConfig;

function cfg(stack: Record<string, unknown>): DevHarnessConfig {
  return {
    test: { command: "bun test", file_pattern: TEST_PATTERN },
    stack: { enabled: true, commits: "phase", ...stack },
  } as unknown as DevHarnessConfig;
}

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "ACCORD Test",
  GIT_AUTHOR_EMAIL: "accord-test@example.invalid",
  GIT_COMMITTER_NAME: "ACCORD Test",
  GIT_COMMITTER_EMAIL: "accord-test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

let repo: TempGitRepo;
const seqs = new Map<number, number>();

function run(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo.dir, encoding: "utf8", env: ENV });
}

async function typed(
  files: Record<string, string>,
  t: Partial<AccordTrailer> & { task: number; ref: string; agent: string; outcome: string },
  summary: string,
  body?: string,
): Promise<string> {
  const seq = (seqs.get(t.task) ?? 0) + 1;
  seqs.set(t.task, seq);
  const loop = t.ref.startsWith("C") ? "code" : t.ref.startsWith("V") ? "verify" : "test";
  const trailer = {
    v: 1,
    id: ID,
    seq,
    loop,
    round: Number(/^[A-Z](\d+)/.exec(t.ref)?.[1] ?? 1),
    ...t,
  } as AccordTrailer;
  return repo.commitFiles(files, buildCommitMessage({ summary, body, trailer }));
}

const PLAN = `${JSON.stringify(
  {
    tasks: [
      { id: 2, est_lines: 50 },
      { id: 3, est_lines: 20 },
    ],
  },
  null,
  2,
)}\n`;

const TEST_V1 = `import { foo } from "../src/foo";\ntest("a", () => {\n  expect(foo()).toBe(1);\n`;
const TEST_V2 = `import { foo } from "../src/foo";\ntest("a", () => {\n  expect(foo(token)).toBe(2); // AC-9 ${GH_TOKEN}\n`;
const SRC_V1 =
  "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const e = 5;\n";
const SRC_V2 =
  "export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\nexport const fixedFoo = 5;\n";

const REVIEW_TEST_MD = `# T1/review-test\n\n- warning: FINDING-TEST-SENTINEL tests miss the boundary; violates AC-5 and TC-5 (see ASDLC-1/AC-6)\n- critical: hardcoded ${GH_TOKEN} at ${HOME_PATH}\n`;
const REVIEW_CODE_MD = `# C1/review-code\n\n- warning: FINDING-CODE-SENTINEL unchecked input; see ASDLC-2/AC-3\n`;

/** Task 2 (7 commits) then task 3 (2 commits), on branch `feature` forked from main. */
async function buildHistory(): Promise<{ v1: string }> {
  seqs.clear();
  await repo.commitFiles({ "README.md": "base\n", [`docs/dev/${ID}/plan.json`]: PLAN }, "base");
  run("checkout", "-q", "-b", "feature");
  await typed(
    {
      "tests/foo.test.ts": TEST_V1,
      "bun.lock": "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n",
      "src/api.generated.ts": "g1\ng2\ng3\ng4\ng5\ng6\ng7\n",
      [`docs/dev/${ID}/state/task-2/task.json`]: '{\n  "s": 1\n}\n',
      [`docs/dev/${ID}/evidence/task-9.md`]: "e1\ne2\ne3\ne4\n",
    },
    {
      task: 2,
      ref: "T1/phase-test",
      agent: "phase-test",
      outcome: "red",
      t_pass: 0,
      t_fail: 3,
      tok_in: 1000,
      tok_out: 100,
      usd_u: 10000,
      ac: ["AC-5"],
    },
    "phase-test complete",
    `(fail) AC-7 rejects bad input\nRED-OUTPUT-SENTINEL 3 failing\n${BEARER_TOKEN}\nat ${HOME_PATH}:1`,
  );
  await typed(
    { [`docs/dev/${ID}/reviews/task-2/T1-review-test.md`]: REVIEW_TEST_MD },
    {
      task: 2,
      ref: "T1/review-test",
      agent: "review-test",
      outcome: "findings",
      crit: 1,
      warn: 2,
      sugg: 0,
      tok_in: 2000,
      tok_out: 200,
      usd_u: 20000,
    },
    "review-test 3 finding(s)",
  );
  await typed(
    {
      "tests/foo.test.ts": TEST_V2,
      [`docs/dev/${ID}/state/task-2/task.json`]: '{\n  "s": "STATE-DIFF-SENTINEL"\n}\n',
    },
    {
      task: 2,
      ref: "T2/phase-test",
      agent: "phase-test",
      outcome: "fixed",
      addressed: 2,
      disputed: 1,
      wont_fix: 0,
      tok_in: 3000,
      tok_out: 300,
      usd_u: 30000,
    },
    "phase-test complete",
  );
  await typed(
    { "src/foo.ts": SRC_V1 },
    {
      task: 2,
      ref: "C1/phase-code",
      agent: "phase-code",
      outcome: "green",
      t_pass: 3,
      t_fail: 0,
      tok_in: 4000,
      tok_out: 400,
      usd_u: 40000,
    },
    "phase-code complete",
    `GREEN-OUTPUT-SENTINEL 3 passing\nran in ${HOME_PATH}\n(pass) TC-8 boundary`,
  );
  await typed(
    { [`docs/dev/${ID}/reviews/task-2/C1-review-code.md`]: REVIEW_CODE_MD },
    {
      task: 2,
      ref: "C1/review-code",
      agent: "review-code",
      outcome: "findings",
      crit: 0,
      warn: 1,
      sugg: 3,
      tok_in: 5000,
      tok_out: 500,
      usd_u: 50000,
    },
    "review-code 4 finding(s)",
  );
  await typed(
    { "src/foo.ts": SRC_V2 },
    {
      task: 2,
      ref: "C2/phase-code",
      agent: "phase-code",
      outcome: "fixed",
      addressed: 1,
      disputed: 0,
      wont_fix: 0,
      tok_in: 6000,
      tok_out: 600,
      usd_u: 60000,
    },
    "phase-code complete",
  );
  const v1 = await typed(
    { [`docs/dev/${ID}/state/task-2/verify.json`]: "{}\n" },
    {
      task: 2,
      ref: "V1/phase-verify-task",
      agent: "phase-verify-task",
      outcome: "pass",
      ac_pass: 2,
      ac_fail: 0,
      tok_in: 7000,
      tok_out: 700,
      usd_u: 70000,
      ac: ["AC-5", "AC-6"],
    },
    "phase-verify-task complete",
  );
  await typed(
    { "tests/bar.test.ts": "t1\nt2\n" },
    {
      task: 3,
      ref: "T1/phase-test",
      agent: "phase-test",
      outcome: "red",
      t_pass: 0,
      t_fail: 2,
      tok_in: 11,
      tok_out: 12,
      usd_u: 13,
      ac: ["AC-21"],
    },
    "phase-test complete",
    "TASK3-RED-SENTINEL",
  );
  await typed(
    { "src/bar.ts": "s1\ns2\ns3\ns4\n" },
    {
      task: 3,
      ref: "C1/phase-code",
      agent: "phase-code",
      outcome: "green",
      t_pass: 2,
      t_fail: 0,
      tok_in: 21,
      tok_out: 22,
      usd_u: 23,
    },
    "phase-code complete",
    "TASK3-GREEN-SENTINEL",
  );
  // A commit of ANOTHER work item with the same task number: must never be aggregated.
  await typed(
    { "docs/dev/OTHER-9/x.md": "x\n" },
    {
      id: "OTHER-9",
      task: 2,
      ref: "T1/phase-test",
      agent: "phase-test",
      outcome: "red",
      tok_in: 99999,
      tok_out: 9,
      usd_u: 99999,
    },
    "phase-test complete",
    "FOREIGN-SENTINEL",
  );
  return { v1 };
}

const secretLeaks = (text: string): string[] =>
  [GH_TOKEN, BEARER_VALUE, USER_NAME].filter((secret) => text.includes(secret));

beforeEach(async () => {
  repo = await createTempGitRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

describe("ASDLC-1/AC-5 evidence asset content (ASDLC-1/TC-5)", () => {
  it("json rolls up per loop, tests red to green, tokens, cost and planned vs actual size", async () => {
    await buildHistory();
    const [asset] = await buildEvidenceAsset(ID, [2], { cwd: repo.dir, config: CONFIG });
    expect(asset?.task).toBe(2);
    const json = asset?.json;
    expect(json?.work_item_id).toBe(ID);
    expect(json?.task).toBe(2);
    expect(json?.acs).toEqual([`${ID}/AC-5`, `${ID}/AC-6`]);
    expect(json?.loops.test).toEqual({
      rounds: 2,
      findings: { crit: 1, warn: 2, sugg: 0 },
      responses: { addressed: 2, disputed: 1, wont_fix: 0 },
    });
    expect(json?.loops.code).toEqual({
      rounds: 2,
      findings: { crit: 0, warn: 1, sugg: 3 },
      responses: { addressed: 1, disputed: 0, wont_fix: 0 },
    });
    expect(json?.tests).toEqual({ red: { pass: 0, fail: 3 }, green: { pass: 3, fail: 0 } });
    expect(json?.tokens).toEqual({ in: 28000, out: 2800 });
    expect(json?.cost).toEqual({ usd_u: 280000 });
    // Net diff base..V1 (not a per-commit sum): src/foo.ts 5; tests/foo.test.ts 3.
    // Excluded: bun.lock, *.generated.*, state/, evidence/, reviews/.
    expect(json?.size).toEqual({ est_lines: 50, act_prod_lines: 5, act_test_lines: 3 });
  });

  it("md carries red and green excerpts, findings and the review-to-fix patches", async () => {
    await buildHistory();
    const [asset] = await buildEvidenceAsset(ID, [2], { cwd: repo.dir, config: CONFIG });
    const md = asset?.md ?? "";
    expect(md).toContain("RED-OUTPUT-SENTINEL 3 failing");
    expect(md).toContain("GREEN-OUTPUT-SENTINEL 3 passing");
    expect(md).toContain("FINDING-TEST-SENTINEL");
    expect(md).toContain("FINDING-CODE-SENTINEL");
    // review-test -> next phase (T2): test file patch; review-code -> next phase (C2): src patch.
    expect(md).toContain("+  expect(foo(token)).toBe(2);");
    expect(md).toContain("-  expect(foo()).toBe(1);");
    expect(md).toContain("+export const fixedFoo = 5;");
    expect(md).toContain("-export const e = 5;");
    // state/ changes are excluded from patches
    expect(md).not.toContain("STATE-DIFF-SENTINEL");
    // other task content does not leak in
    expect(md).not.toContain("TASK3-RED-SENTINEL");
    expect(md).not.toContain("TASK3-GREEN-SENTINEL");
    expect(md).not.toContain("FOREIGN-SENTINEL");
    // only review..next-phase patches: not whole-commit patches, lockfiles or generated files
    expect(md).not.toContain("+export const a = 1;");
    expect(md).not.toContain('+import { foo } from "../src/foo";');
    expect(md).not.toContain("+l1");
    expect(md).not.toContain("+g1");
  });

  it("a merged PR (task 2,3) yields one asset per task, each with its own content", async () => {
    await buildHistory();
    const assets = await buildEvidenceAsset(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    expect(assets.map((asset) => asset.task)).toEqual([2, 3]);
    const [two, three] = assets;
    expect(two?.json.task).toBe(2);
    expect(three?.json.task).toBe(3);
    expect(three?.md).toContain("TASK3-RED-SENTINEL");
    expect(three?.md).toContain("TASK3-GREEN-SENTINEL");
    expect(three?.md).not.toContain("RED-OUTPUT-SENTINEL 3 failing");
    expect(three?.json.tests).toEqual({ red: { pass: 0, fail: 2 }, green: { pass: 2, fail: 0 } });
    expect(three?.json.tokens).toEqual({ in: 32, out: 34 });
    expect(three?.json.cost).toEqual({ usd_u: 36 });
    expect(three?.json.size).toEqual({ est_lines: 20, act_prod_lines: 4, act_test_lines: 2 });
    expect(two?.md).not.toContain("TASK3-RED-SENTINEL");
    expect(two?.md).not.toContain("FOREIGN-SENTINEL");
    expect(three?.json.acs).toEqual([`${ID}/AC-21`]);
    expect(three?.json.loops.test?.findings).toEqual({ crit: 0, warn: 0, sugg: 0 });
    expect(three?.md).not.toContain("FINDING-TEST-SENTINEL");
    expect(three?.md).not.toContain("FINDING-CODE-SENTINEL");
  });

  it("multi-round loops sum findings and responses and render every round", async () => {
    seqs.clear();
    await repo.commitFiles({ "README.md": "base\n", [`docs/dev/${ID}/plan.json`]: PLAN }, "base");
    const rev = (name: string) => `docs/dev/${ID}/reviews/task-2/${name}`;
    await typed(
      { "tests/foo.test.ts": TEST_V1 },
      { task: 2, ref: "T1/phase-test", agent: "phase-test", outcome: "red", t_pass: 0, t_fail: 3 },
      "phase-test complete",
    );
    await typed(
      { [rev("T1-review-test.md")]: "# T1\n\n- FINDING-R1\n" },
      {
        task: 2,
        ref: "T1/review-test",
        agent: "review-test",
        outcome: "findings",
        crit: 1,
        warn: 2,
        sugg: 0,
      },
      "review-test findings",
    );
    await typed(
      { "tests/foo.test.ts": `${TEST_V1}+R2-FIX\n` },
      {
        task: 2,
        ref: "T2/phase-test",
        agent: "phase-test",
        outcome: "fixed",
        addressed: 2,
        disputed: 1,
        wont_fix: 0,
      },
      "phase-test complete",
    );
    await typed(
      { [rev("T2-review-test.md")]: "# T2\n\n- FINDING-R2\n" },
      {
        task: 2,
        ref: "T2/review-test",
        agent: "review-test",
        outcome: "findings",
        crit: 0,
        warn: 1,
        sugg: 1,
      },
      "review-test findings",
    );
    await typed(
      { "tests/foo.test.ts": `${TEST_V1}+R2-FIX\n+R3-FIX\n` },
      {
        task: 2,
        ref: "T3/phase-test",
        agent: "phase-test",
        outcome: "fixed",
        addressed: 1,
        disputed: 0,
        wont_fix: 1,
      },
      "phase-test complete",
    );
    await typed(
      { "src/foo.ts": SRC_V1 },
      {
        task: 2,
        ref: "C1/phase-code",
        agent: "phase-code",
        outcome: "green",
        t_pass: 3,
        t_fail: 0,
      },
      "phase-code complete",
    );
    const [asset] = await buildEvidenceAsset(ID, [2], { cwd: repo.dir, config: CONFIG });
    expect(asset?.json.loops.test).toEqual({
      rounds: 3,
      findings: { crit: 1, warn: 3, sugg: 1 },
      responses: { addressed: 3, disputed: 1, wont_fix: 1 },
    });
    const md = asset?.md ?? "";
    expect(md).toContain("FINDING-R1");
    expect(md).toContain("FINDING-R2");
    expect(md).toContain("R2-FIX");
    expect(md).toContain("R3-FIX");
  });

  it("writeEvidenceAssets writes docs/dev/<ID>/evidence/task-<N>.{md,json} per task", async () => {
    await buildHistory();
    const written = await writeEvidenceAssets(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    const dir = `docs/dev/${ID}/evidence`;
    expect([...written].sort()).toEqual(
      [`${dir}/task-2.json`, `${dir}/task-2.md`, `${dir}/task-3.json`, `${dir}/task-3.md`].sort(),
    );
    const assets = await buildEvidenceAsset(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    for (const asset of assets) {
      const md = readFileSync(join(repo.dir, dir, `task-${asset.task}.md`), "utf8");
      const json = JSON.parse(readFileSync(join(repo.dir, dir, `task-${asset.task}.json`), "utf8"));
      expect(md).toBe(asset.md);
      expect(readFileSync(join(repo.dir, dir, `task-${asset.task}.json`), "utf8")).toBe(
        `${JSON.stringify(asset.json, null, 2)}\n`,
      );
      expect(json).toEqual(JSON.parse(JSON.stringify(asset.json)));
    }
  });

  it("output is byte-identical across two runs", async () => {
    await buildHistory();
    const first = await buildEvidenceAsset(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    const second = await buildEvidenceAsset(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    expect(second.map((a) => a.md)).toEqual(first.map((a) => a.md));
    expect(second.map((a) => JSON.stringify(a.json))).toEqual(
      first.map((a) => JSON.stringify(a.json)),
    );
    await writeEvidenceAssets(ID, [2], { cwd: repo.dir, config: CONFIG });
    const bytes = readFileSync(join(repo.dir, `docs/dev/${ID}/evidence/task-2.json`));
    await writeEvidenceAssets(ID, [2], { cwd: repo.dir, config: CONFIG });
    expect(readFileSync(join(repo.dir, `docs/dev/${ID}/evidence/task-2.json`)).equals(bytes)).toBe(
      true,
    );
  });

  it("regenerates identically from a fresh clone, at a frozen later time and at the task's last commit", async () => {
    const { v1 } = await buildHistory();
    const first = await buildEvidenceAsset(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    const dir2 = join(mkdtempSync(join(tmpdir(), "accord-clone-")), "clone");
    try {
      execFileSync("git", ["clone", "-q", repo.dir, dir2], { env: ENV });
      setSystemTime(new Date("2035-06-01T00:00:00Z"));
      let second: Awaited<ReturnType<typeof buildEvidenceAsset>>;
      try {
        second = await buildEvidenceAsset(ID, [2, 3], { cwd: dir2, config: CONFIG });
      } finally {
        setSystemTime();
      }
      expect(second.map((a) => a.md)).toEqual(first.map((a) => a.md));
      expect(second.map((a) => JSON.stringify(a.json))).toEqual(
        first.map((a) => JSON.stringify(a.json)),
      );
      execFileSync("git", ["checkout", "-q", v1], { cwd: dir2, env: ENV });
      const atV1 = await buildEvidenceAsset(ID, [2], { cwd: dir2, config: CONFIG });
      expect(atV1[0]?.md).toEqual(first[0]?.md);
      expect(JSON.stringify(atV1[0]?.json)).toEqual(JSON.stringify(first[0]?.json));
    } finally {
      rmSync(join(dir2, ".."), { recursive: true, force: true });
    }
  });

  it("squash-merge simulation keeps the asset files", async () => {
    await buildHistory();
    const dir = `docs/dev/${ID}/evidence`;
    await writeEvidenceAssets(ID, [2], { cwd: repo.dir, config: CONFIG });
    const before = {
      md: readFileSync(join(repo.dir, dir, "task-2.md"), "utf8"),
      json: readFileSync(join(repo.dir, dir, "task-2.json"), "utf8"),
    };
    run("add", "-A");
    run("commit", "-q", "-m", "evidence(task-2)");
    run("checkout", "-q", "main");
    expect(existsSync(join(repo.dir, dir, "task-2.md"))).toBe(false);
    run("merge", "--squash", "feature");
    run("commit", "-q", "-m", "squash: task 2");
    expect(run("rev-list", "--count", "main").trim()).toBe("2");
    expect(readFileSync(join(repo.dir, dir, "task-2.md"), "utf8")).toBe(before.md);
    expect(readFileSync(join(repo.dir, dir, "task-2.json"), "utf8")).toBe(before.json);
  });

  it("include_diffs false drops excerpts and patches but keeps findings and roll-up", async () => {
    await buildHistory();
    const [asset] = await buildEvidenceAsset(ID, [2], {
      cwd: repo.dir,
      config: cfg({ evidence: { asset: true, include_diffs: false } }),
    });
    const md = asset?.md ?? "";
    expect(md).not.toContain("RED-OUTPUT-SENTINEL");
    expect(md).not.toContain("GREEN-OUTPUT-SENTINEL");
    expect(md).not.toContain("fixedFoo");
    expect(md).not.toContain("expect(foo(token))");
    expect(md).toContain("FINDING-TEST-SENTINEL");
    expect(secretLeaks(md)).toEqual([]);
    expect(JSON.stringify(asset?.json)).not.toContain("RED-OUTPUT-SENTINEL");
    expect(JSON.stringify(asset?.json)).not.toContain("GREEN-OUTPUT-SENTINEL");
    expect(asset?.json.tests).toEqual({ red: { pass: 0, fail: 3 }, green: { pass: 3, fail: 0 } });
    expect(JSON.stringify(asset?.json)).not.toContain("fixedFoo");
  });
});

describe("ASDLC-1/AC-5 measureActualLines (ASDLC-1/TC-5)", () => {
  it("counts production and test lines separately and excludes generated, lock, state, reviews, evidence", async () => {
    const base = await repo.commitFiles({ "README.md": "x\n" }, "base");
    const head = await repo.commitFiles(
      {
        "src/a.ts": "1\n2\n3\n",
        "src/deep/b.ts": "1\n2\n",
        "tests/a.test.ts": "1\n2\n3\n4\n",
        "bun.lock": "1\n2\n3\n4\n5\n",
        "package-lock.json": "1\n2\n3\n",
        "packages/x/yarn.lock": "1\n2\n",
        "pnpm-lock.yaml": "1\n2\n",
        "src/types.generated.ts": "1\n2\n3\n4\n5\n6\n",
        [`docs/dev/${ID}/state/task-2/task.json`]: "1\n2\n3\n",
        [`docs/dev/${ID}/reviews/task-2/T1-review-test.md`]: "1\n2\n3\n",
        [`docs/dev/${ID}/evidence/task-2.md`]: "1\n2\n3\n",
      },
      "work",
    );
    expect(await measureActualLines(repo.dir, base, head, { testPattern: TEST_PATTERN })).toEqual({
      act_prod_lines: 5,
      act_test_lines: 4,
    });
  });

  it("counts deletions as changed lines, and the range is exclusive of base", async () => {
    await repo.commitFiles({ "src/a.ts": "1\n2\n3\n" }, "c0");
    const base = await repo.commitFiles(
      { "src/a.ts": "1\n2\n3\n4\n5\n", "tests/a.test.ts": "1\n2\n" },
      "base",
    );
    const head = await repo.commitFiles(
      { "src/a.ts": "1\nX\n3\n4\n5\n", "tests/a.test.ts": "1\n" },
      "edit",
    );
    // src: 1 del + 1 add = 2 (an inclusive range would give 4); test: 1 del
    expect(await measureActualLines(repo.dir, base, head, { testPattern: TEST_PATTERN })).toEqual({
      act_prod_lines: 2,
      act_test_lines: 1,
    });
  });

  it("measures the net diff over several commits, not the sum of per-commit changes", async () => {
    const base = await repo.commitFiles({ "README.md": "x\n" }, "base");
    await repo.commitFiles({ "src/a.ts": "1\n2\n3\n", "tests/a.test.ts": "1\n2\n" }, "c1");
    rmSync(join(repo.dir, "tests/a.test.ts"));
    const head = await repo.commitFiles(
      { "src/a.ts": "1\nX\n3\n", "tests/b.test.ts": "1\n" },
      "c2",
    );
    // a per-commit sum would give 5 / 5
    expect(await measureActualLines(repo.dir, base, head, { testPattern: TEST_PATTERN })).toEqual({
      act_prod_lines: 3,
      act_test_lines: 1,
    });
  });

  const lines = (count: number): string =>
    Array.from({ length: count }, (_, n) => `l${n}\n`).join("");
  it.each([
    {
      group: "A",
      pattern: "**/*.test.ts",
      files: {
        "packages/accord-core/src/state/redact.ts": 3,
        "packages/accord-core/src/evidence/asset.ts": 2,
        "src/reviews/list.ts": 1,
        "src/block.ts": 1,
        "root.test.ts": 1,
      },
      expected: { act_prod_lines: 7, act_test_lines: 1 },
    },
    {
      group: "B",
      pattern: "**/*.spec.ts",
      files: { "src/x.spec.ts": 2, "tests/y.test.ts": 3 },
      expected: { act_prod_lines: 3, act_test_lines: 2 },
    },
  ])("classifies paths by the test pattern, not by substring (group $group)", async (row) => {
    const base = await repo.commitFiles({ "README.md": "x\n" }, "base");
    const head = await repo.commitFiles(
      Object.fromEntries(Object.entries(row.files).map(([path, count]) => [path, lines(count)])),
      "work",
    );
    expect(await measureActualLines(repo.dir, base, head, { testPattern: row.pattern })).toEqual(
      row.expected,
    );
  });

  it("counts binary files (numstat '-') as zero lines, never NaN", async () => {
    const base = await repo.commitFiles({ "README.md": "x\n" }, "base");
    const head = await repo.commitFiles(
      { "src/a.ts": "1\n2\n", "assets/logo.bin": "\u0000\u0001\u0002bin" },
      "work",
    );
    expect(await measureActualLines(repo.dir, base, head, { testPattern: TEST_PATTERN })).toEqual({
      act_prod_lines: 2,
      act_test_lines: 0,
    });
  });

  it("an empty range measures zero", async () => {
    const head = await repo.commitFiles({ "src/a.ts": "1\n" }, "base");
    expect(await measureActualLines(repo.dir, head, head, { testPattern: TEST_PATTERN })).toEqual({
      act_prod_lines: 0,
      act_test_lines: 0,
    });
  });
});

describe("ASDLC-1/AC-6 qualified AC references (ASDLC-1/TC-6)", () => {
  it("every AC/TC reference in md and json is ASDLC-1/AC-<n>", async () => {
    await buildHistory();
    const assets = await buildEvidenceAsset(ID, [2, 3], { cwd: repo.dir, config: CONFIG });
    for (const asset of assets) {
      expect(findBareAcRefs(asset.md)).toEqual([]);
      expect(findBareAcRefs(JSON.stringify(asset.json))).toEqual([]);
    }
    const [two] = assets;
    // trailer ac=AC-5,AC-6 and the bare "AC-5 and TC-5" in a finding are qualified, not dropped
    expect(two?.md).toContain(`${ID}/AC-5`);
    expect(two?.md).toContain(`${ID}/AC-6`);
    expect(two?.md).toContain(`${ID}/TC-5`);
    // bare refs seeded in a red excerpt, a green excerpt and a review-to-fix patch
    expect(two?.md).toContain(`${ID}/AC-7`);
    expect(two?.md).toContain(`${ID}/TC-8`);
    expect(two?.md).toContain(`${ID}/AC-9`);
    // a ref already qualified with another work item is left alone
    expect(two?.md).toContain("ASDLC-2/AC-3");
    expect(two?.md).not.toContain(`${ID}/AC-3`);
    // an already-qualified ref is not qualified twice
    expect(two?.md).not.toContain(`${ID}/${ID}/`);
    expect(JSON.stringify(two?.json)).not.toContain(`${ID}/${ID}/`);
  });

  it("a bare reference is detected (guard against a vacuous check)", () => {
    expect(findBareAcRefs("covers AC-5")).toEqual(["AC-5"]);
    expect(findBareAcRefs(`covers ${ID}/AC-5`)).toEqual([]);
  });
});

describe("ASDLC-1/AC-12 redaction and size cap", () => {
  it("masks seeded secrets, Bearer headers and home paths in md and json", async () => {
    await buildHistory();
    const [asset] = await buildEvidenceAsset(ID, [2], { cwd: repo.dir, config: CONFIG });
    const md = asset?.md ?? "";
    const json = JSON.stringify(asset?.json);
    expect(secretLeaks(md)).toEqual([]);
    expect(secretLeaks(json)).toEqual([]);
    // the excerpts and the patch are still present, masked, not dropped
    expect(md).toContain("RED-OUTPUT-SENTINEL");
    expect(md).toContain("GREEN-OUTPUT-SENTINEL");
    expect(md).toContain("[REDACTED]");
    expect(md).toContain("+  expect(foo(token)).toBe(2);");
  });

  it("masks secrets in the written files too", async () => {
    await buildHistory();
    const written = await writeEvidenceAssets(ID, [2], { cwd: repo.dir, config: CONFIG });
    expect(written.length).toBe(2);
    for (const rel of written) {
      expect(secretLeaks(readFileSync(join(repo.dir, rel), "utf8"))).toEqual([]);
    }
  });

  it("caps md and json at stack.state.max_bytes and keeps the json valid", async () => {
    await repo.commitFiles({ "README.md": "x\n", [`docs/dev/${ID}/plan.json`]: PLAN }, "base");
    seqs.clear();
    const huge = Array.from({ length: 2000 }, (_, n) => `output line ${n} ${"x".repeat(40)}`).join(
      "\n",
    );
    await typed(
      { "tests/foo.test.ts": TEST_V1 },
      { task: 2, ref: "T1/phase-test", agent: "phase-test", outcome: "red", t_pass: 0, t_fail: 3 },
      "phase-test complete",
      huge,
    );
    await typed(
      { "src/foo.ts": SRC_V1 },
      {
        task: 2,
        ref: "C1/phase-code",
        agent: "phase-code",
        outcome: "green",
        t_pass: 3,
        t_fail: 0,
      },
      "phase-code complete",
      huge,
    );
    const maxBytes = 4000;
    const uncapped = await buildEvidenceAsset(ID, [2], {
      cwd: repo.dir,
      config: cfg({ state: { max_bytes: 10_000_000 } }),
    });
    expect(Buffer.byteLength(uncapped[0]?.md ?? "")).toBeGreaterThan(maxBytes);
    const [capped] = await buildEvidenceAsset(ID, [2], {
      cwd: repo.dir,
      config: cfg({ state: { max_bytes: maxBytes } }),
    });
    expect(Buffer.byteLength(capped?.md ?? "")).toBeLessThanOrEqual(maxBytes);
    const jsonText = JSON.stringify(capped?.json);
    expect(Buffer.byteLength(jsonText)).toBeLessThanOrEqual(maxBytes);
    expect(JSON.parse(jsonText).tests).toEqual({
      red: { pass: 0, fail: 3 },
      green: { pass: 3, fail: 0 },
    });
  });

  async function seedBodies(red: string, green: string, extra: Record<string, string> = {}) {
    seqs.clear();
    await repo.commitFiles({ "README.md": "x\n", [`docs/dev/${ID}/plan.json`]: PLAN }, "base");
    await typed(
      { "tests/foo.test.ts": TEST_V1, ...extra },
      { task: 2, ref: "T1/phase-test", agent: "phase-test", outcome: "red", t_pass: 0, t_fail: 3 },
      "phase-test complete",
      red,
    );
    await typed(
      { "src/foo.ts": SRC_V1 },
      {
        task: 2,
        ref: "C1/phase-code",
        agent: "phase-code",
        outcome: "green",
        t_pass: 3,
        t_fail: 0,
      },
      "phase-code complete",
      green,
    );
  }

  it.each([
    {
      name: "multibyte",
      config: cfg({ state: { max_bytes: 4000 } }),
      limit: 4000,
      red: () =>
        Array.from({ length: 2000 }, (_, n) => `✓ line ${n} — é ${"x".repeat(30)}`).join("\n"),
      green: () =>
        Array.from({ length: 2000 }, (_, n) => `✓ line ${n} — é ${"x".repeat(30)}`).join("\n"),
      extra: {} as Record<string, string>,
    },
    {
      name: "default cap",
      config: CONFIG,
      limit: 262144,
      red: () => Array.from({ length: 1900 }, (_, n) => `r${n} ${"x".repeat(56)}`).join("\n"),
      green: () => Array.from({ length: 1900 }, (_, n) => `g${n} ${"y".repeat(56)}`).join("\n"),
      extra: {
        [`docs/dev/${ID}/reviews/task-2/T1-review-test.md`]: Array.from(
          { length: 1700 },
          (_, n) => `- finding ${n} ${"z".repeat(52)}`,
        ).join("\n"),
      },
    },
    {
      name: "secret at cut",
      config: cfg({ state: { max_bytes: 4000 } }),
      limit: 4000,
      red: () => Array.from({ length: 3000 }, () => GH_TOKEN).join(" "),
      green: () => Array.from({ length: 3000 }, () => GH_TOKEN).join(" "),
      extra: {} as Record<string, string>,
    },
  ])("size cap partition: $name", async (row) => {
    await seedBodies(row.red(), row.green(), row.extra);
    const [asset] = await buildEvidenceAsset(ID, [2], { cwd: repo.dir, config: row.config });
    const md = asset?.md ?? "";
    expect(Buffer.byteLength(md)).toBeLessThanOrEqual(row.limit);
    expect(Buffer.byteLength(JSON.stringify(asset?.json))).toBeLessThanOrEqual(row.limit);
    expect(md).not.toContain("\uFFFD");
    expect(md).not.toContain(["ghp", "_"].join(""));
    expect(md).not.toContain(GH_TOKEN.slice(4, 16));
  });
});
