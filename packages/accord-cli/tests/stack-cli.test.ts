import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
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
import { buildCommitMessage } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import { ACCORD_TOOLS } from "@clive.shirley/accord-core/tools/registry.js";

// Pinned contract (spec leaves shapes open):
//  `accord stack <ID>` | `stack sync <ID>` | `stack submit <ID>` | `stack report <ID>` print exactly the
//  `text` that dev_stack | dev_stack_sync | dev_stack_submit | dev_stack_report return, followed by a
//  newline (console.log), against the same repo, config (AGENTS.md Dev Harness block) and fake gh binary.
//  Exit 0 when the service result is ok, 1 otherwise (disabled, unsupported provider, bad args).
const ID = "ASDLC-1";
const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const CLI_SRC = join(import.meta.dir, "..", "src");

const HARNESS = (stack: unknown) => ({
  schema_version: "1.0",
  language: "typescript",
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  verification_commands: ["bun test"],
  stack,
});
const ENABLED_STACK = { enabled: true, provider: "gh", require_flag: false };

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

let repo: string;
let origin: string;
let home: string;
let ghDir: string;
let callsFile: string;
let originalCwd: string;
let originalPath: string | undefined;
const cleanups: string[] = [];

const SCRUBBED_ENV: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(key)) {
      delete env[key];
    }
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  return env;
})();

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: SCRUBBED_ENV });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function writeConfig(stack: unknown): void {
  write(
    join(repo, "AGENTS.md"),
    `# Repo\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(HARNESS(stack), null, 2)}\n\`\`\`\n`,
  );
}
function installGh(): void {
  ghDir = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-cli-gh-")));
  cleanups.push(ghDir);
  callsFile = join(ghDir, "calls.jsonl");
  writeFileSync(callsFile, "");
  const rules = [
    { all: ["^pr list"], json: [] },
    { all: ["^pr create"], stdout: "https://github.com/o/r/pull/11\n" },
    { all: ["^api .*commits/.*/status"], json: { statuses: [] } },
    { all: ["^api .*issues/.*comments"], json: [] },
    { all: [""], stdout: "[]" },
  ];
  const script = `#!${process.execPath}
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(argv) + "\\n");
const rules = ${JSON.stringify(rules)};
const joined = argv.join(" ");
const rule = rules.find((r) => r.all.every((p) => new RegExp(p).test(joined)));
if (!rule) { process.stderr.write("fake gh: no rule for " + joined + "\\n"); process.exit(127); }
if (rule.json !== undefined) process.stdout.write(JSON.stringify(rule.json));
else if (rule.stdout !== undefined) process.stdout.write(rule.stdout);
`;
  const ghPath = join(ghDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  process.env.PATH = `${ghDir}${delimiter}${originalPath ?? ""}`;
}
const ghCalls = (): string[][] =>
  readFileSync(callsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);

function cliIn(cwd: string, ...args: string[]) {
  const res = spawnSync(process.execPath, [MAIN, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...SCRUBBED_ENV,
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      NO_COLOR: "1",
    },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}
const cli = (...args: string[]) => cliIn(repo, ...args);

async function toolResult(name: string, stack: unknown): Promise<{ ok: boolean; text: string }> {
  const found = ACCORD_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  const result = (await found.handler({ id: ID } as never, {
    getConfig: () => HARNESS(stack) as unknown as DevHarnessConfig,
  })) as unknown as { ok: boolean; text: string };
  return result;
}
async function toolText(name: string, stack: unknown): Promise<string> {
  return (await toolResult(name, stack)).text;
}
async function okToolText(name: string, stack: unknown): Promise<string> {
  const result = await toolResult(name, stack);
  expect({ name, ok: result.ok }).toEqual({ name, ok: true });
  return result.text;
}

beforeEach(() => {
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-cli-")));
  origin = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-cli-origin-")));
  home = realpathSync(mkdtempSync(join(tmpdir(), "accord-stack-cli-home-")));
  cleanups.push(repo, origin, home);
  execFileSync("git", ["init", "-q", "--bare"], { cwd: origin, env: SCRUBBED_ENV });
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("remote", "add", "origin", "https://github.com/o/r.git");
  git("config", `url.${origin}.pushInsteadOf`, "https://github.com/o/r.git");
  write(join(repo, "README.md"), "# repo\n");
  write(join(repo, "docs", "dev", ID, "plan.json"), JSON.stringify(PLAN, null, 2));
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
  writeConfig(ENABLED_STACK);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("tag", `accord/${ID}/contract`);
  git("push", "-q", "origin", "main");
  installGh();
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ASDLC-1/AC-11 accord stack CLI matches dev_stack_* tools", () => {
  it("ASDLC-1/AC-11 `accord stack <ID>` prints the dev_stack text (stack table)", async () => {
    const result = cli("stack", ID);
    const expected = await okToolText("dev_stack", ENABLED_STACK);
    expect(expected).toContain("ASDLC-1/AC-2");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expected}\n`);
  });

  it("ASDLC-1/AC-11 `accord stack sync <ID>` prints the dev_stack_sync text", async () => {
    const result = cli("stack", "sync", ID);
    // snapshot gh calls made by the CLI before the in-process oracle runs gh itself
    const cliCalls = ghCalls();
    const expected = await okToolText("dev_stack_sync", ENABLED_STACK);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expected}\n`);
    // sync refreshes from provider state: the CLI itself must query gh
    expect(cliCalls.some((argv) => argv[0] === "pr" && argv[1] === "list")).toBe(true);
  }, 30_000);

  it("ASDLC-1/AC-11 `accord stack submit <ID>` prints the dev_stack_submit text and drives gh (ASDLC-1/TC-12)", async () => {
    const result = cli("stack", "submit", ID);
    expect(result.status).toBe(0);
    const calls = ghCalls();
    expect(calls.some((argv) => argv[0] === "pr" && argv[1] === "create")).toBe(true);
    expect(calls.some((argv) => argv[0] === "api" && argv.join(" ").includes("status"))).toBe(true);
    const expected = await okToolText("dev_stack_submit", ENABLED_STACK);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stdout).toContain("https://github.com/o/r/pull/11");
  }, 30_000);

  it("ASDLC-1/AC-11 `accord stack report <ID>` prints the dev_stack_report text from trailers", async () => {
    write(join(repo, "f.txt"), "f");
    git("add", "-A");
    git(
      "commit",
      "-q",
      "-m",
      buildCommitMessage({
        summary: "red",
        trailer: {
          v: 1,
          id: ID,
          task: 1,
          agent: "phase-test",
          loop: "test",
          round: 1,
          seq: 1,
          ref: "T1/phase-test",
          outcome: "red",
          t_pass: 0,
          t_fail: 4,
          tok_in: 1000,
          tok_out: 200,
          usd_u: 60000,
          model: "sonnet",
        } as never,
      }),
    );
    const result = cli("stack", "report", ID);
    const expected = await okToolText("dev_stack_report", ENABLED_STACK);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expected}\n`);
    // task 1, loop test, rounds 1, findings 0, tests 0/4, tokens 1000+200, cost 60000 usd_u
    expect(result.stdout).toMatch(/\| 1 \| test \| 1 \| 0 \| 0\/4 \| 1200 \| 60000 usd_u \|/);
  }, 30_000);

  it("ASDLC-1/AC-11 the four verbs print distinct output (no verb aliases another)", () => {
    const show = cli("stack", ID).stdout;
    const report = cli("stack", "report", ID).stdout;
    expect(show.length).toBeGreaterThan(0);
    expect(report.length).toBeGreaterThan(0);
    expect(report).not.toBe(show);
  }, 30_000);

  it("ASDLC-1/AC-11 stack.enabled false prints the tool's disabled text and exits 1 without gh calls", async () => {
    writeConfig({ enabled: false });
    const result = cli("stack", "submit", ID);
    const expected = await toolText("dev_stack_submit", { enabled: false });
    expect(expected).toContain("stack.enabled");
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(expected);
    expect(ghCalls()).toEqual([]);
  });

  it("ASDLC-1/AC-11 unsupported provider fails with a clear error and exit 1 (ASDLC-1/TC-12)", () => {
    writeConfig({ enabled: true, provider: "graphite", require_flag: false });
    const result = cli("stack", "submit", ID);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('Unsupported stack provider "graphite"');
    expect(ghCalls().some((argv) => argv[0] === "pr" && argv[1] === "create")).toBe(false);
  });

  it.each([
    [["stack"], "stack requires a work item id"],
    [["stack", "sync"], "stack sync requires a work item id"],
    [["stack", "submit"], "stack submit requires a work item id"],
    [["stack", "report"], "stack report requires a work item id"],
  ] as [string[], string][])(
    "ASDLC-1/AC-11 missing work item id %j exits 1 with usage error",
    (args, message) => {
      const result = cli(...args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(ghCalls()).toEqual([]);
    },
    30_000,
  );

  it("ASDLC-1/AC-11 a misspelled verb never exits 0 and never prints the table or calls gh", async () => {
    const result = cli("stack", "sumbit", ID);
    const table = await okToolText("dev_stack", ENABLED_STACK);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(table);
    expect(`${result.stdout}${result.stderr}`).toContain("sumbit");
    expect(ghCalls()).toEqual([]);
  }, 30_000);

  it("ASDLC-1/AC-11 stack honours --cwd when run from another directory", async () => {
    const show = cliIn(home, "stack", ID, "--cwd", repo);
    expect(show.stderr).toBe("");
    expect(show.status).toBe(0);
    expect(show.stdout).toBe(`${await okToolText("dev_stack", ENABLED_STACK)}\n`);
    const report = cliIn(home, "stack", "report", ID, "--cwd", repo);
    expect(report.status).toBe(0);
    expect(report.stdout).toBe(`${await okToolText("dev_stack_report", ENABLED_STACK)}\n`);
  }, 30_000);

  it("ASDLC-1/AC-11 unknown plan reports the missing plan and exits 1", () => {
    const result = cli("stack", "ASDLC-99");
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("docs/dev/ASDLC-99/plan.json");
  });

  it("ASDLC-1/AC-11 `accord --help` lists the stack command", () => {
    const result = cli("--help");
    expect(result.stdout).toMatch(/^\s+stack\s+/m);
    const usage = result.stdout.split("\n").find((line) => /usage:\s*stack\b/.test(line));
    expect(usage).toBeDefined();
    for (const verb of ["sync", "submit", "report"]) expect(usage).toContain(verb);
  });
});

describe("ASDLC-1/AC-28 stack CLI adapter is thin", () => {
  const read = (file: string) => readFileSync(join(CLI_SRC, file), "utf8");

  it("ASDLC-1/AC-28 commands/stack.ts delegates to accord-core stack/service and has no Pi, git or gh logic", () => {
    const source = read("commands/stack.ts");
    expect(source).toMatch(/from "@clive\.shirley\/accord-core\/stack\/service\.js"/);
    expect(source).not.toMatch(/pi-accord|pi-subagent|@earendil-works|pi-coding-agent/);
    expect(source).not.toMatch(/node:child_process|execFile|spawn\(|Bun\.spawn/);
    expect(source).not.toMatch(/computeStack|renderStackTable/);
    const imports = [...source.matchAll(/from "@clive\.shirley\/accord-core\/([^"]+)"/g)].map(
      (match) => match[1],
    );
    const allowed = [
      "stack/service.js",
      "config/index.js",
      "config/agents-md.js",
      "config/types.js",
    ];
    expect(imports.filter((name) => !allowed.includes(name ?? ""))).toEqual([]);
  });

  it("ASDLC-1/AC-28 commands/index.ts exports runStackCommand and dispatch/cli route `stack`", () => {
    expect(read("commands/index.ts")).toMatch(/runStackCommand.*from "\.\/stack\.js"/);
    expect(read("dispatch.ts")).toMatch(/runStackCommand/);
    expect(read("dispatch.ts")).toMatch(/["']stack["']/);
    expect(read("cli.ts")).toMatch(/["']stack["']/);
  });
});

describe("ASDLC-1/AC-31 stack CLI documented", () => {
  const root = join(import.meta.dir, "..", "..", "..");

  it("ASDLC-1/AC-31 okf/references/accord-cli.md documents all four stack verbs (ASDLC-1/TC-32)", () => {
    const doc = readFileSync(join(root, "okf", "references", "accord-cli.md"), "utf8");
    const row = doc.split("\n").find((line) => /^\|\s*`stack /.test(line));
    expect(row).toBeDefined();
    expect(row).toContain("<ID>");
    for (const verb of ["sync", "submit", "report"]) expect(row).toContain(verb);
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated entry for the accord stack command (ASDLC-1/TC-32)", () => {
    const log = readFileSync(join(root, "okf", "log.md"), "utf8");
    const bullets: { date: string; text: string }[] = [];
    let date: string | null = null;
    for (const line of log.split("\n")) {
      const heading = /^## (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
      if (heading) {
        date = heading[1] ?? null;
        continue;
      }
      if (date && line.startsWith("* ")) bullets.push({ date, text: line });
    }
    const matching = bullets.filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1 stack-compute") &&
        bullet.text.includes("accord stack") &&
        bullet.text.includes("/references/accord-cli.md") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });
});
