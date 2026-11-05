import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
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
import { fileURLToPath } from "node:url";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/agents-md.js";
import { resolveStackConfig } from "@clive.shirley/accord-core/config/stack-flags.js";
import { resolveDevSubcommandOrchestration } from "@clive.shirley/accord-core/orchestration/resolve/subcommand.js";
import { computeStack } from "@clive.shirley/accord-core/stack/compute-stack.js";
import { renderStackTable } from "@clive.shirley/accord-core/stack/render.js";
import { resolveWorkItemFilePath } from "@clive.shirley/accord-core/work-items/tasks-dir.js";
import { parse as parseYaml } from "yaml";

import { type Pr0ExecLike, type Pr0Result, runPr0 } from "../../src/ci-driven/pr0.js";
import type { PhaseBackendResult, PhaseRunBackend, RunPhaseOpts } from "../../src/run-phase.js";

// TC-24 (this file, e2e). TC-32 (AC-31) is pinned for this task's doc by the last describe;
// biome/validate:okf/validate:ste enforcement belongs to phase-verify-task, not to a test here.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ID = "ASDLC-1";
const DIR = `docs/dev/${ID}`;
const BRANCH = `accord/${ID}/x`;
const TOKEN = "ghp_SENTINEL_push_token_77ab";
const TOKEN_B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");

type PlanTask = {
  id: number;
  title: string;
  covers_ac: string[];
  est_lines: number;
  files: { path: string; action: string }[];
  concern?: string;
};
function planTasks(concern?: string): PlanTask[] {
  return [
    {
      id: 1,
      title: "a",
      covers_ac: ["AC-1"],
      est_lines: 100,
      files: [{ path: "src/a.ts", action: "add" }],
      ...(concern ? { concern } : {}),
    },
    {
      id: 2,
      title: "b",
      covers_ac: ["AC-2"],
      est_lines: 120,
      files: [{ path: "src/b.ts", action: "add" }],
      ...(concern ? { concern } : {}),
    },
  ];
}
const planJson = (tasks: PlanTask[]) =>
  `${JSON.stringify({ schema_version: "1.0", work_item_id: ID, tasks }, null, 2)}\n`;

const BRIEF_SPEC = {
  [`${DIR}/brief.md`]: "# brief\n",
  [`${DIR}/spec.json`]: `${JSON.stringify({ id: ID, acceptance_criteria: [] }, null, 2)}\n`,
};

let repo: string;
let backendCalls: RunPhaseOpts[];

function sh(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
function commitAll(message: string): string {
  sh("add", "-A");
  sh("commit", "-q", "-m", message);
  return sh("rev-parse", "HEAD");
}

type CommitSpec = {
  add?: Record<string, string>;
  edit?: Record<string, string>;
  remove?: string[];
};
type StackCfg = boolean | string | "absent" | { enabled: boolean; sizing?: Record<string, number> };

/** AGENTS.md with a valid `## Dev Harness` block (the only config the harness reads). */
function devHarnessMd(stack: StackCfg): string {
  const config: Record<string, unknown> = {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    verification_commands: ["bun test"],
  };
  if (stack !== "absent") {
    config.stack = typeof stack === "object" ? stack : { enabled: stack };
  }
  return `# Project\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n`;
}

/** main has Dev Harness config + .gitignore(.tasks/); the branch gets `commits`, one commit each. */
function fixture(opts: {
  branch: string;
  stack?: StackCfg;
  noConfig?: boolean;
  rootAccordJson?: unknown;
  commits?: CommitSpec[];
  base?: string;
  mainAdvance?: boolean;
}): void {
  const base = opts.base ?? "main";
  if (!opts.noConfig) write("AGENTS.md", devHarnessMd(opts.stack ?? true));
  if (opts.rootAccordJson !== undefined) {
    write("accord.json", `${JSON.stringify(opts.rootAccordJson)}\n`);
  }
  write(".gitignore", ".tasks/\n");
  write("README.md", "x\n");
  commitAll("init");
  sh("branch", "-M", base);
  sh("update-ref", `refs/remotes/origin/${base}`, base);
  sh("checkout", "-q", "-b", opts.branch);
  const commits: CommitSpec[] = opts.commits ?? [{ add: BRIEF_SPEC }];
  for (const commit of commits) {
    for (const [rel, content] of Object.entries({ ...commit.add, ...commit.edit })) {
      write(rel, content);
    }
    for (const rel of commit.remove ?? []) sh("rm", "-q", rel);
    commitAll("branch commit");
  }
  if (opts.mainAdvance) {
    sh("checkout", "-q", base);
    write("other.txt", "moved on\n");
    commitAll("main moves");
    sh("checkout", "-q", opts.branch);
  }
}

type BackendOpts = {
  tasks?: PlanTask[];
  plan?: "write" | "partial" | "none";
  exitCode?: number;
  stalledReason?: "stuck";
};

/**
 * Fake exec-harness backend. Before it writes plan.json it proves runPr0 bootstrapped a real,
 * resolvable work item (no local session): the real resolver must spawn phase-plan for ID in repo.
 */
function fakePlanBackend(options: BackendOpts = {}): PhaseRunBackend {
  return async (opts): Promise<PhaseBackendResult> => {
    backendCalls.push(opts);
    expect(realpathSync(opts.cwd ?? "")).toBe(realpathSync(repo));
    expect(resolveWorkItemFilePath(opts.ticket, repo)).not.toBeNull();
    const previous = process.cwd();
    process.chdir(repo);
    try {
      const resolution = resolveDevSubcommandOrchestration(
        "plan",
        opts.ticket,
        "",
        loadDevHarnessConfig(repo),
      );
      expect(resolution.outcome).toBe("spawn");
      if (resolution.outcome === "spawn") expect(resolution.agent).toBe("phase-plan");
    } finally {
      process.chdir(previous);
    }
    const mode = options.plan ?? "write";
    if (opts.phase === "plan" && mode === "write") {
      write(`${DIR}/plan.json`, planJson(options.tasks ?? planTasks()));
    }
    if (opts.phase === "plan" && mode === "partial") {
      write(`${DIR}/plan.json`, `{"schema_version":"1.0","tasks":[`);
    }
    if (options.exitCode) {
      return { exitCode: options.exitCode, stalledReason: options.stalledReason };
    }
    return {
      exitCode: 0,
      lastRun: {
        stopReason: "spawned_subagent",
        lastSpawn: { agent: "phase-plan", exitCode: 0, parsedReturn: { status: "done" } },
      } as never,
    };
  };
}

function run(
  extra: {
    dryRun?: boolean;
    exec?: Pr0ExecLike;
    env?: Record<string, string>;
    baseRef?: string;
    backend?: BackendOpts;
  } = {},
): Promise<Pr0Result> {
  expect(existsSync(join(repo, ".tasks"))).toBe(false); // no pre-existing local session
  return runPr0({
    repoRoot: repo,
    branch: sh("rev-parse", "--abbrev-ref", "HEAD"),
    baseRef: extra.baseRef ?? "main",
    dryRun: extra.dryRun ?? true,
    runBackend: fakePlanBackend(extra.backend),
    exec: extra.exec,
    env: extra.env ?? { ACCORD_CI_PUSH_TOKEN: TOKEN },
  });
}

function changedIn(sha: string): string[] {
  return sh("diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n").filter(Boolean);
}

type ExecCall = { cmd: string; args: readonly string[]; opts: unknown };
function spyExec(pushExit = 0): { exec: Pr0ExecLike; calls: ExecCall[]; pushes: () => ExecCall[] } {
  const calls: ExecCall[] = [];
  const exec: Pr0ExecLike = async (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts });
    const isPush = args.includes("push");
    return isPush && pushExit !== 0
      ? { exitCode: pushExit, stdout: "", stderr: "! [rejected]" }
      : { exitCode: 0, stdout: "", stderr: "" };
  };
  return { exec, calls, pushes: () => calls.filter((call) => call.args.includes("push")) };
}

/** Capture console, process.stdout/stderr at debug log level. */
async function captured<T>(
  fn: () => Promise<T>,
): Promise<{ text: string; value?: T; error?: unknown }> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origOut = process.stdout.write.bind(process.stdout);
  const origEw = process.stderr.write.bind(process.stderr);
  const prevLevel = process.env.ACCORD_LOG_LEVEL;
  process.env.ACCORD_LOG_LEVEL = "debug";
  console.log = (...a: unknown[]) => void chunks.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void chunks.push(a.map(String).join(" "));
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as never;
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as never;
  let value: T | undefined;
  let error: unknown;
  try {
    value = await fn();
  } catch (caught) {
    error = caught;
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.stdout.write = origOut as never;
    process.stderr.write = origEw as never;
    if (prevLevel === undefined) delete process.env.ACCORD_LOG_LEVEL;
    else process.env.ACCORD_LOG_LEVEL = prevLevel;
  }
  return { text: chunks.join("\n"), value, error };
}

beforeEach(() => {
  backendCalls = [];
  repo = mkdtempSync(join(tmpdir(), "accord-pr0-"));
  sh("init", "-q");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("ASDLC-1/AC-23 CI builds PR0 from brief and spec (ASDLC-1/TC-24)", () => {
  it("ASDLC-1/AC-23 brief+spec-only branch: spawns phase-plan, commits plan.json and stack table, stops at gate", async () => {
    fixture({ branch: BRANCH });
    const config = loadDevHarnessConfig(repo);
    expect(config?.stack?.enabled).toBe(true); // fixture is a loadable Dev Harness config
    expect(existsSync(join(repo, "accord.json"))).toBe(false);
    const trigger = sh("rev-parse", "HEAD");

    const result = await run();

    expect(backendCalls).toHaveLength(1);
    expect(backendCalls[0]?.phase).toBe("plan");
    expect(backendCalls[0]?.ticket).toBe(ID);
    expect(result.status).toBe("gate");
    if (result.status !== "gate") return;
    expect(result.workItemId).toBe(ID);

    // Append-only: new commit sits directly on the trigger commit; branch tip is that commit.
    expect(sh("rev-parse", "HEAD")).toBe(result.sha);
    expect(sh("rev-parse", `${result.sha}^`)).toBe(trigger);
    expect(sh("rev-list", "--count", "main..HEAD")).toBe("2");

    const changed = changedIn(result.sha);
    expect(changed).toContain(`${DIR}/plan.json`);
    expect(readFileSync(join(repo, DIR, "plan.json"), "utf8")).toBe(planJson(planTasks()));

    // Proposed stack table (computeStack + renderStackTable) is committed under docs/dev/<ID>/.
    const tasks = planTasks();
    const expectedTable = renderStackTable(
      ID,
      computeStack({ tasks }, resolveStackConfig(config).sizing),
      tasks,
    ).trim();
    const withTable = changed.filter(
      (file) =>
        file.startsWith(`${DIR}/`) && sh("show", `${result.sha}:${file}`).includes(expectedTable),
    );
    expect(withTable.length).toBeGreaterThan(0);

    // PR0 commit touches only the work item dir; brief/spec not rewritten; the gate is NOT passed:
    // no contract approval (lock file, tag) in the same commit.
    for (const file of changed) expect(file.startsWith(`${DIR}/`)).toBe(true);
    expect(changed).not.toContain(`${DIR}/brief.md`);
    expect(changed).not.toContain(`${DIR}/spec.json`);
    expect(changed).not.toContain(`${DIR}/contract.lock.json`);
    expect(sh("tag", "-l")).toBe("");
    expect(sh("status", "--porcelain")).toBe(""); // .tasks/ is gitignored
  });

  it("ASDLC-1/AC-23 stack table follows configured stack.sizing, not defaults", async () => {
    fixture({ branch: BRANCH, stack: { enabled: true, sizing: { min_pr_lines: 500 } } });
    const config = loadDevHarnessConfig(repo);
    const tasks = planTasks("x");
    const merged = renderStackTable(
      ID,
      computeStack({ tasks }, resolveStackConfig(config).sizing),
      tasks,
    ).trim();
    const unmerged = renderStackTable(
      ID,
      computeStack(
        { tasks },
        resolveStackConfig({ ...config, stack: { enabled: true } } as never).sizing,
      ),
      tasks,
    ).trim();
    expect(merged).not.toBe(unmerged); // test validity: sizing changes the table

    const result = await run({ backend: { tasks } });
    expect(result.status).toBe("gate");
    if (result.status !== "gate") return;
    const texts = changedIn(result.sha).map((file) => sh("show", `${result.sha}:${file}`));
    expect(texts.some((text) => text.includes(merged))).toBe(true);
    expect(texts.some((text) => text.includes(unmerged))).toBe(false);
  });

  it("ASDLC-1/AC-23 stops at the human gate: no further phase is spawned", async () => {
    fixture({ branch: BRANCH });
    await run();
    expect(backendCalls.map((call) => call.phase)).toEqual(["plan"]);
  });

  it("ASDLC-1/AC-23 dry-run never pushes", async () => {
    fixture({ branch: BRANCH });
    const spy = spyExec();
    await run({ exec: spy.exec });
    expect(spy.pushes()).toEqual([]);
  });

  it("ASDLC-1/AC-23 non-dry-run pushes the branch once: no force, not main, carries the token, never prints it", async () => {
    fixture({ branch: BRANCH });
    const spy = spyExec();
    const out = await captured(() => run({ dryRun: false, exec: spy.exec }));
    expect(out.error).toBeUndefined();
    const result = out.value as Pr0Result;
    expect(result.status).toBe("gate");

    const pushes = spy.pushes();
    expect(pushes).toHaveLength(1);
    const push = pushes[0] as ExecCall;
    expect(push.cmd).toBe("git");
    expect(push.args.some((arg) => arg === BRANCH || arg.endsWith(`refs/heads/${BRANCH}`))).toBe(
      true,
    );
    for (const arg of push.args) {
      expect(arg).not.toMatch(/^(-f|--force(-with-lease)?(=.*)?|--mirror|--all|\+.*)$/);
      expect(arg).not.toBe("main");
      expect(arg).not.toBe("refs/heads/main");
      expect(arg.endsWith(":main")).toBe(false);
    }
    const carried = JSON.stringify([push.args, push.opts]);
    expect(carried.includes(TOKEN) || carried.includes(TOKEN_B64)).toBe(true);

    expect(out.text).not.toContain(TOKEN);
    expect(out.text).not.toContain(TOKEN_B64);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("ASDLC-1/AC-23 push rejected: runPr0 fails with a push error that does not leak the token", async () => {
    fixture({ branch: BRANCH });
    const spy = spyExec(1);
    const out = await captured(() => run({ dryRun: false, exec: spy.exec }));
    expect(out.error).toBeInstanceOf(Error);
    const message = (out.error as Error).message;
    expect(message).toMatch(/push/);
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain(TOKEN_B64);
    expect(out.text).not.toContain(TOKEN);
    expect(out.text).not.toContain(TOKEN_B64);
  });

  it.each([
    [
      "backend stuck with partial plan.json",
      { plan: "partial", exitCode: 1, stalledReason: "stuck" },
    ],
    ["backend done but no plan.json", { plan: "none" }],
  ] as const)(
    "ASDLC-1/AC-23 plan failure (%s) is not a gate: nothing committed or pushed",
    async (_label, backend) => {
      fixture({ branch: BRANCH });
      const before = sh("rev-parse", "HEAD");
      const spy = spyExec();
      await expect(run({ dryRun: false, exec: spy.exec, backend })).rejects.toThrow(
        /phase-plan|plan\.json/,
      );
      expect(sh("rev-parse", "HEAD")).toBe(before);
      expect(spy.pushes()).toEqual([]);
    },
  );

  it.each([
    ["extra file beside brief/spec", [{ add: { ...BRIEF_SPEC, "src/extra.ts": "x\n" } }]],
    ["plan.json already present", [{ add: { ...BRIEF_SPEC, [`${DIR}/plan.json`]: "{}\n" } }]],
    ["only brief.md", [{ add: { [`${DIR}/brief.md`]: "b\n" } }]],
    ["only spec.json", [{ add: { [`${DIR}/spec.json`]: "{}\n" } }]],
    [
      "spec.md instead of spec.json",
      [{ add: { [`${DIR}/brief.md`]: "b\n", [`${DIR}/spec.md`]: "s\n" } }],
    ],
    [
      "dir id differs from branch id",
      [{ add: { "docs/dev/OTHER-9/brief.md": "b\n", "docs/dev/OTHER-9/spec.json": "{}\n" } }],
    ],
    [
      "nested subdir",
      [{ add: { [`${DIR}/sub/brief.md`]: "b\n", [`${DIR}/sub/spec.json`]: "{}\n" } }],
    ],
    ["modifies an existing file", [{ add: BRIEF_SPEC, edit: { "README.md": "changed\n" } }]],
    ["deletes an existing file", [{ add: BRIEF_SPEC, remove: ["README.md"] }]],
    [
      "earlier commit adds an extra file, later commit adds brief+spec",
      [{ add: { "src/extra.ts": "x\n" } }, { add: BRIEF_SPEC }],
    ],
  ] as [string, CommitSpec[]][])("ASDLC-1/AC-23 %s does not trigger", async (_label, commits) => {
    fixture({ branch: BRANCH, commits });
    const before = sh("rev-parse", "HEAD");
    const result = await run();
    expect(result).toEqual({ status: "skipped", reason: "unexpected_files" });
    expect(backendCalls).toEqual([]);
    expect(sh("rev-parse", "HEAD")).toBe(before);
  });

  it.each([
    [
      "brief.md and spec.json in separate commits",
      {
        commits: [
          { add: { [`${DIR}/brief.md`]: "b\n" } },
          { add: { [`${DIR}/spec.json`]: "{}\n" } },
        ],
      },
    ],
    ["main advanced after branching (merge-base diff)", { mainAdvance: true }],
  ] as [string, Partial<Parameters<typeof fixture>[0]>][])(
    "ASDLC-1/AC-23 %s triggers; PR0 commit sits on the branch tip",
    async (_label, extra) => {
      fixture({ branch: BRANCH, ...extra });
      const tip = sh("rev-parse", "HEAD");
      const result = await run();
      expect(result.status).toBe("gate");
      if (result.status !== "gate") return;
      expect(sh("rev-parse", `${result.sha}^`)).toBe(tip);
      expect(sh("rev-parse", "HEAD")).toBe(result.sha);
    },
  );

  it("ASDLC-1/AC-23 honours a non-'main' baseRef", async () => {
    fixture({ branch: BRANCH, base: "trunk" });
    const result = await run({ baseRef: "trunk" });
    expect(result.status).toBe("gate");
  });

  it.each([
    ["stack.enabled false", false],
    ["stack key absent", "absent"],
    ['stack.enabled string "true"', "true"],
  ] as const)("ASDLC-1/AC-23 %s ends green without running", async (_label, stack) => {
    fixture({ branch: BRANCH, stack });
    const before = sh("rev-parse", "HEAD");
    const result = await run();
    expect(result).toEqual({ status: "skipped", reason: "stack_disabled" });
    expect(backendCalls).toEqual([]);
    expect(sh("rev-parse", "HEAD")).toBe(before);
  });

  it("ASDLC-1/AC-23 no Dev Harness config ends green without running", async () => {
    fixture({ branch: BRANCH, noConfig: true });
    expect(await run()).toEqual({ status: "skipped", reason: "stack_disabled" });
    expect(backendCalls).toEqual([]);
  });

  it("ASDLC-1/AC-23 a root accord.json is not a config source: Dev Harness stack.enabled false wins", async () => {
    fixture({ branch: BRANCH, stack: false, rootAccordJson: { stack: { enabled: true } } });
    const before = sh("rev-parse", "HEAD");
    expect(await run()).toEqual({ status: "skipped", reason: "stack_disabled" });
    expect(backendCalls).toEqual([]);
    expect(sh("rev-parse", "HEAD")).toBe(before);
  });

  it.each([
    ["local stack branch", `stack/${ID}/pr-1`],
    ["unrelated branch", "feature/other"],
    ["accord/ without work item segment", "accord/x"],
    ["accord/<ID> with no trailing segment", `accord/${ID}`],
  ])("ASDLC-1/AC-23 %s does not trigger", async (_label, branch) => {
    fixture({ branch });
    const before = sh("rev-parse", "HEAD");
    const result = await run();
    expect(result).toEqual({ status: "skipped", reason: "not_ci_driven_branch" });
    expect(backendCalls).toEqual([]);
    expect(sh("rev-parse", "HEAD")).toBe(before);
  });

  it("ASDLC-1/AC-23 nested branch accord/<ID>/a/b triggers with the right work item id", async () => {
    fixture({ branch: `accord/${ID}/a/b` });
    const result = await run();
    expect(result.status).toBe("gate");
    if (result.status === "gate") expect(result.workItemId).toBe(ID);
    expect(backendCalls[0]?.ticket).toBe(ID);
  });
});

type Step = {
  id?: string;
  name?: string;
  run?: string;
  env?: Record<string, string>;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
};
const workflowPath = join(ROOT, ".github/workflows/accord-driven.yml");
const workflowText = () => readFileSync(workflowPath, "utf8");
const workflowDoc = () =>
  parseYaml(workflowText()) as {
    on: { push?: { branches?: string[] }; pull_request?: unknown; pull_request_target?: unknown };
    jobs: Record<string, { steps: Step[] }>;
  };
// Only the PR0 job: the resume job (ci-driven-resume.test.ts) has its own gate and steps.
const workflowSteps = () => workflowDoc().jobs.pr0?.steps ?? [];
const PR0_RUN = /bun packages\/accord-ci\/src\/ci-driven\/pr0\.ts/;

/** Make a workflow `run` script executable against a fixture repo (expressions substituted). */
function materialize(script: string, branch: string, sha: string): string {
  return script
    .replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, expr: string) =>
      expr.includes("ref_name") ? branch : expr.includes("github.sha") ? sha : "main",
    )
    .replaceAll("packages/accord-ci/", `${ROOT}/packages/accord-ci/`);
}

function runScript(script: string, branch: string, outputFile: string) {
  const sha = sh("rev-parse", "HEAD");
  return Bun.spawnSync(["bash", "-e", "-c", materialize(script, branch, sha)], {
    cwd: repo,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      GITHUB_REF_NAME: branch,
      GITHUB_SHA: sha,
      GITHUB_OUTPUT: outputFile,
      GITHUB_WORKSPACE: repo,
      CI: "true",
    },
  });
}

describe("ASDLC-1/AC-23 accord-driven workflow (ASDLC-1/TC-24)", () => {
  it("ASDLC-1/AC-23 pr0 triggers on push to accord/*/** (the workflow may also listen elsewhere for resume)", () => {
    const parsed = workflowDoc();
    expect(parsed.on.push?.branches).toContain("accord/*/**");
    expect(parsed.on.pull_request).toBeUndefined();
    expect(parsed.on.pull_request_target).toBeUndefined();
  });

  it("ASDLC-1/AC-23 token is only referenced as secrets env on the pr0 step and never echoed", () => {
    const lines = workflowText()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("ACCORD_CI_PUSH_TOKEN") && !line.startsWith("#"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/^ACCORD_CI_PUSH_TOKEN: \$\{\{ secrets\.ACCORD_CI_PUSH_TOKEN \}\}$/);
    }
    for (const step of workflowSteps()) {
      expect(step.run ?? "").not.toContain("ACCORD_CI_PUSH_TOKEN");
      expect(step.run ?? "").not.toMatch(/secrets\./);
    }
    expect(workflowText()).not.toMatch(
      /GITHUB_TOKEN.*ACCORD_CI_PUSH_TOKEN|ACCORD_CI_PUSH_TOKEN.*GITHUB_TOKEN/,
    );
    const pr0Step = workflowSteps().find((step) => PR0_RUN.test(step.run ?? ""));
    expect(pr0Step?.env?.ACCORD_CI_PUSH_TOKEN).toBe("${{ secrets.ACCORD_CI_PUSH_TOKEN }}");
  });

  it("ASDLC-1/AC-23 checkout does not persist GITHUB_TOKEN and fetches full history", () => {
    const checkout = workflowSteps().find((step) => step.uses?.startsWith("actions/checkout"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("ASDLC-1/AC-23 first run step reads the Dev Harness config and gates every later step", () => {
    const steps = workflowSteps();
    const firstRunIndex = steps.findIndex((step) => typeof step.run === "string");
    const firstRun = steps[firstRunIndex];
    expect(firstRun?.id).toBeTruthy();
    expect(firstRun?.run).not.toContain("accord.json");
    expect(firstRun?.run).toMatch(/AGENTS\.md|loadDevHarnessConfig|accord-ci\/src\//);
    expect(firstRun?.run).toContain("enabled");
    const later = steps.slice(firstRunIndex + 1);
    expect(later.length).toBeGreaterThan(0);
    for (const step of later) {
      expect(step.if ?? "").toMatch(
        new RegExp(`steps\\.${firstRun?.id}\\.outputs\\.[A-Za-z0-9_-]+ == 'true'`),
      );
    }
    // Steps before the gate are only checkout/setup actions.
    for (const step of steps.slice(0, firstRunIndex)) expect(step.uses).toBeTruthy();
  });

  it("ASDLC-1/AC-23 pr0 step runs the pr0 entry, after a git identity step", () => {
    const steps = workflowSteps();
    const pr0Index = steps.findIndex((step) => PR0_RUN.test(step.run ?? ""));
    expect(pr0Index).toBeGreaterThan(-1);
    const identity = steps
      .slice(0, pr0Index)
      .map((step) => step.run ?? "")
      .join("\n");
    expect(identity).toMatch(/git config (--global )?user\.name/);
    expect(identity).toMatch(/git config (--global )?user\.email/);
  });

  describe("gate script (first run step) executed against fixture repos", () => {
    const gateKey = (): string => {
      const steps = workflowSteps();
      const firstRun = steps.find((step) => typeof step.run === "string");
      const match = new RegExp(
        `steps\\.${firstRun?.id}\\.outputs\\.([A-Za-z0-9_-]+) == 'true'`,
      ).exec(steps.find((step) => step !== firstRun && step.if)?.if ?? "");
      return match?.[1] ?? "";
    };
    const firstScript = () =>
      workflowSteps().find((step) => typeof step.run === "string")?.run ?? "";

    it.each([
      ["enabled + brief/spec only", { branch: BRANCH }, true],
      ["stack.enabled false", { branch: BRANCH, stack: false }, false],
      ["stack key absent", { branch: BRANCH, stack: "absent" as const }, false],
      ["no Dev Harness config", { branch: BRANCH, noConfig: true }, false],
      [
        "enabled but extra file",
        { branch: BRANCH, commits: [{ add: { ...BRIEF_SPEC, "src/extra.ts": "x\n" } }] },
        false,
      ],
    ])(
      "ASDLC-1/AC-23 gate: %s (exit 0, key only when triggering)",
      (_label, fixtureOpts, expectTrue) => {
        fixture(fixtureOpts as Parameters<typeof fixture>[0]);
        const outFile = join(repo, "..", `gate-out-${Math.abs(repo.length)}-${repo.slice(-6)}`);
        writeFileSync(outFile, "");
        const before = sh("rev-parse", "HEAD");
        const proc = runScript(firstScript(), BRANCH, outFile);
        const output = readFileSync(outFile, "utf8");
        rmSync(outFile, { force: true });
        expect(proc.exitCode).toBe(0);
        expect(sh("rev-parse", "HEAD")).toBe(before);
        const key = gateKey();
        expect(key).not.toBe("");
        const isTrue = output.split("\n").includes(`${key}=true`);
        expect(isTrue).toBe(expectTrue);
      },
    );
  });

  describe("pr0 gate on the resume triggers (push to main, issue_comment)", () => {
    const firstScript = () =>
      workflowSteps().find((step) => typeof step.run === "string")?.run ?? "";
    const runKeyLines = (output: string) => output.split("\n").filter((l) => l.endsWith("=true"));

    it("ASDLC-1/AC-23 push to main (GITHUB_REF_NAME=main) never starts PR0, even with an enabled repo", () => {
      fixture({ branch: BRANCH });
      const outFile = join(repo, "..", `gate-main-${repo.slice(-6)}`);
      writeFileSync(outFile, "");
      const before = sh("rev-parse", "HEAD");
      const proc = runScript(firstScript(), "main", outFile);
      const output = readFileSync(outFile, "utf8");
      rmSync(outFile, { force: true });
      expect(proc.exitCode).toBe(0);
      expect(sh("rev-parse", "HEAD")).toBe(before);
      expect(runKeyLines(output)).toEqual([]);
    });

    it("ASDLC-1/AC-23 issue_comment event never starts PR0", () => {
      fixture({ branch: BRANCH });
      const outFile = join(repo, "..", `gate-comment-${repo.slice(-6)}`);
      writeFileSync(outFile, "");
      const sha = sh("rev-parse", "HEAD");
      const proc = Bun.spawnSync(["bash", "-e", "-c", materialize(firstScript(), "main", sha)], {
        cwd: repo,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          GITHUB_EVENT_NAME: "issue_comment",
          GITHUB_REF_NAME: "main",
          GITHUB_SHA: sha,
          GITHUB_OUTPUT: outFile,
          GITHUB_WORKSPACE: repo,
          CI: "true",
        },
      });
      const output = readFileSync(outFile, "utf8");
      rmSync(outFile, { force: true });
      expect(proc.exitCode).toBe(0);
      expect(runKeyLines(output)).toEqual([]);
    });
  });

  describe("pr0 CLI entry (spawned as CI would, from the workflow's own command)", () => {
    const pr0Script = () => workflowSteps().find((step) => PR0_RUN.test(step.run ?? ""))?.run ?? "";

    it("ASDLC-1/AC-23 stack disabled: exit 0, HEAD unchanged, GITHUB_OUTPUT status=skipped", () => {
      fixture({ branch: BRANCH, stack: false });
      const outFile = join(repo, "..", `pr0-out-${repo.slice(-6)}`);
      writeFileSync(outFile, "");
      const before = sh("rev-parse", "HEAD");
      const proc = runScript(pr0Script(), BRANCH, outFile);
      const output = readFileSync(outFile, "utf8");
      rmSync(outFile, { force: true });
      expect(proc.exitCode).toBe(0);
      expect(sh("rev-parse", "HEAD")).toBe(before);
      expect(output.split("\n")).toContain("status=skipped");
    });

    it("ASDLC-1/AC-23 enabled but ACCORD_CI_PUSH_TOKEN missing: fails before any work", () => {
      fixture({ branch: BRANCH });
      const outFile = join(repo, "..", `pr0-miss-${repo.slice(-6)}`);
      writeFileSync(outFile, "");
      const before = sh("rev-parse", "HEAD");
      const proc = runScript(pr0Script(), BRANCH, outFile);
      rmSync(outFile, { force: true });
      expect(proc.exitCode).not.toBe(0);
      expect(proc.stderr.toString()).toContain("MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN");
      expect(sh("rev-parse", "HEAD")).toBe(before);
      expect(existsSync(join(repo, DIR, "plan.json"))).toBe(false);
    });
  });
});

describe("ASDLC-1/AC-31 docs/ci/pre-merge-smoke.md covers PR0 (ASDLC-1/TC-32)", () => {
  const doc = () => readFileSync(join(ROOT, "docs/ci/pre-merge-smoke.md"), "utf8");

  it("ASDLC-1/AC-31 smoke doc names pr0.ts, accord-driven.yml and this test", () => {
    expect(doc()).toContain("packages/accord-ci/src/ci-driven/pr0.ts");
    expect(doc()).toContain(".github/workflows/accord-driven.yml");
    expect(doc()).toContain("bun test packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts");
  });

  it("ASDLC-1/AC-31 scope sentence lists the workflow; doc describes trigger and gate", () => {
    const text = doc();
    const scope = text.slice(0, text.indexOf("## 1"));
    expect(scope).toContain(".github/workflows/accord-driven.yml");
    for (const needle of ["accord/*/**", "stack.enabled", "brief.md", "spec.json"]) {
      expect(text).toContain(needle);
    }
  });
});
