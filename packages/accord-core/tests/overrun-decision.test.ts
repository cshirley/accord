import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { buildWorkItemTrace, writeWorkItemTrace } from "../src/artifacts/trace-artifact.js";
import { validateArtifact, validateReturn } from "../src/artifacts/validation.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { measureActualLines } from "../src/evidence/lines.js";
import { processSubagentToolResult } from "../src/harness/index.js";
import type { HarnessMutableState } from "../src/harness/types.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";
import { checkOverrun } from "../src/stack/overrun.js";
import type { TaskFileV2 } from "../src/tasks/types.js";
import { loadPricing } from "../src/telemetry/usage.js";
import { loadWorkItem } from "../src/work-items/io.js";
import { devBootstrap } from "../src/work-items/lifecycle.js";
import { writeTaskFixture } from "./helpers/task-fixture.js";

// ASDLC-1/AC-16 (ASDLC-1/TC-17), ASDLC-1/AC-29 (stack.overrun.detected call site).
// ASDLC-1/AC-30 alignment (trace-schema `size`): the trace.json size tests below write trace.json
// to disk, validate it with validateArtifact and show a malformed size block is rejected by the
// schema (Ajv). Runtime enforcement is `bun run validate:schemas` / `validate:assets`
// (phase-verify-task).
// ASDLC-1/TC-30 (stack.overrun.detected call site) is asserted here, not in stack-telemetry.test.ts.
// Contract pinned here (spec leaves exact shape open):
//   checkOverrun(id, task, {cwd, config, base, head}) -> {overrun, est_lines, act_prod_lines,
//   act_test_lines, act_lines, decision_id?}; est_lines from docs/dev/<ID>/plan.json tasks[];
//   overrun iff act_lines > overrun_factor * est_lines (default 1.5, strict); on overrun a pending
//   decision (source "overrun") is pushed once to the work item; trace.json tasks[].size records
//   {est_lines, act_prod_lines, act_test_lines} after the check.
const ID = "OVR-1";
const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TASK = join(here, "..", "schemas", "task-file.example.json");
const CONFIG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { enabled: true },
} as unknown as DevHarnessConfig;

let originalCwd: string;
let dir: string;
let originalLevel: ReturnType<typeof getLogLevel>;
let logged: string[];
let originalError: typeof console.error;

function git(...args: string[]): string {
  const res = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function lines(count: number, tag: string): string {
  return Array.from({ length: count }, (_, index) => `${tag}${index}\n`).join("");
}

function writePlan(estLines: number | undefined): void {
  writePlanTasks([{ id: 1, est: estLines }]);
}

function writePlanTasks(tasks: Array<{ id: number; est: number | undefined }>): void {
  const plan = {
    tasks: tasks.map((task) => ({
      id: task.id,
      ...(task.est === undefined ? {} : { est_lines: task.est }),
    })),
  };
  mkdirSync(`docs/dev/${ID}`, { recursive: true });
  writeFileSync(`docs/dev/${ID}/plan.json`, `${JSON.stringify(plan)}\n`);
}

/** base commit, then a head commit adding prod/test lines plus excluded noise. */
function commitDiff(prod: number, test: number): { base: string; head: string } {
  writeFileSync("README.md", "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  mkdirSync("src", { recursive: true });
  mkdirSync("tests", { recursive: true });
  mkdirSync(`docs/dev/${ID}/state`, { recursive: true });
  mkdirSync(`docs/dev/${ID}/reviews`, { recursive: true });
  mkdirSync(`docs/dev/${ID}/evidence`, { recursive: true });
  if (prod > 0) writeFileSync("src/a.ts", lines(prod, "p"));
  if (test > 0) writeFileSync("tests/a.test.ts", lines(test, "t"));
  // Excluded noise: must never count.
  writeFileSync("bun.lock", lines(500, "l"));
  writeFileSync("src/api.generated.ts", lines(500, "g"));
  writeFileSync(`docs/dev/${ID}/state/s.json`, lines(500, "s"));
  writeFileSync(`docs/dev/${ID}/reviews/r.md`, lines(500, "r"));
  writeFileSync(`docs/dev/${ID}/evidence/e.md`, lines(500, "e"));
  git("add", "-A");
  git("commit", "-q", "-m", "green");
  return { base, head: git("rev-parse", "HEAD") };
}

function writeTaskFile(taskId = 1): void {
  const task = JSON.parse(readFileSync(EXAMPLE_TASK, "utf8")) as TaskFileV2;
  task.work_item = ID;
  task.task = taskId;
  mkdirSync(".tasks", { recursive: true });
  writeFileSync(join(".tasks", `${ID}-task-${String(taskId)}.json`), JSON.stringify(task));
}

/** Commit exactly the given files (path -> content) and return the new HEAD. */
function commitFiles(files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  git("add", "-A");
  git("commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}

function traceSize(taskId: number): unknown {
  const built = buildWorkItemTrace(ID);
  if (!built.ok) throw new Error(built.error);
  const task = built.value.tasks.find((entry) => entry.id === taskId) as unknown as
    | { size?: unknown }
    | undefined;
  return task?.size;
}

beforeEach(() => {
  originalCwd = process.cwd();
  dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-overrun-")));
  process.chdir(dir);
  git("init", "-q", "--initial-branch=main");
  git("config", "commit.gpgsign", "false");
  devBootstrap(ID, "Overrun fixture", "implement", "standard");
  writeTaskFile();
  originalLevel = getLogLevel();
  setLogLevel("debug");
  logged = [];
  originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.error = originalError;
  setLogLevel(originalLevel);
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

function overrunDecisions() {
  return (loadWorkItem(ID)?.decisions ?? []).filter((decision) => decision.source === "overrun");
}

describe("ASDLC-1/AC-16 checkOverrun threshold", () => {
  it("ASDLC-1/AC-16 above 1.5x est: reports overrun with separate prod/test counts", async () => {
    writePlan(100); // 1.5x = 150; 120 prod + 31 test = 151
    const { base, head } = commitDiff(120, 31);
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(result.overrun).toBe(true);
    expect(result.est_lines).toBe(100);
    expect(result.act_prod_lines).toBe(120);
    expect(result.act_test_lines).toBe(31);
    expect(result.act_lines).toBe(151);
  });

  it("ASDLC-1/AC-16 exactly 1.5x est: no overrun, no decision, no event", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 30); // 150
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(result.overrun).toBe(false);
    expect(result.act_lines).toBe(150);
    expect(result.decision_id).toBeUndefined();
    expect(overrunDecisions()).toHaveLength(0);
    expect(logged.filter((line) => line.includes("stack.overrun.detected"))).toHaveLength(0);
  });

  it("ASDLC-1/AC-16 below est: no overrun", async () => {
    writePlan(100);
    const { base, head } = commitDiff(40, 10);
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(result.overrun).toBe(false);
    expect(overrunDecisions()).toHaveLength(0);
  });

  it("ASDLC-1/AC-16 excludes lockfiles, generated, state, reviews and evidence from the count", async () => {
    writePlan(100);
    // 2500 noise lines would overrun if counted; 20 real lines must not.
    const { base, head } = commitDiff(10, 10);
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(result.act_prod_lines).toBe(10);
    expect(result.act_test_lines).toBe(10);
    expect(result.overrun).toBe(false);
  });

  it("ASDLC-1/AC-16 honours stack.sizing.overrun_factor", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31); // 151 <= 2x
    const config = {
      ...CONFIG,
      stack: { enabled: true, sizing: { overrun_factor: 2 } },
    } as unknown as DevHarnessConfig;
    const result = await checkOverrun(ID, 1, { cwd: dir, config, base, head });
    expect(result.overrun).toBe(false);
    expect(overrunDecisions()).toHaveLength(0);
  });
});

describe("ASDLC-1/AC-16 overrun decision", () => {
  it("ASDLC-1/AC-16 raises one pending decision offering re-plan and accept-with-reason", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31);
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const decisions = overrunDecisions();
    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision?.status).toBe("pending");
    expect(decision?.id).toBe(result.decision_id as string);
    const text = `${decision?.question} ${decision?.context ?? ""}`;
    expect(text).toMatch(/re-?plan/i);
    expect(text).toMatch(/accept/i);
    expect(text).toMatch(/reason/i);
    // Re-plan drives `/dev amend-spec <reason> --replan` (amend session: task 22).
    // Real syntax: `/dev amend-spec <ID> <reason> [--replan]` (resolve/subcommand.ts). The
    // end-to-end amend session (replan === true) is covered by task 22's contract-amend-session.test.ts.
    expect(text).toMatch(new RegExp(`/dev amend-spec ${ID} \\S.*--replan`));
    expect(text).toMatch(/task[ -]?1\b/i);
    expect(text).toContain("151");
    expect(text).toContain("100");
  });

  it("ASDLC-1/AC-16 re-running the check does not duplicate the decision", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31);
    const first = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const second = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(second.decision_id).toBe(first.decision_id as string);
    expect(overrunDecisions()).toHaveLength(1);
  });

  it("ASDLC-1/AC-16 plan task without est_lines: nothing to compare, no decision", async () => {
    writePlan(undefined);
    const { base, head } = commitDiff(500, 500);
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(result.overrun).toBe(false);
    expect(overrunDecisions()).toHaveLength(0);
  });
});

describe("ASDLC-1/AC-29 stack.overrun.detected", () => {
  it("ASDLC-1/AC-29 emits at warn with work_item_id, task, est_lines, act_lines", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31);
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const events = logged.filter((line) => line.includes("stack.overrun.detected"));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("[accord:stack:warn]");
    expect(events[0]).toContain(
      `stack.overrun.detected work_item_id=${ID} task=1 est_lines=100 act_lines=151`,
    );
  });
});

describe("ASDLC-1/AC-16 trace.json size record", () => {
  it("ASDLC-1/AC-16 trace records est_lines, act_prod_lines, act_test_lines per task", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31);
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const built = buildWorkItemTrace(ID);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const task = built.value.tasks.find((entry) => entry.id === 1) as unknown as {
      size?: unknown;
    };
    expect(task.size).toEqual({ est_lines: 100, act_prod_lines: 120, act_test_lines: 31 });
  });

  it("ASDLC-1/AC-30 written trace.json carries size, is schema-valid, malformed size is rejected", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31);
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const written = writeWorkItemTrace(ID);
    if (!written.ok) throw new Error(written.error);
    const onDisk = JSON.parse(readFileSync(written.value.json_path, "utf8")) as {
      tasks: Array<Record<string, unknown>>;
    };
    expect(onDisk.tasks[0]?.size).toEqual({
      est_lines: 100,
      act_prod_lines: 120,
      act_test_lines: 31,
    });
    const validation = await validateArtifact(written.value.json_path);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);

    const schema = JSON.parse(
      readFileSync(join(here, "..", "schemas", "trace-schema.json"), "utf8"),
    ) as object;
    const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
    const withSize = (size: unknown) => ({
      ...onDisk,
      tasks: [{ ...onDisk.tasks[0], size }, ...onDisk.tasks.slice(1)],
    });
    expect(validate(withSize({ est_lines: 100, act_prod_lines: 120, act_test_lines: 31 }))).toBe(
      true,
    );
    expect(validate(withSize({ est_lines: "100", act_prod_lines: 1, act_test_lines: 1 }))).toBe(
      false,
    );
    expect(
      validate(withSize({ est_lines: 100, act_prod_lines: 1, act_test_lines: 1, extra: 1 })),
    ).toBe(false);
  });

  it("ASDLC-1/AC-16 within-budget task is still recorded in trace size", async () => {
    writePlan(100);
    const { base, head } = commitDiff(40, 10);
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const built = buildWorkItemTrace(ID);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const task = built.value.tasks.find((entry) => entry.id === 1) as unknown as {
      size?: unknown;
    };
    expect(task.size).toEqual({ est_lines: 100, act_prod_lines: 40, act_test_lines: 10 });
  });

  it("ASDLC-1/AC-16 trace without a measurement has no size block", () => {
    const built = buildWorkItemTrace(ID);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.tasks.find((entry) => entry.id === 1)).not.toHaveProperty("size");
  });
});

describe("ASDLC-1/AC-16 line definition matches measureActualLines", () => {
  it("ASDLC-1/AC-16 honours config.test.file_pattern when no options.testPattern is given", async () => {
    writePlan(100);
    const config = {
      test: { command: "bun test", file_pattern: "**/*_spec.ts" },
      stack: { enabled: true },
    } as unknown as DevHarnessConfig;
    writeFileSync("README.md", "base\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    const head = commitFiles(
      { "src/a.ts": lines(20, "p"), "tests/a_spec.ts": lines(15, "t") },
      "green",
    );
    const result = await checkOverrun(ID, 1, { cwd: dir, config, base, head });
    expect(result.act_prod_lines).toBe(20);
    expect(result.act_test_lines).toBe(15);
  });

  it("ASDLC-1/AC-16 counts added plus deleted lines, same as measureActualLines", async () => {
    writePlan(1000);
    const base = commitFiles({ "src/a.ts": lines(100, "p") }, "base");
    const rewritten = `${lines(30, "q") + lines(100, "p").split("\n").slice(30, 80).join("\n")}\n`;
    const head = commitFiles({ "src/a.ts": rewritten }, "head"); // 30 rewritten + 20 deleted
    const result = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const expected = await measureActualLines(dir, base, head, { testPattern: "**/*.test.ts" });
    expect({
      act_prod_lines: result.act_prod_lines,
      act_test_lines: result.act_test_lines,
    }).toEqual(expected);
    expect(result.act_prod_lines).toBe(80);
    expect(result.act_test_lines).toBe(0);
  });

  it("ASDLC-1/AC-16 a later, larger GREEN refreshes trace size while the decision stays single", async () => {
    writePlan(100);
    const { base, head } = commitDiff(120, 31);
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(traceSize(1)).toEqual({ est_lines: 100, act_prod_lines: 120, act_test_lines: 31 });
    const head2 = commitFiles({ "src/a.ts": lines(140, "p") }, "more");
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head: head2 });
    expect(traceSize(1)).toEqual({ est_lines: 100, act_prod_lines: 140, act_test_lines: 31 });
    expect(overrunDecisions()).toHaveLength(1);
  });
});

describe("ASDLC-1/AC-16 per-task behaviour", () => {
  it("ASDLC-1/AC-16 est_lines is read per task id, not from the first plan task", async () => {
    writePlanTasks([
      { id: 1, est: 500 },
      { id: 2, est: 100 },
    ]);
    writeTaskFile(2);
    const { base, head } = commitDiff(120, 31);
    const second = await checkOverrun(ID, 2, { cwd: dir, config: CONFIG, base, head });
    expect(second.overrun).toBe(true);
    expect(second.est_lines).toBe(100);
    const first = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(first.overrun).toBe(false);
    expect(first.est_lines).toBe(500);
    expect(overrunDecisions()).toHaveLength(1);
    expect(traceSize(2)).toEqual({ est_lines: 100, act_prod_lines: 120, act_test_lines: 31 });
    expect(traceSize(1)).toEqual({ est_lines: 500, act_prod_lines: 120, act_test_lines: 31 });
  });

  it("ASDLC-1/AC-16 two overrunning tasks get two distinct pending decisions naming their task", async () => {
    writePlanTasks([
      { id: 1, est: 100 },
      { id: 2, est: 100 },
    ]);
    writeTaskFile(2);
    const { base, head } = commitDiff(120, 31);
    const first = await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    const second = await checkOverrun(ID, 2, { cwd: dir, config: CONFIG, base, head });
    expect(first.decision_id).toBeDefined();
    expect(second.decision_id).toBeDefined();
    expect(second.decision_id).not.toBe(first.decision_id as string);
    const decisions = overrunDecisions();
    expect(decisions).toHaveLength(2);
    expect(decisions.every((decision) => decision.status === "pending")).toBe(true);
    const textOf = (id: string | undefined) => {
      const decision = decisions.find((entry) => entry.id === id);
      return `${decision?.question} ${decision?.context ?? ""}`;
    };
    expect(textOf(first.decision_id)).toMatch(/task[ -]?1\b/i);
    expect(textOf(second.decision_id)).toMatch(/task[ -]?2\b/i);
  });

  it("ASDLC-1/AC-29 event carries the task id of the checked task", async () => {
    writePlanTasks([
      { id: 1, est: 500 },
      { id: 2, est: 100 },
    ]);
    writeTaskFile(2);
    const { base, head } = commitDiff(120, 31);
    await checkOverrun(ID, 2, { cwd: dir, config: CONFIG, base, head });
    const events = logged.filter((line) => line.includes("stack.overrun.detected"));
    expect(events).toHaveLength(1);
    expect(events[0]).toContain(
      `stack.overrun.detected work_item_id=${ID} task=2 est_lines=100 act_lines=151`,
    );
  });

  it("ASDLC-1/AC-29 goes through the shared logger: silent at error level, decision still raised", async () => {
    writePlan(100);
    setLogLevel("error");
    const { base, head } = commitDiff(120, 31);
    await checkOverrun(ID, 1, { cwd: dir, config: CONFIG, base, head });
    expect(logged.filter((line) => line.includes("stack.overrun.detected"))).toHaveLength(0);
    expect(overrunDecisions()).toHaveLength(1);
  });
});

describe("ASDLC-1/AC-16 orchestrator wiring (processSubagentToolResult)", () => {
  const WID = "ASDLC-1";
  const TASK = 7;
  const SRC = "src/foo.ts";
  const TEST = "tests/foo.test.ts";

  function wireConfig(stack?: Record<string, unknown>): DevHarnessConfig {
    return {
      schema_version: "1.0",
      language: "typescript",
      test: { command: "true", file_pattern: "**/*.test.ts" },
      type_check: null,
      lint: null,
      format: null,
      verification_commands: [],
      ...(stack ? { stack } : {}),
    } as unknown as DevHarnessConfig;
  }

  function seed(phase: "phase-test" | "phase-code", est: number | undefined): void {
    writeFileSync(".gitignore", ".tasks/\n");
    writeFileSync("README.md", "# repo\n");
    writeFileSync(
      join(".tasks", `${WID}.json`),
      JSON.stringify({
        schema_version: "1.0",
        id: WID,
        title: "Wired overrun",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
        pattern: "implement",
        phase: "implementing",
        task_ids: [TASK],
        spec: null,
        plan: `docs/dev/${WID}/plan.json`,
        verify: null,
        brief: null,
        decisions: [],
        deviations: [],
        cost_usd: 0,
      }),
    );
    mkdirSync(`docs/dev/${WID}`, { recursive: true });
    writeFileSync(
      `docs/dev/${WID}/plan.json`,
      JSON.stringify({
        tasks: [
          {
            id: TASK,
            title: "Wired task",
            files: [
              { path: SRC, action: "create" },
              { path: TEST, action: "create" },
            ],
            ...(est === undefined ? {} : { est_lines: est }),
          },
        ],
      }),
    );
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    writeTaskFixture({ workItemId: WID, taskId: TASK, phase, coversAc: ["AC-1"] }, dir);
  }

  async function run(
    agent: string,
    packet: Record<string, unknown>,
    devConfig: DevHarnessConfig,
  ): Promise<void> {
    const validation = await validateReturn(agent, packet);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    const state: HarnessMutableState = {
      devConfig,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    await processSubagentToolResult({
      details: {
        results: [
          {
            agent,
            task: `**task_id:** ${TASK}\n${WID} wired run`,
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(packet)}\n\`\`\`` }],
              },
            ],
          },
        ],
      },
      state,
      pricing: loadPricing(),
    });
  }

  const redPacket = {
    status: "done",
    test_files: [TEST],
    red_confirmed: true,
    ac_covered: ["AC-1"],
    deviations_emitted: 0,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
  const greenPacket = {
    status: "done",
    tests_passing: true,
    changes: [{ file: SRC, action: "add", kind: "code", ac_ids: ["AC-1"] }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
  const wiredDecisions = () =>
    (loadWorkItem(WID)?.decisions ?? []).filter((decision) => decision.source === "overrun");
  const wiredEvents = () => logged.filter((line) => line.includes("stack.overrun.detected"));
  const wiredSize = () => {
    const built = buildWorkItemTrace(WID);
    if (!built.ok) throw new Error(built.error);
    return (built.value.tasks.find((entry) => entry.id === TASK) as unknown as { size?: unknown })
      ?.size;
  };

  it("ASDLC-1/AC-16 stack enabled: GREEN with est 10 and a 40-line src raises one pending overrun decision and records size", async () => {
    seed("phase-code", 10);
    mkdirSync("src", { recursive: true });
    writeFileSync(SRC, lines(40, "p"));
    await run("phase-code", greenPacket, wireConfig({ enabled: true, commits: "phase" }));
    const decisions = wiredDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.status).toBe("pending");
    expect(wiredEvents()).toHaveLength(1);
    expect(wiredEvents()[0]).toContain(`work_item_id=${WID} task=${TASK} est_lines=10`);
    const size = wiredSize() as { est_lines: number; act_prod_lines: number } | undefined;
    expect(size?.est_lines).toBe(10);
    expect(size?.act_prod_lines).toBeGreaterThan(0);
  });

  it("ASDLC-1/AC-16 RED (phase-test) with an oversized test file does not trigger the overrun check", async () => {
    seed("phase-test", 10);
    mkdirSync("tests", { recursive: true });
    writeFileSync(TEST, lines(40, "t"));
    await run("phase-test", redPacket, wireConfig({ enabled: true, commits: "phase" }));
    expect(wiredDecisions()).toHaveLength(0);
    expect(wiredEvents()).toHaveLength(0);
  });

  it.each([
    ["stack block absent", undefined],
    ["stack.enabled false", { enabled: false, commits: "phase" }],
    ["stack without enabled", { commits: "phase" }],
  ] as Array<[string, Record<string, unknown> | undefined]>)(
    "ASDLC-1/AC-16 %s: GREEN overrun is not measured (no decision, no size, no event)",
    async (_name, stack) => {
      seed("phase-code", 10);
      mkdirSync("src", { recursive: true });
      writeFileSync(SRC, lines(40, "p"));
      await run("phase-code", greenPacket, wireConfig(stack));
      expect(wiredDecisions()).toHaveLength(0);
      expect(wiredEvents()).toHaveLength(0);
      expect(wiredSize()).toBeUndefined();
    },
  );

  it("ASDLC-1/AC-16 est_lines omitted from the plan: GREEN raises no overrun decision", async () => {
    seed("phase-code", undefined);
    mkdirSync("src", { recursive: true });
    writeFileSync(SRC, lines(40, "p"));
    await run("phase-code", greenPacket, wireConfig({ enabled: true, commits: "phase" }));
    expect(wiredDecisions()).toHaveLength(0);
    expect(wiredEvents()).toHaveLength(0);
  });
});
