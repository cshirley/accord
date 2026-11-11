import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { resolveStackProvider } from "../src/stack/provider.js";

// ASDLC-1/TC-12: fake gh binary records calls. Rules match on the space-joined argv
// (regex strings in `all`, none of `none`); first matching rule answers.
interface Rule {
  all: string[];
  none?: string[];
  json?: unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface Fake {
  dir: string;
  calls(): string[][];
  cwds(): string[];
  restore(): void;
}

function installGh(rules: Rule[]): Fake {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-gh-")));
  const callsFile = join(dir, "calls.jsonl");
  writeFileSync(callsFile, "");
  writeFileSync(join(dir, "rules.json"), JSON.stringify(rules));
  const script = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");
const rules = JSON.parse(readFileSync(${JSON.stringify(join(dir, "rules.json"))}, "utf8"));
const joined = argv.join(" ");
const rule = rules.find((r) => r.all.every((p) => new RegExp(p).test(joined)) && !(r.none ?? []).some((p) => new RegExp(p).test(joined)));
if (!rule) { process.stderr.write("fake gh: no rule for " + joined + "\\n"); process.exit(127); }
if (rule.stderr) process.stderr.write(rule.stderr);
if (rule.json !== undefined) process.stdout.write(JSON.stringify(rule.json));
else if (rule.stdout !== undefined) process.stdout.write(rule.stdout);
process.exit(rule.exitCode ?? 0);
`;
  const ghPath = join(dir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  const records = () =>
    readFileSync(callsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { argv: string[]; cwd: string });
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${originalPath ?? ""}`;
  return {
    dir,
    calls: () => records().map((record) => record.argv),
    cwds: () => records().map((record) => record.cwd),
    restore() {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const BRIEF =
  "## Brief\n\nContract: https://example.test/contract\n\n- ASDLC-1/AC-11 stack provider";
const hasFlag = (argv: string[], flag: string, value: string) =>
  argv.some((arg, index) => arg === flag && argv[index + 1] === value);
const isWrite = (argv: string[]) => argv.some((arg) => /^(context|state|body)=/.test(arg));
const field = (argv: string[], key: string) =>
  argv.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1);

const evil = (dir: string) => `x "q" 'q' \`id\` ; $(touch ${join(dir, "pwned")})`;
const leakDump = (error: unknown): string =>
  [
    (error as Error).message,
    String((error as Error).stack ?? ""),
    String((error as { cause?: unknown }).cause ?? ""),
    Bun.inspect(error),
    JSON.stringify(Object.entries(error as object)),
  ].join("\n");

let fake: Fake | undefined;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN"]) savedEnv[key] = process.env[key];
});

afterEach(() => {
  fake?.restore();
  fake = undefined;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("ASDLC-1/AC-11 createOrUpdatePr", () => {
  it("ASDLC-1/AC-11 creates a PR with head, base, title and brief body when none exists for the head", async () => {
    fake = installGh([
      { all: ["^pr list"], json: [] },
      { all: ["^pr create"], stdout: "https://github.com/o/r/pull/12\n" },
    ]);
    const cwdDir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-cwd-")));
    const result = await resolveStackProvider("gh", { cwd: cwdDir }).createOrUpdatePr({
      head: "asdlc-1/task-28",
      base: "main",
      title: "Task 28",
      body: BRIEF,
    });
    // F-008: gh runs in the configured cwd
    expect(fake.cwds().length).toBeGreaterThan(0);
    expect(fake.cwds().every((dir) => dir === cwdDir)).toBe(true);
    rmSync(cwdDir, { recursive: true, force: true });
    expect(result).toEqual({ number: 12, url: "https://github.com/o/r/pull/12" });
    const calls = fake.calls();
    const create = calls.filter((argv) => argv[0] === "pr" && argv[1] === "create");
    expect(create).toHaveLength(1);
    const argv = create[0] as string[];
    expect(hasFlag(argv, "--head", "asdlc-1/task-28")).toBe(true);
    expect(hasFlag(argv, "--base", "main")).toBe(true);
    expect(hasFlag(argv, "--title", "Task 28")).toBe(true);
    expect(hasFlag(argv, "--body", BRIEF)).toBe(true);
    expect(calls.some((c) => c[0] === "pr" && c[1] === "edit")).toBe(false);
  });

  it("ASDLC-1/AC-11 edits the same PR body in place when the head already has a PR", async () => {
    fake = installGh([
      {
        all: ["^pr list", "--head[ =]asdlc-1/task-28"],
        json: [
          {
            number: 7,
            url: "https://github.com/o/r/pull/7",
            state: "OPEN",
            headRefName: "asdlc-1/task-28",
            baseRefName: "main",
          },
        ],
      },
      {
        all: ["^pr list"],
        json: [
          {
            number: 3,
            url: "https://github.com/o/r/pull/3",
            state: "OPEN",
            headRefName: "other",
            baseRefName: "main",
          },
        ],
      },
      { all: ["^pr edit"], stdout: "https://github.com/o/r/pull/7\n" },
    ]);
    const result = await resolveStackProvider("gh").createOrUpdatePr({
      head: "asdlc-1/task-28",
      base: "main",
      title: "Task 28",
      body: BRIEF,
    });
    expect(result).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
    const calls = fake.calls();
    const edit = calls.filter((argv) => argv[0] === "pr" && argv[1] === "edit");
    expect(edit).toHaveLength(1);
    expect(edit[0]).toContain("7");
    expect(edit[0]).not.toContain("3");
    expect(hasFlag(edit[0] as string[], "--body", BRIEF)).toBe(true);
    expect(calls.some((c) => c[0] === "pr" && c[1] === "create")).toBe(false);
  });
});

describe("ASDLC-1/AC-11 no shell: metacharacters pass verbatim", () => {
  it("ASDLC-1/AC-11 create and edit send title and body verbatim and run no shell", async () => {
    fake = installGh([
      { all: ["^pr list"], json: [] },
      { all: ["^pr create"], stdout: "https://github.com/o/r/pull/12\n" },
    ]);
    const hostile = evil(fake.dir);
    const body = `${BRIEF}\n${hostile}`;
    await resolveStackProvider("gh").createOrUpdatePr({
      head: "h",
      base: "main",
      title: hostile,
      body,
    });
    const create = fake.calls().find((a) => a[0] === "pr" && a[1] === "create") as string[];
    expect(hasFlag(create, "--title", hostile)).toBe(true);
    expect(hasFlag(create, "--body", body)).toBe(true);
    expect(existsSync(join(fake.dir, "pwned"))).toBe(false);
    fake.restore();

    fake = installGh([
      {
        all: ["^pr list"],
        json: [{ number: 7, url: "u7", state: "OPEN", headRefName: "h", baseRefName: "main" }],
      },
      { all: ["^pr edit"], stdout: "u7\n" },
    ]);
    const hostile2 = evil(fake.dir);
    const body2 = `${BRIEF}\n${hostile2}`;
    await resolveStackProvider("gh").createOrUpdatePr({
      head: "h",
      base: "main",
      title: hostile2,
      body: body2,
    });
    const edit = fake.calls().find((a) => a[0] === "pr" && a[1] === "edit") as string[];
    expect(hasFlag(edit, "--body", body2)).toBe(true);
    expect(existsSync(join(fake.dir, "pwned"))).toBe(false);
  });

  it("ASDLC-1/AC-11 map comment upsert sends a hostile body verbatim and runs no shell", async () => {
    fake = installGh([
      { all: ["issues/7/comments"], none: ["body=", "PATCH", "POST"], json: [] },
      { all: ["^api"], json: {} },
    ]);
    const hostile = evil(fake.dir);
    await resolveStackProvider("gh").upsertStackMapComment({
      pr: 7,
      workItemId: "ASDLC-1",
      body: hostile,
    });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    expect(field(writes[0] as string[], "body")).toContain(hostile);
    expect(existsSync(join(fake.dir, "pwned"))).toBe(false);
  });
});

describe("ASDLC-1/AC-11 upsertStackMapComment", () => {
  const MAP = "## Stack map\n\n| 1 / 2 | task | url | ASDLC-1/AC-11 |";
  const MARKER = "<!-- accord:stack-map ASDLC-1 -->";

  it("ASDLC-1/AC-11 edits the existing marker comment in place and leaves other comments alone", async () => {
    fake = installGh([
      {
        all: ["issues/7/comments"],
        none: ["body=", "PATCH", "POST"],
        json: [
          { id: 111, body: "human remark" },
          { id: 222, body: "<!-- accord:stack-map ASDLC-99 -->\nother work item" },
          { id: 333, body: "<!-- accord:stack-map ASDLC-10 -->\nmap" },
          { id: 555, body: `${MARKER}\n## Stack map\nold` },
        ],
      },
      { all: ["^api"], json: {} },
    ]);
    await resolveStackProvider("gh").upsertStackMapComment({
      pr: 7,
      workItemId: "ASDLC-1",
      body: MAP,
    });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    const write = writes[0] as string[];
    expect(write.join(" ")).toContain("PATCH");
    expect(write.join(" ")).toContain("issues/comments/555");
    const allCalls = fake.calls().map((argv) => argv.join(" "));
    expect(allCalls.some((c) => c.includes("DELETE"))).toBe(false);
    for (const other of ["111", "222", "333"])
      expect(allCalls.some((c) => c.includes(`issues/comments/${other}`))).toBe(false);
    const sent = field(write, "body") as string;
    expect(sent).toContain(MARKER);
    expect(sent).toContain(MAP);
  });

  it("ASDLC-1/AC-11 creates one marked comment when no marker comment exists", async () => {
    fake = installGh([
      {
        all: ["issues/7/comments"],
        none: ["body=", "PATCH", "POST"],
        json: [
          { id: 111, body: "human remark" },
          { id: 222, body: "<!-- accord:stack-map ASDLC-99 -->\nother work item" },
          { id: 333, body: "<!-- accord:stack-map ASDLC-10 -->\nmap" },
        ],
      },
      { all: ["^api"], json: {} },
    ]);
    await resolveStackProvider("gh").upsertStackMapComment({
      pr: 7,
      workItemId: "ASDLC-1",
      body: MAP,
    });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    const write = writes[0] as string[];
    expect(write.join(" ")).toContain("issues/7/comments");
    expect(write.join(" ")).not.toContain("PATCH");
    expect(write.join(" ")).not.toContain("issues/comments/");
    expect(fake.calls().some((argv) => argv.join(" ").includes("DELETE"))).toBe(false);
    const sent = field(write, "body") as string;
    expect(sent).toContain(MARKER);
    expect(sent).toContain(MAP);
  });

  it("ASDLC-1/AC-11 finds a marker comment beyond the first page (paginates)", async () => {
    fake = installGh([
      {
        all: ["issues/7/comments", "--paginate"],
        none: ["body=", "PATCH", "POST"],
        json: [
          { id: 111, body: "human remark" },
          { id: 555, body: `${MARKER}\nold` },
        ],
      },
      {
        all: ["issues/7/comments"],
        none: ["body=", "PATCH", "POST"],
        json: Array.from({ length: 30 }, (_, index) => ({ id: 1000 + index, body: "human" })),
      },
      { all: ["^api"], json: {} },
    ]);
    await resolveStackProvider("gh").upsertStackMapComment({
      pr: 7,
      workItemId: "ASDLC-1",
      body: MAP,
    });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    expect((writes[0] as string[]).join(" ")).toContain("PATCH");
    expect((writes[0] as string[]).join(" ")).toContain("issues/comments/555");
  });
});

describe("ASDLC-1/AC-11 setEvidenceStatus", () => {
  type St = { context: string; state: string; id?: number; updated_at?: string };
  const statusRules = (latest: St[], history: St[] = latest): Rule[] => {
    const states = latest.map((status) => status.state);
    const combined = states.includes("failure")
      ? "failure"
      : states.includes("error")
        ? "error"
        : states.includes("pending")
          ? "pending"
          : "success";
    return [
      {
        all: [`commits/${SHA}/status(?!es)`],
        none: ["context="],
        json: { state: combined, statuses: latest },
      },
      { all: [`commits/${SHA}/statuses`], none: ["context="], json: history },
      { all: [`statuses/${SHA}`], none: ["context="], json: history },
      { all: ["^api"], json: {} },
    ];
  };

  it("ASDLC-1/AC-11 posts exactly one accord/evidence status when none exists", async () => {
    fake = installGh(statusRules([]));
    await resolveStackProvider("gh").setEvidenceStatus({
      sha: SHA,
      state: "success",
      description: "evidence ok",
    });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    const write = writes[0] as string[];
    expect(write.join(" ")).toContain(`statuses/${SHA}`);
    expect(field(write, "context")).toBe("accord/evidence");
    expect(field(write, "state")).toBe("success");
    expect(field(write, "description")).toBe("evidence ok");
  });

  it("ASDLC-1/AC-11 upgrades a pending accord/evidence status", async () => {
    fake = installGh(statusRules([{ context: "accord/evidence", state: "pending" }]));
    await resolveStackProvider("gh").setEvidenceStatus({ sha: SHA, state: "success" });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    expect(field(writes[0] as string[], "state")).toBe("success");
  });

  it("ASDLC-1/AC-11 never replaces an existing CI failure for the same sha", async () => {
    fake = installGh(statusRules([{ context: "accord/evidence", state: "failure" }]));
    await resolveStackProvider("gh").setEvidenceStatus({ sha: SHA, state: "success" });
    expect(fake.calls().filter(isWrite)).toHaveLength(0);
    expect(fake.calls().length).toBeGreaterThan(0); // it did consult provider state
  });

  it("ASDLC-1/AC-11 never replaces a latest failure that follows an earlier pending status", async () => {
    fake = installGh(
      statusRules(
        [{ context: "accord/evidence", state: "failure" }],
        [
          {
            context: "accord/evidence",
            state: "failure",
            id: 2,
            updated_at: "2025-01-02T00:00:00Z",
          },
          {
            context: "accord/evidence",
            state: "pending",
            id: 1,
            updated_at: "2025-01-01T00:00:00Z",
          },
        ],
      ),
    );
    await resolveStackProvider("gh").setEvidenceStatus({ sha: SHA, state: "success" });
    expect(fake.calls().filter(isWrite)).toHaveLength(0);
    expect(fake.calls().length).toBeGreaterThan(0);
  });

  it("ASDLC-1/AC-11 never replaces an existing error or success status", async () => {
    for (const existing of ["error", "success"]) {
      fake?.restore();
      fake = installGh(statusRules([{ context: "accord/evidence", state: existing }]));
      await resolveStackProvider("gh").setEvidenceStatus({ sha: SHA, state: "success" });
      expect(fake.calls().filter(isWrite)).toHaveLength(0);
      expect(fake.calls().length).toBeGreaterThan(0);
    }
  });

  it("ASDLC-1/AC-11 a failure on another context does not block the accord/evidence post", async () => {
    fake = installGh(statusRules([{ context: "ci/build", state: "failure" }]));
    await resolveStackProvider("gh").setEvidenceStatus({ sha: SHA, state: "success" });
    const writes = fake.calls().filter(isWrite);
    expect(writes).toHaveLength(1);
    expect(field(writes[0] as string[], "context")).toBe("accord/evidence");
  });
});

describe("ASDLC-1/AC-11 listPrs", () => {
  it("ASDLC-1/AC-11 maps provider state to open, closed and merged", async () => {
    fake = installGh([
      {
        all: ["^pr list"],
        json: [
          { number: 1, url: "u1", state: "OPEN", headRefName: "h1", baseRefName: "main" },
          { number: 2, url: "u2", state: "CLOSED", headRefName: "h2", baseRefName: "h1" },
          { number: 3, url: "u3", state: "MERGED", headRefName: "h3", baseRefName: "main" },
        ],
      },
    ]);
    const prs = await resolveStackProvider("gh").listPrs({ state: "all" });
    const allList = fake.calls().find((argv) => argv[0] === "pr" && argv[1] === "list") as string[];
    expect(hasFlag(allList, "--state", "all")).toBe(true);
    expect(prs).toEqual([
      { number: 1, url: "u1", state: "open", head: "h1", base: "main" },
      { number: 2, url: "u2", state: "closed", head: "h2", base: "h1" },
      { number: 3, url: "u3", state: "merged", head: "h3", base: "main" },
    ]);
    const list = fake.calls().find((argv) => argv[0] === "pr" && argv[1] === "list") as string[];
    expect(list).toContain("--json");
  });

  it("ASDLC-1/AC-11 passes head and state filters to gh", async () => {
    fake = installGh([{ all: ["^pr list"], json: [] }]);
    await resolveStackProvider("gh").listPrs({ head: "h2", state: "open" });
    const list = fake.calls().find((argv) => argv[0] === "pr" && argv[1] === "list") as string[];
    expect(hasFlag(list, "--head", "h2")).toBe(true);
    expect(hasFlag(list, "--state", "open")).toBe(true);
  });
});

describe("ASDLC-1/AC-11 resolveStackProvider", () => {
  it.each(["graphite", "spr", "git", "GH", " gh", "gh ", ""])(
    "ASDLC-1/AC-11 rejects unsupported provider %p with a clear error",
    (name) => {
      let message = "";
      try {
        resolveStackProvider(name);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/unsupported/i);
      expect(message).toMatch(/provider/i);
      expect(message).toContain(JSON.stringify(name).slice(1, -1));
      expect(message).toContain("gh");
      expect(message).not.toMatch(/not implemented/);
    },
  );

  it("ASDLC-1/AC-11 accepts gh and exposes the full port", () => {
    const provider = resolveStackProvider("gh");
    for (const method of [
      "createOrUpdatePr",
      "upsertStackMapComment",
      "setEvidenceStatus",
      "listPrs",
      "ensureBranch",
      "pushBranch",
      "retarget",
    ] as const) {
      expect(typeof provider[method]).toBe("function");
    }
  });
});

describe("ASDLC-1/AC-11 secrets never leak into errors", () => {
  const TOKEN = "ghp_SUPERSECRETTOKENVALUE123";
  const STDERR = `gh: HTTP 401 bad credentials for ${TOKEN} LEAKED-STDERR-LINE`;

  const failing = (): Fake => installGh([{ all: [".*"], stderr: STDERR, exitCode: 1 }]);

  const operations: [string, () => Promise<unknown>][] = [
    [
      "createOrUpdatePr",
      () =>
        resolveStackProvider("gh").createOrUpdatePr({
          head: "h",
          base: "main",
          title: "t",
          body: "b",
        }),
    ],
    [
      "upsertStackMapComment",
      () =>
        resolveStackProvider("gh").upsertStackMapComment({
          pr: 7,
          workItemId: "ASDLC-1",
          body: "m",
        }),
    ],
    [
      "setEvidenceStatus",
      () => resolveStackProvider("gh").setEvidenceStatus({ sha: SHA, state: "success" }),
    ],
    ["listPrs", () => resolveStackProvider("gh").listPrs({ state: "all" })],
  ];

  it.each(operations)(
    "ASDLC-1/AC-11 %s throws without gh stderr or token values",
    async (_name, run) => {
      process.env.GH_TOKEN = TOKEN;
      process.env.GITHUB_TOKEN = TOKEN;
      fake = failing();
      let message = "";
      let dump = "";
      try {
        await run();
      } catch (error) {
        message = (error as Error).message;
        dump = leakDump(error);
      }
      expect(message.length).toBeGreaterThan(0);
      expect(dump).not.toContain(TOKEN);
      expect(dump).not.toContain("LEAKED-STDERR-LINE");
      expect(dump).not.toContain("bad credentials");
      expect(message).toMatch(/gh/);
      expect(message).not.toMatch(/not implemented/);
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain("LEAKED-STDERR-LINE");
      expect(message).not.toContain("bad credentials");
    },
  );
});

describe("ASDLC-1/AC-11 ensureBranch and pushBranch (non-force)", () => {
  let root: string;
  let work: string;
  let origin: string;

  const git = (cwd: string, ...args: string[]): string => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.test",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.test",
      },
    });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.toString().trim();
  };
  const remoteSha = (branch: string) => git(origin, "rev-parse", `refs/heads/${branch}`);

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-git-")));
    origin = join(root, "origin.git");
    work = join(root, "work");
    git(root, "init", "--bare", "-b", "main", origin);
    git(root, "clone", origin, work);
    git(work, "checkout", "-b", "main");
    writeFileSync(join(work, "a.txt"), "a\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "init");
    git(work, "push", "origin", "main");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("ASDLC-1/AC-11 ensureBranch creates the branch at base and is idempotent", async () => {
    const provider = resolveStackProvider("gh", { cwd: work });
    const base = git(work, "rev-parse", "main");
    git(work, "checkout", "-b", "side");
    writeFileSync(join(work, "s.txt"), "s\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "side");
    const side = git(work, "rev-parse", "HEAD");
    expect(side).not.toBe(base);
    await provider.ensureBranch({ branch: "asdlc-1/task-28", base: "main" });
    expect(git(work, "rev-parse", "refs/heads/asdlc-1/task-28")).toBe(base);
    expect(git(work, "rev-parse", "refs/heads/asdlc-1/task-28")).not.toBe(side);
    git(work, "checkout", "asdlc-1/task-28");
    writeFileSync(join(work, "b.txt"), "b\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "work");
    const advanced = git(work, "rev-parse", "HEAD");
    await provider.ensureBranch({ branch: "asdlc-1/task-28", base: "main" });
    expect(git(work, "rev-parse", "refs/heads/asdlc-1/task-28")).toBe(advanced);
  });

  it("ASDLC-1/AC-11 pushBranch publishes the branch and fast-forwards on a second push", async () => {
    const provider = resolveStackProvider("gh", { cwd: work });
    await provider.ensureBranch({ branch: "feat", base: "main" });
    git(work, "checkout", "feat");
    writeFileSync(join(work, "b.txt"), "b\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "one");
    const mainRemote = remoteSha("main");
    git(work, "checkout", "main");
    await provider.pushBranch({ branch: "feat" });
    expect(remoteSha("feat")).toBe(git(work, "rev-parse", "refs/heads/feat"));
    expect(remoteSha("main")).toBe(mainRemote);
    git(work, "checkout", "feat");
    writeFileSync(join(work, "c.txt"), "c\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "two");
    git(work, "checkout", "main");
    await provider.pushBranch({ branch: "feat" });
    expect(remoteSha("feat")).toBe(git(work, "rev-parse", "refs/heads/feat"));
    expect(remoteSha("main")).toBe(mainRemote);
  });

  it("ASDLC-1/AC-11 pushBranch never force-pushes over diverged remote history", async () => {
    const provider = resolveStackProvider("gh", { cwd: work });
    await provider.ensureBranch({ branch: "feat", base: "main" });
    git(work, "checkout", "feat");
    writeFileSync(join(work, "b.txt"), "local\n");
    git(work, "add", ".");
    git(work, "commit", "-m", "local");

    const other = join(root, "other");
    git(root, "clone", origin, other);
    git(other, "checkout", "-b", "feat", "origin/main");
    writeFileSync(join(other, "z.txt"), "remote\n");
    git(other, "add", ".");
    git(other, "commit", "-m", "remote");
    git(other, "push", "origin", "feat");
    const before = remoteSha("feat");
    // F-003: make a --force-with-lease push satisfiable so only a plain push is rejected
    git(work, "fetch", "origin");
    expect(git(work, "rev-parse", "refs/remotes/origin/feat")).toBe(before);
    git(work, "checkout", "main");

    let message = "";
    try {
      await provider.pushBranch({ branch: "feat" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/push/i);
    expect(message).not.toMatch(/not implemented/);
    // F-011: no raw git stderr (remote URL / hints)
    expect(message).not.toContain(origin);
    expect(message).not.toMatch(/hint:/);
    expect(message.trim().split("\n")).toHaveLength(1);
    expect(remoteSha("feat")).toBe(before);
  });
});

describe("ASDLC-1/AC-17 retarget error path and cwd", () => {
  it("ASDLC-1/TC-18 retarget rejects when gh pr edit fails, without leaking the token or stderr", async () => {
    const TOKEN = "ghp_RETARGETSECRET456";
    process.env.GH_TOKEN = TOKEN;
    fake = installGh([{ all: ["^pr edit"], stderr: `boom ${TOKEN} LEAKED-RETARGET`, exitCode: 1 }]);
    let dump = "";
    let message = "";
    try {
      await resolveStackProvider("gh").retarget(202, "main");
    } catch (error) {
      message = (error as Error).message;
      dump = leakDump(error);
    }
    expect(message).toMatch(/gh pr edit failed/);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain("LEAKED-RETARGET");
    expect(fake.calls()).toEqual([["pr", "edit", "202", "--base", "main"]]);
  });

  it("ASDLC-1/TC-18 retarget runs gh in the provider's cwd", async () => {
    fake = installGh([{ all: ["^pr edit"] }]);
    const cwdDir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-retarget-cwd-")));
    try {
      await resolveStackProvider("gh", { cwd: cwdDir }).retarget(202, "main");
      expect(fake.cwds()).toEqual([cwdDir]);
    } finally {
      rmSync(cwdDir, { recursive: true, force: true });
    }
  });
});
