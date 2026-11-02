import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { buildCommitMessage, parseAccordTrailer } from "../src/commit/commit-grammar.js";
import { registerPrGroupResolver } from "../src/commit/hooks.js";
import { resolveStackConfig } from "../src/config/stack-flags.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { computeStack } from "../src/stack/compute-stack.js";
import type {
  CreateOrUpdatePrInput,
  EvidenceState,
  StackPr,
  StackProvider,
} from "../src/stack/provider.js";
import { renderStackReport, renderStackTable } from "../src/stack/render.js";
import { stackReport, stackShow, stackSubmit, stackSync } from "../src/stack/service.js";
import { ACCORD_TOOLS } from "../src/tools/registry.js";

// Pinned contract (spec leaves shapes open):
//  stackX(workItemId, devConfig, { cwd?, provider? }) -> Promise<{ ok, text }>.
//  The plan is read from <cwd>/docs/dev/<ID>/plan.json; sizing from resolveStackConfig(devConfig).
//  Tools dev_stack / dev_stack_sync / dev_stack_submit / dev_stack_report take { id } and return the
//  service `text` unchanged (cwd = process.cwd()). Disabled (stack.enabled !== true) text names
//  `stack.enabled` and never touches a provider.
//  Proving tests in the PR brief come from docs/dev/<ID>/spec.json test_cases (test_name_glob).
//  The brief's contract link is the sha-pinned permalink
//  https://github.com/<owner>/<repo>/blob/<sha of tag accord/<ID>/contract>/docs/dev/<ID>/contract.lock.json
//  derived from the `origin` remote URL. The PR brief reading order is the task's file paths.
//  Per-PR accord/evidence status: one per task PR, on that PR head's sha, state "pending"
//  while no evidence commit exists.
const ID = "ASDLC-1";
const ENABLED = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { enabled: true, provider: "gh" },
} as unknown as DevHarnessConfig;
const CUSTOM = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { enabled: true, provider: "gh", sizing: { min_pr_lines: 250 } },
} as unknown as DevHarnessConfig;
const DISABLED = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { enabled: false },
} as unknown as DevHarnessConfig;

const PLAN = {
  work_item_id: ID,
  tasks: [
    {
      id: 1,
      title: "Alpha task",
      covers_ac: ["AC-1"],
      concern: "alpha",
      est_lines: 200,
      files: [{ path: "src/a.ts", action: "add" }],
    },
    {
      id: 2,
      title: "Beta task",
      covers_ac: ["AC-2"],
      depends_on: [1],
      concern: "beta",
      est_lines: 200,
      files: [{ path: "src/b.ts", action: "add" }],
    },
  ],
};

let originalCwd: string;
let originalPath: string | undefined;
let repo: string;
let origin: string;
const cleanups: string[] = [];

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function writePlan(plan: unknown): void {
  write(join(repo, "docs", "dev", ID, "plan.json"), JSON.stringify(plan, null, 2));
}

beforeEach(() => {
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-svc-")));
  origin = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-origin-")));
  cleanups.push(repo, origin);
  execFileSync("git", ["init", "-q", "--bare"], { cwd: origin });
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/o/r.git");
  git("config", `url.${origin}.pushInsteadOf`, "https://github.com/o/r.git");
  write(join(repo, "README.md"), "# repo\n");
  writePlan(PLAN);
  write(
    join(repo, "docs", "dev", ID, "spec.json"),
    JSON.stringify({
      work_item_id: ID,
      verification: {
        test_cases: [
          { id: "TC-1", covers: "AC-1", test_name_glob: "tests/a.test.ts", scenario: "s" },
        ],
      },
    }),
  );
  write(join(repo, "docs", "dev", ID, "contract.lock.json"), '{"locked":true}');
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("tag", `accord/${ID}/contract`);
  git("push", "-q", "origin", "main");
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface FakeProvider extends StackProvider {
  creates: CreateOrUpdatePrInput[];
  comments: { pr: number; workItemId: string; body: string }[];
  statuses: { sha: string; state: EvidenceState; description?: string }[];
  pushes: unknown[];
  ensures: unknown[];
  listCalls: unknown[];
  prs: Map<string, StackPr>;
}

function fakeProvider(): FakeProvider {
  const prs = new Map<string, StackPr>();
  const fake: FakeProvider = {
    creates: [],
    comments: [],
    statuses: [],
    pushes: [],
    ensures: [],
    listCalls: [],
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
    async upsertStackMapComment(input) {
      fake.comments.push(input);
    },
    async setEvidenceStatus(input) {
      fake.statuses.push(input);
    },
    async listPrs(input) {
      fake.listCalls.push(input);
      return [...prs.values()].filter(
        (pr) =>
          (input?.head === undefined || pr.head === input.head) &&
          (input?.state === undefined || input.state === "all" || pr.state === input.state),
      );
    },
    async ensureBranch(input) {
      fake.ensures.push(input);
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
    async pushBranch(input) {
      fake.pushes.push(input);
    },
  };
  return fake;
}

function noProviderCalls(fake: FakeProvider): void {
  expect(fake.creates).toEqual([]);
  expect(fake.comments).toEqual([]);
  expect(fake.statuses).toEqual([]);
  expect(fake.pushes).toEqual([]);
  expect(fake.ensures).toEqual([]);
  expect(fake.listCalls).toEqual([]);
}

// --- fake gh binary (for the real gh provider path) ------------------------------------------
interface Rule {
  all: string[];
  json?: unknown;
  stdout?: string;
}
function installGh(rules: Rule[]): { calls(): string[][] } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-svc-gh-")));
  cleanups.push(dir);
  const callsFile = join(dir, "calls.jsonl");
  writeFileSync(callsFile, "");
  writeFileSync(join(dir, "rules.json"), JSON.stringify(rules));
  const script = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(argv) + "\\n");
const rules = JSON.parse(readFileSync(${JSON.stringify(join(dir, "rules.json"))}, "utf8"));
const joined = argv.join(" ");
const rule = rules.find((r) => r.all.every((p) => new RegExp(p).test(joined)));
if (!rule) { process.stderr.write("fake gh: no rule for " + joined + "\\n"); process.exit(127); }
if (rule.json !== undefined) process.stdout.write(JSON.stringify(rule.json));
else if (rule.stdout !== undefined) process.stdout.write(rule.stdout);
`;
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  process.env.PATH = `${dir}${delimiter}${originalPath ?? ""}`;
  return {
    calls: () =>
      readFileSync(callsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}
function ghRules(evidenceStatus: unknown[] = []): Rule[] {
  return [
    { all: ["^pr list"], json: [] },
    { all: ["^pr create"], stdout: "https://github.com/o/r/pull/11\n" },
    { all: ["^api .*commits/.*/status"], json: { statuses: evidenceStatus } },
    { all: ["^api .*issues/.*comments"], json: [] },
    { all: [""], stdout: "[]" },
  ];
}

function tool(name: string) {
  const found = ACCORD_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
}
const runTool = (name: string, config: DevHarnessConfig) =>
  tool(name).handler({ id: ID } as never, { getConfig: () => config });

const MERGED_PLAN = {
  work_item_id: ID,
  tasks: [
    {
      id: 3,
      title: "Three",
      covers_ac: ["AC-3"],
      concern: "c",
      est_lines: 10,
      files: [{ path: "a.ts", action: "add" }],
    },
    {
      id: 4,
      title: "Four",
      covers_ac: ["AC-4"],
      concern: "c",
      est_lines: 10,
      files: [{ path: "b.ts", action: "add" }],
    },
    {
      id: 5,
      title: "Five",
      covers_ac: ["AC-5"],
      concern: "other",
      est_lines: 200,
      files: [{ path: "c.ts", action: "add" }],
    },
  ],
};

const createFor = (fake: FakeProvider, title: string) =>
  fake.creates.find((call) => call.title.includes(title));

function commitTrailer(trailer: Record<string, unknown>, file: string): void {
  write(join(repo, file), file);
  git("add", "-A");
  git("commit", "-q", "-m", buildCommitMessage({ summary: "x", trailer: trailer as never }));
}
function parsedTrailer(trailer: Record<string, unknown>) {
  const message = buildCommitMessage({ summary: "x", trailer: trailer as never });
  return parseAccordTrailer(message) as NonNullable<ReturnType<typeof parseAccordTrailer>>;
}

describe("ASDLC-1/AC-11 stackShow", () => {
  it("ASDLC-1/AC-11 returns the computed stack table for the plan", async () => {
    const result = await stackShow(ID, ENABLED, { cwd: repo });
    const sizing = resolveStackConfig(ENABLED).sizing;
    const expected = renderStackTable(ID, computeStack(PLAN as never, sizing), PLAN.tasks as never);
    expect(result.ok).toBe(true);
    expect(result.text).toContain(expected);
    expect(result.text).toContain("ASDLC-1/AC-2");
  });

  it("ASDLC-1/AC-11 honours options.cwd rather than process.cwd()", async () => {
    process.chdir(tmpdir());
    const sizing = resolveStackConfig(ENABLED).sizing;
    const expected = renderStackTable(ID, computeStack(PLAN as never, sizing), PLAN.tasks as never);
    const shown = await stackShow(ID, ENABLED, { cwd: repo });
    expect(shown.text).toContain(expected);
    const fake = fakeProvider();
    const submitted = await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    expect(submitted.ok).toBe(true);
    expect(fake.creates.length).toBe(2);
    expect(createFor(fake, "Alpha")?.base).toBe("main");
    const cwdTrailer = {
      v: 1,
      id: ID,
      task: 1,
      seq: 1,
      ref: "T1/phase-test",
      agent: "phase-test",
      loop: "test",
      round: 1,
      outcome: "red",
      tok_in: 11,
      tok_out: 1,
    };
    commitTrailer(cwdTrailer, "cwd.txt");
    const report = await stackReport(ID, ENABLED, { cwd: repo });
    const reportTable = renderStackReport(ID, [
      { pr: 1, task: 1, trailers: [parsedTrailer(cwdTrailer)] },
    ]);
    const row = reportTable.split("\n").find((line) => /^\| 1 \| 1 \|/.test(line));
    expect(row).toBeDefined();
    expect(report.text).toContain(row as string);
  });

  it("ASDLC-1/AC-11 uses the configured stack.sizing", async () => {
    const plan = {
      work_item_id: ID,
      tasks: [
        {
          id: 1,
          title: "X1",
          covers_ac: ["AC-1"],
          concern: "x",
          est_lines: 200,
          files: [{ path: "x1.ts", action: "add" }],
        },
        {
          id: 2,
          title: "X2",
          covers_ac: ["AC-2"],
          concern: "x",
          est_lines: 200,
          files: [{ path: "x2.ts", action: "add" }],
        },
      ],
    };
    writePlan(plan);
    const custom = await stackShow(ID, CUSTOM, { cwd: repo });
    const defaults = await stackShow(ID, ENABLED, { cwd: repo });
    const customTable = renderStackTable(
      ID,
      computeStack(plan as never, resolveStackConfig(CUSTOM).sizing),
      plan.tasks as never,
    );
    const defaultTable = renderStackTable(
      ID,
      computeStack(plan as never, resolveStackConfig(ENABLED).sizing),
      plan.tasks as never,
    );
    expect(customTable).not.toBe(defaultTable);
    expect(customTable).toMatch(/\| 1, 2 \|/);
    expect(custom.text).toContain(customTable);
    expect(defaults.text).toContain(defaultTable);
    expect(defaults.text).not.toContain(customTable);
  });
});

describe("ASDLC-1/AC-11 stackSubmit", () => {
  it("ASDLC-1/AC-11 creates a PR per task with brief, stack map comment and evidence status", async () => {
    const fake = fakeProvider();
    const result = await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    expect(result.ok).toBe(true);
    expect(fake.creates.length).toBe(2);
    const alpha = createFor(fake, "Alpha task");
    const beta = createFor(fake, "Beta task");
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    if (!alpha || !beta) return;
    // Independent task PR branches from main; dependent PR stacks on the dependency's branch.
    expect(alpha.base).toBe("main");
    expect(beta.base).toBe(alpha.head);
    expect(alpha.head).not.toBe(beta.head);
    expect(alpha.body).not.toContain("ASDLC-1/AC-2");
    expect(beta.body).toContain("ASDLC-1/AC-2");
    // Contract permalink (sha of the contract tag) is the first link, before the ACs.
    const contractSha = git("rev-parse", `accord/${ID}/contract^{commit}`).trim();
    const link = /\]\((https:[^)]+)\)/.exec(alpha.body)?.[1];
    expect(link).toBe(
      `https://github.com/o/r/blob/${contractSha}/docs/dev/${ID}/contract.lock.json`,
    );
    const body = alpha.body;
    const order = [
      body.indexOf(link as string),
      body.indexOf("## Acceptance criteria"),
      body.indexOf("ASDLC-1/AC-1"),
      body.indexOf("tests/a.test.ts"),
      body.indexOf("## Process summary"),
      body.indexOf("## Reading order"),
      body.indexOf("1. src/a.ts"),
    ];
    for (const position of order) expect(position).toBeGreaterThanOrEqual(0);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    const summary = body.slice(
      body.indexOf("## Process summary") + "## Process summary".length,
      body.indexOf("## Reading order"),
    );
    expect(summary.trim().length).toBeGreaterThan(0);
    // Map comments: exactly one per task PR, identical bodies listing both PRs and their ACs.
    const alphaNumber = fake.prs.get(alpha.head)?.number as number;
    const betaNumber = fake.prs.get(beta.head)?.number as number;
    expect(fake.comments.map((comment) => comment.pr).sort()).toEqual(
      [alphaNumber, betaNumber].sort(),
    );
    expect(new Set(fake.comments.map((comment) => comment.body)).size).toBe(1);
    for (const comment of fake.comments) {
      expect(comment.workItemId).toBe(ID);
      expect(comment.body).toContain("Stack map");
      expect(comment.body).toContain(`https://github.com/o/r/pull/${alphaNumber}`);
      expect(comment.body).toContain(`https://github.com/o/r/pull/${betaNumber}`);
      expect(comment.body).toContain("ASDLC-1/AC-1");
      expect(comment.body).toContain("ASDLC-1/AC-2");
    }
    // accord/evidence status: one per task PR, on that PR head's own sha, pending (no evidence commit).
    expect(fake.statuses.length).toBe(2);
    const headShas = [alpha.head, beta.head].map((head) =>
      git("rev-parse", `refs/heads/${head}`).trim(),
    );
    expect(headShas[0]).not.toBe(headShas[1]);
    expect(fake.statuses.map((status) => status.sha).sort()).toEqual([...headShas].sort());
    for (const status of fake.statuses) expect(status.state).toBe("pending");
  });

  it("ASDLC-1/AC-11 groups merged tasks into one PR with the union of ACs", async () => {
    writePlan(MERGED_PLAN);
    const fake = fakeProvider();
    const result = await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    expect(result.ok).toBe(true);
    expect(new Set(fake.creates.map((call) => call.head)).size).toBe(2);
    const group = createFor(fake, "Three");
    expect(group).toBeDefined();
    expect(group?.body).toContain("ASDLC-1/AC-3");
    expect(group?.body).toContain("ASDLC-1/AC-4");
    expect(group?.body).not.toContain("ASDLC-1/AC-5");
    expect(
      fake.creates.filter((call) => call.title.includes("Four") && !call.title.includes("Three")),
    ).toEqual([]);
    const other = createFor(fake, "Five");
    expect(other?.head).not.toBe(group?.head);
    expect(other?.base).toBe("main");
  });

  it("ASDLC-1/AC-11 independent task after a dependency chain branches from main", async () => {
    writePlan({
      work_item_id: ID,
      tasks: [
        {
          id: 1,
          title: "Alpha task",
          covers_ac: ["AC-1"],
          concern: "alpha",
          est_lines: 200,
          files: [{ path: "src/a.ts", action: "add" }],
        },
        {
          id: 2,
          title: "Beta task",
          covers_ac: ["AC-2"],
          depends_on: [1],
          concern: "beta",
          est_lines: 200,
          files: [{ path: "src/b.ts", action: "add" }],
        },
        {
          id: 3,
          title: "Gamma task",
          covers_ac: ["AC-3"],
          concern: "gamma",
          est_lines: 200,
          files: [{ path: "src/g.ts", action: "add" }],
        },
      ],
    });
    const fake = fakeProvider();
    await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    expect(fake.creates.length).toBe(3);
    expect(createFor(fake, "Gamma")?.base).toBe("main");
    expect(createFor(fake, "Beta")?.base).toBe(createFor(fake, "Alpha")?.head as string);
  });

  it("ASDLC-1/AC-11 pushes every branch with only the branch (no force) and is idempotent on rerun", async () => {
    const fake = fakeProvider();
    await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    const heads = fake.creates.map((call) => call.head);
    expect(heads.length).toBeGreaterThanOrEqual(2);
    for (const head of heads) expect(fake.pushes).toContainEqual({ branch: head });
    for (const push of fake.pushes) expect(Object.keys(push as object)).toEqual(["branch"]);
    const firstNumbers = [...fake.prs.values()].map((pr) => pr.number).sort();
    await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    expect([...fake.prs.values()].map((pr) => pr.number).sort()).toEqual(firstNumbers);
    expect(new Set(fake.creates.map((call) => call.head))).toEqual(new Set(heads));
  });

  it("ASDLC-1/AC-11 never overwrites a failing accord/evidence status (real gh provider)", async () => {
    const gh = installGh(ghRules([{ context: "accord/evidence", state: "failure" }]));
    const result = await stackSubmit(ID, ENABLED, { cwd: repo });
    expect(result.ok).toBe(true);
    const argvs = gh.calls();
    const calls = argvs.map((argv) => argv.join(" "));
    expect(calls.some((call) => /^pr create /.test(call))).toBe(true);
    expect(calls.some((call) => /^api .*commits\/[0-9a-f]{40}\/status$/.test(call))).toBe(true);
    expect(calls.filter((call) => /statuses\//.test(call) && /POST/.test(call))).toEqual([]);
    const createdHeads = argvs
      .filter((argv) => argv[0] === "pr" && argv[1] === "create")
      .map((argv) => argv[argv.indexOf("--head") + 1] as string);
    expect(createdHeads.length).toBe(2);
    const remoteBranches = execFileSync("git", ["branch", "--list", "--format=%(refname:short)"], {
      cwd: origin,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(remoteBranches).toEqual(["main", ...createdHeads].sort());
  });

  it("ASDLC-1/AC-11 unsupported provider fails with a clear error and no PRs", async () => {
    const config = {
      stack: { enabled: true, provider: "graphite" },
    } as unknown as DevHarnessConfig;
    const result = await stackSubmit(ID, config, { cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/Unsupported stack provider "graphite"/);
    expect(result.text).toMatch(/gh/);
    const remoteBranches = execFileSync("git", ["branch", "--list", "--format=%(refname:short)"], {
      cwd: origin,
      encoding: "utf8",
    });
    expect(remoteBranches.trim()).toBe("main");
  });

  it("ASDLC-1/AC-11 provider failure mid-submit returns ok false with the error message", async () => {
    const fake = fakeProvider();
    const original = fake.createOrUpdatePr.bind(fake);
    fake.createOrUpdatePr = async (input) => {
      if (input.title.includes("Beta")) throw new Error("boom-from-provider");
      return original(input);
    };
    const result = await stackSubmit(ID, ENABLED, { cwd: repo, provider: fake });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("boom-from-provider");
  });
});

describe("ASDLC-1/AC-11 stackSync", () => {
  it("ASDLC-1/AC-11 refreshes PR numbers and states from the provider", async () => {
    const learn = fakeProvider();
    await stackSubmit(ID, ENABLED, { cwd: repo, provider: learn });
    const alphaHead = createFor(learn, "Alpha")?.head as string;
    const betaHead = createFor(learn, "Beta")?.head as string;
    // Fresh provider, never submitted through: numbers can only come from listPrs.
    const fake = fakeProvider();
    fake.prs.set(betaHead, {
      number: 901,
      url: "https://github.com/o/r/pull/901",
      state: "open",
      head: betaHead,
      base: alphaHead,
    });
    fake.prs.set(alphaHead, {
      number: 900,
      url: "https://github.com/o/r/pull/900",
      state: "merged",
      head: alphaHead,
      base: "main",
    });
    fake.prs.set("other/x", {
      number: 5,
      url: "https://github.com/o/r/pull/5",
      state: "open",
      head: "other/x",
      base: "main",
    });
    const result = await stackSync(ID, ENABLED, { cwd: repo, provider: fake });
    expect(result.ok).toBe(true);
    const lines = result.text.split("\n");
    const line900 = lines.find((line) => line.includes("#900")) ?? "";
    const line901 = lines.find((line) => line.includes("#901")) ?? "";
    expect(line900).toContain("ASDLC-1/AC-1");
    expect(line900).toContain("merged");
    expect(line901).toContain("ASDLC-1/AC-2");
    expect(line901).toContain("open");
    expect(result.text).not.toContain("#5 ");
    expect(result.text).toContain("| PR | Tasks | Concern | ACs |");
    expect(fake.listCalls.length).toBeGreaterThan(0);
    expect(fake.creates).toEqual([]);
    expect(fake.pushes).toEqual([]);
    expect(fake.statuses).toEqual([]);
    expect(fake.comments).toEqual([]);
  });

  it("ASDLC-1/AC-11 unsupported provider fails with a clear error", async () => {
    const config = { stack: { enabled: true, provider: "spr" } } as unknown as DevHarnessConfig;
    const result = await stackSync(ID, config, { cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/Unsupported stack provider "spr"/);
  });
});

describe("ASDLC-1/AC-11 stackReport", () => {
  it("ASDLC-1/AC-11 renders a per-PR roll-up row per loop from commit trailers", async () => {
    const trailers = [
      {
        v: 1,
        id: ID,
        task: 1,
        seq: 1,
        ref: "T1/phase-test",
        agent: "phase-test",
        loop: "test",
        round: 1,
        outcome: "red",
        t_fail: 3,
        tok_in: 100,
        tok_out: 50,
        usd_u: 7,
      },
      {
        v: 1,
        id: ID,
        task: 1,
        seq: 2,
        ref: "C2/review-code",
        agent: "review-code",
        loop: "code",
        round: 2,
        outcome: "green",
        t_pass: 5,
        t_fail: 0,
        crit: 1,
        warn: 2,
        sugg: 0,
        tok_in: 10,
        tok_out: 5,
        usd_u: 3,
      },
    ];
    for (const trailer of trailers) {
      write(join(repo, `f${trailer.seq}.txt`), String(trailer.seq));
      git("add", "-A");
      git("commit", "-q", "-m", buildCommitMessage({ summary: "x", trailer }));
    }
    const parsed = trailers.map((trailer) => {
      const message = buildCommitMessage({ summary: "x", trailer });
      return parseAccordTrailer(message) as NonNullable<ReturnType<typeof parseAccordTrailer>>;
    });
    const expected = renderStackReport(ID, [{ pr: 1, task: 1, trailers: parsed }]);
    const result = await stackReport(ID, ENABLED, { cwd: repo });
    expect(result.ok).toBe(true);
    const dataRows = expected.split("\n").filter((line) => /^\| 1 \| 1 \|/.test(line));
    expect(dataRows.length).toBe(2);
    for (const row of dataRows) expect(result.text).toContain(row);
  });
  it("ASDLC-1/AC-11 rolls up per PR (not per task) and ignores other work items", async () => {
    writePlan(MERGED_PLAN);
    const t4 = {
      v: 1,
      id: ID,
      task: 4,
      seq: 1,
      ref: "T1/phase-test",
      agent: "phase-test",
      loop: "test",
      round: 1,
      outcome: "red",
      tok_in: 100,
      tok_out: 50,
    };
    const t5 = {
      v: 1,
      id: ID,
      task: 5,
      seq: 2,
      ref: "C1/review-code",
      agent: "review-code",
      loop: "code",
      round: 1,
      outcome: "green",
      tok_in: 10,
      tok_out: 5,
    };
    const other = {
      v: 1,
      id: "OTHER-2",
      task: 5,
      seq: 3,
      ref: "C1/review-code",
      agent: "review-code",
      loop: "code",
      round: 1,
      outcome: "green",
      tok_in: 99999,
      tok_out: 5,
    };
    commitTrailer(t4, "t4.txt");
    commitTrailer(t5, "t5.txt");
    commitTrailer(other, "o.txt");
    const expected = renderStackReport(ID, [
      { pr: 1, task: 4, trailers: [parsedTrailer(t4)] },
      { pr: 2, task: 5, trailers: [parsedTrailer(t5)] },
    ]);
    const result = await stackReport(ID, ENABLED, { cwd: repo });
    const dataRows = expected.split("\n").filter((line) => /^\| [12] \| [45] \|/.test(line));
    expect(dataRows.length).toBe(2);
    for (const row of dataRows) expect(result.text).toContain(row);
    expect(result.text).not.toContain("99999");
    expect(result.text.split("\n").filter((line) => /^\| (4 \| 4|5 \| 5) \|/.test(line))).toEqual(
      [],
    );
  });
});

describe("ASDLC-1/AC-11 stack.enabled false", () => {
  it("ASDLC-1/AC-11 each service returns a clear disabled message and calls no provider", async () => {
    const fake = fakeProvider();
    for (const fn of [stackShow, stackSync, stackSubmit, stackReport]) {
      const result = await fn(ID, DISABLED, { cwd: repo, provider: fake });
      expect(result.text).toMatch(/stack\.enabled/);
      expect(result.text).toMatch(/false|disabled/i);
      expect(result.ok).toBe(false);
    }
    noProviderCalls(fake);
  });

  it("ASDLC-1/AC-11 absent stack config is disabled for every service", async () => {
    for (const fn of [stackShow, stackSync, stackSubmit, stackReport]) {
      const absent = await fn(ID, null, { cwd: repo });
      expect(absent.ok).toBe(false);
      expect(absent.text).toMatch(/stack\.enabled/);
    }
  });

  it("ASDLC-1/AC-11 each dev_stack* tool returns the disabled service text", async () => {
    for (const [name, fn] of [
      ["dev_stack", stackShow],
      ["dev_stack_sync", stackSync],
      ["dev_stack_submit", stackSubmit],
      ["dev_stack_report", stackReport],
    ] as const) {
      const viaTool = await runTool(name, DISABLED);
      const viaService = await fn(ID, DISABLED, { cwd: repo });
      expect(viaTool.text).toBe(viaService.text);
      expect(viaTool.text).toMatch(/stack\.enabled/);
    }
  });
});

describe("ASDLC-1/AC-11 dev_stack_* tools match the service", () => {
  it("ASDLC-1/AC-11 dev_stack returns stackShow text", async () => {
    const viaService = await stackShow(ID, ENABLED, { cwd: repo });
    const viaTool = await runTool("dev_stack", ENABLED);
    expect(viaTool.text).toBe(viaService.text);
    expect(viaTool.ok).toBe(viaService.ok);
    expect(viaTool.text).toContain("ASDLC-1/AC-1");
  });

  it("ASDLC-1/AC-11 dev_stack_report returns stackReport text", async () => {
    const viaService = await stackReport(ID, ENABLED, { cwd: repo });
    const viaTool = await runTool("dev_stack_report", ENABLED);
    expect(viaTool.text).toBe(viaService.text);
    expect(viaTool.text).toMatch(/Rounds/);
  });

  it("ASDLC-1/AC-11 dev_stack_sync and dev_stack_submit return the service text (gh provider)", async () => {
    installGh(ghRules());
    const syncService = await stackSync(ID, ENABLED, { cwd: repo });
    const syncTool = await runTool("dev_stack_sync", ENABLED);
    expect(syncTool.text).toBe(syncService.text);
    expect(syncTool.ok).toBe(syncService.ok);
    const submitService = await stackSubmit(ID, ENABLED, { cwd: repo });
    const submitTool = await runTool("dev_stack_submit", ENABLED);
    expect(submitService.ok).toBe(true);
    expect(submitTool.text).toBe(submitService.text);
    expect(submitTool.text).toContain("#11");
  });
});

describe("ASDLC-1/AC-11 PR group resolver registration", () => {
  const scripts: string[] = [];
  function runScript(imports: string[]): unknown {
    writePlan(MERGED_PLAN);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-res-")));
    cleanups.push(dir);
    const root = join(import.meta.dir, "..");
    const file = join(dir, "probe.ts");
    writeFileSync(
      file,
      `${imports.map((rel) => `import ${JSON.stringify(join(root, rel))};`).join("\n")}
import { resolvePrGroup } from ${JSON.stringify(join(root, "src/commit/hooks.ts"))};
console.log(JSON.stringify([resolvePrGroup(3), resolvePrGroup(4), resolvePrGroup(5), resolvePrGroup(99)]));
`,
    );
    scripts.push(file);
    return JSON.parse(
      execFileSync(process.execPath, [file], { cwd: repo, encoding: "utf8" }).trim(),
    );
  }

  afterAll(() => {
    registerPrGroupResolver((id) => [id]);
  });

  it("ASDLC-1/AC-11 importing src/index.ts alone registers the computeStack resolver", () => {
    expect(runScript(["src/index.ts"])).toEqual([[3, 4], [3, 4], [5], [99]]);
  });

  it("ASDLC-1/AC-11 loading src/stack/service.ts alone registers the resolver", () => {
    expect(runScript(["src/stack/service.ts"])).toEqual([[3, 4], [3, 4], [5], [99]]);
  });

  it.each([
    ["missing plan.json", () => rmSync(join(repo, "docs", "dev", ID, "plan.json"))],
    ["malformed plan.json", () => write(join(repo, "docs", "dev", ID, "plan.json"), "{not json")],
    [
      "depends_on cycle",
      () =>
        writePlan({
          work_item_id: ID,
          tasks: [
            { id: 7, depends_on: [8], files: [] },
            { id: 8, depends_on: [7], files: [] },
          ],
        }),
    ],
  ])("ASDLC-1/AC-11 resolver falls back to the task itself on %s", (_name, arrange) => {
    // Registration is proven by the subprocess tests above; here the registered resolver is exercised.
    expect(runScript(["src/stack/service.ts"])).toEqual([[3, 4], [3, 4], [5], [99]]);
    arrange();
    const probe = (): unknown => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-res-")));
      cleanups.push(dir);
      const root = join(import.meta.dir, "..");
      const file = join(dir, "probe.ts");
      writeFileSync(
        file,
        `import ${JSON.stringify(join(root, "src/stack/service.ts"))};
import { resolvePrGroup } from ${JSON.stringify(join(root, "src/commit/hooks.ts"))};
console.log(JSON.stringify(resolvePrGroup(7)));
`,
      );
      return JSON.parse(
        execFileSync(process.execPath, [file], { cwd: repo, encoding: "utf8" }).trim(),
      );
    };
    expect(probe()).toEqual([7]);
  });
});

describe("ASDLC-1/AC-28 service layering", () => {
  const read = (rel: string) => readFileSync(join(import.meta.dir, "..", rel), "utf8");

  it("ASDLC-1/AC-28 service.ts imports no Pi package and not tools/registry", () => {
    const source = read("src/stack/service.ts");
    expect(source).not.toMatch(/@earendil-works\//);
    expect(source).not.toMatch(/pi-(accord|git|subagent|thrift|integrations|skills)/);
    expect(source).not.toMatch(/tools\/registry/);
    expect(source).toMatch(/registerPrGroupResolver/);
  });

  it("ASDLC-1/AC-28 registry delegates dev_stack* tools to the stack service", () => {
    const source = read("src/tools/registry.ts");
    expect(source).toMatch(/stack\/service/);
    for (const name of ["dev_stack", "dev_stack_sync", "dev_stack_submit", "dev_stack_report"]) {
      expect(ACCORD_TOOLS.some((candidate) => candidate.name === name)).toBe(true);
    }
  });
});
