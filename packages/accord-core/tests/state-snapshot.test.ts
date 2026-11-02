import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { commitTaskEvidence } from "../src/commit/evidence-commit.js";
import { tryCommitPhase } from "../src/commit/phase-commit.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";
import { redactTaskFile } from "../src/state/redact.js";
import { writeStateSnapshot } from "../src/state/snapshot.js";
import { renderTaskTrace } from "../src/tasks/render.js";
import type { TaskFileV2 } from "../src/tasks/types.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const taskSchema = JSON.parse(
  readFileSync(join(here, "..", "schemas", "task-schema.json"), "utf8"),
);

const ID = "ASDLC-1";
const TASK = 7;
const STATE_DIR = `docs/dev/${ID}/state/task-${String(TASK)}`;
const TEST_FILE = "tests/foo.test.ts";
const ORIGINAL_NONCE = "a1b2c3";

// Seeds are built at runtime so no full token literal is ever committed.
const ghToken = `${"gh"}p_${"A1b2".repeat(9)}`;
const awsToken = `${"AK"}IA${"ABCDEFGH12345678"}`;
const ENV_NAME = "ASDLC1_SNAPSHOT_TEST_SECRET";
const ENV_VALUE = "snapshotEnvSecret-24680";
const HOME_PATH = `/${"Users"}/${"jane.doe"}/src/proj`;
const LINUX_HOME_PATH = `/${"home"}/${"bob"}/work`;
const ASSIGN = `${"API"}_${"KEY"}=hunter2hunter2`;
const MARKERS = ["PROMPT-MARKER-1", "TRANSCRIPT-MARKER-2", "RAWKEY-MARKER-3"];
const RAW_PACKET_MARKER = "RAWPKT-7f3a";
const SEEDS = [ghToken, awsToken, ENV_VALUE, "jane.doe", "bob/work", "hunter2hunter2"];
const LIVE_PATH = join(".tasks", `${ID}-task-${String(TASK)}.json`);

function cfg(state: Record<string, unknown> | undefined, commits = "phase"): DevHarnessConfig {
  return {
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    stack: { enabled: true, commits, ...(state ? { state } : {}) },
  } as unknown as DevHarnessConfig;
}
const TREE_CFG = cfg({ persist: "tree", redact: true });

let originalCwd: string;
let repo: string;
let errSpy: ReturnType<typeof spyOn>;
let priorLevel: ReturnType<typeof getLogLevel>;
let savedEnv: string | undefined;
let savedTimestamp: string | undefined;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function logged(): string[] {
  return errSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}
function filesOf(rev: string): string[] {
  return git("show", "--name-only", "--pretty=format:", rev).trim().split("\n").filter(Boolean);
}
function seedTask(note = `FAIL at ${HOME_PATH}/a.ts ${ghToken} ${ASSIGN}`, extra?: () => void) {
  const task = writeTaskFixture({
    workItemId: ID,
    taskId: TASK,
    ownerNonce: ORIGINAL_NONCE,
    coversAc: ["AC-12"],
    testCases: { "AC-12": ["TC-13"] },
  });
  const path = join(".tasks", `${ID}-task-${String(TASK)}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  raw.control.in_flight = {
    ref: "T1/phase-test",
    agent: "phase-test",
    stage: "spawned",
    at: "2026-01-01T00:00:00.000Z",
  };
  raw.log = [
    {
      ref: "T1/phase-test",
      at: "2026-01-01T00:00:00.000Z",
      result: "done",
      note: `${note}\nAuthorization: Bearer ${"Zm9v".repeat(8)}\nenv ${ENV_VALUE}\n${awsToken}\n${LINUX_HOME_PATH}/x.ts`,
    },
  ];
  raw.log[0].events = [
    {
      type: "escalation",
      question: "q",
      description: `see ${HOME_PATH}/b.ts`,
      prompt: MARKERS[0],
      transcript: MARKERS[1],
      raw_packet: MARKERS[2],
    },
  ];
  raw.log[0].warnings = [`warn ${ghToken}`];
  expect(raw.requirements.length).toBeGreaterThan(0);
  raw.requirements[0].text = `AC text ${awsToken} ${LINUX_HOME_PATH}/r.ts`;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
  extra?.();
  return task;
}
function setTaskStatus(status: string): void {
  const path = join(".tasks", `${ID}-task-${String(TASK)}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.control.status = status;
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}
/** Appends a log entry to the live task so the rendered trace legitimately changes. */
function appendLive(ref: string, note: string): void {
  const raw = JSON.parse(readFileSync(LIVE_PATH, "utf8"));
  raw.log.push({ ref, at: "2026-01-01T00:01:00.000Z", result: "clean", note });
  writeFileSync(LIVE_PATH, `${JSON.stringify(raw, null, 2)}\n`);
}
/** Raw return packets and raw test output live in the task sidecar dir. */
function seedSidecars(): void {
  const dir = join(".tasks", `${ID}-task-${String(TASK)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "T1-phase-test.json"),
    JSON.stringify({
      agent: "phase-test",
      ref: "T1/phase-test",
      at: "2026-01-01T00:00:00.000Z",
      packet: { status: "done", test_output: `${RAW_PACKET_MARKER} ${ghToken}` },
    }),
  );
  writeFileSync(
    join(dir, "T1-phase-test.output.txt"),
    `OUTPUT ${ghToken} ${HOME_PATH}/z.ts\n${"y".repeat(300_000)}`,
  );
  const raw = JSON.parse(readFileSync(LIVE_PATH, "utf8"));
  raw.control.last_test_run = {
    ref: "T1/phase-test",
    red: "behaviour",
    confirmed: true,
    output: "T1-phase-test.output.txt",
  };
  writeFileSync(LIVE_PATH, `${JSON.stringify(raw, null, 2)}\n`);
}
function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
function stateFiles(): string[] {
  const dir = join(repo, STATE_DIR);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
function phasePacket(): Record<string, unknown> {
  return {
    status: "done",
    test_files: [TEST_FILE],
    changes: [{ file: TEST_FILE, action: "add", kind: "test", ac_ids: ["AC-12"] }],
    red_confirmed: true,
    test_output: `leak ${ghToken} ${HOME_PATH}`,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

beforeEach(() => {
  priorLevel = getLogLevel();
  setLogLevel("debug");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  savedTimestamp = process.env.ACCORD_LOG_TIMESTAMP;
  delete process.env.ACCORD_LOG_TIMESTAMP;
  savedEnv = process.env[ENV_NAME];
  process.env[ENV_NAME] = ENV_VALUE;
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-snapshot-")));
  process.chdir(repo);
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("README.md", "# repo\n");
  mkdirSync(".tasks", { recursive: true });
  write(
    join(".tasks", `${ID}.json`),
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Snapshot",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [TASK],
      spec: null,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

afterEach(() => {
  process.chdir(originalCwd);
  errSpy.mockRestore();
  setLogLevel(priorLevel);
  if (savedTimestamp === undefined) delete process.env.ACCORD_LOG_TIMESTAMP;
  else process.env.ACCORD_LOG_TIMESTAMP = savedTimestamp;
  if (savedEnv === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = savedEnv;
  rmSync(repo, { recursive: true, force: true });
});

describe("ASDLC-1/AC-12 writeStateSnapshot (ASDLC-1/TC-13)", () => {
  it("ASDLC-1/AC-12 writes exactly STATE.md and task.json under state/task-<N>/, never raw packets or sidecars", async () => {
    seedTask();
    seedSidecars();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    expect(stateFiles()).toEqual(["STATE.md", "task.json"]);
    const written = walk(join(repo, "docs"));
    expect(written.some((file) => /T\d+-[a-z-]+\.(json|output\.txt)$/.test(file))).toBe(false);
    for (const file of written) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain(RAW_PACKET_MARKER);
      for (const seed of SEEDS) expect(text).not.toContain(seed);
    }
  });

  it("ASDLC-1/AC-12 prompts, transcripts, raw packets and every string field are redacted, task.json stays schema-valid", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    const validate = new Ajv({ allErrors: true, strict: false }).compile(taskSchema);
    for (const name of stateFiles()) {
      const text = readFileSync(join(repo, STATE_DIR, name), "utf8");
      for (const marker of MARKERS) expect(text).not.toContain(marker);
      for (const seed of SEEDS) expect(text).not.toContain(seed);
    }
    const parsed = JSON.parse(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"));
    expect(validate(parsed)).toBe(true);
    const event = parsed.log[0].events[0];
    expect(event.type).toBe("escalation");
    expect(Object.keys(event)).not.toContain("prompt");
    expect(Object.keys(event)).not.toContain("transcript");
    expect(Object.keys(event)).not.toContain("raw_packet");
    expect(parsed.log[0].warnings[0]).not.toContain(ghToken);
    expect(parsed.log[0].warnings[0]).toContain("[REDACTED");
    expect(parsed.requirements[0].text).not.toContain(awsToken);
    expect(parsed.requirements[0].text).not.toContain("bob/");
    expect(parsed.requirements[0].text).toContain("AC text");
  });

  it("ASDLC-1/AC-12 STATE.md equals renderTaskTrace of the redacted task", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    const snapshotTask = JSON.parse(
      readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"),
    ) as TaskFileV2;
    const md = readFileSync(join(repo, STATE_DIR, "STATE.md"), "utf8");
    expect(md).toBe(renderTaskTrace(snapshotTask));
    // The trace is rendered from the redacted task, not the raw one.
    expect(md).toContain(`${ID} · task ${String(TASK)}`);
    expect(md).not.toBe(renderTaskTrace(readTaskFixture(ID, TASK)));
  });

  it("ASDLC-1/AC-12 task.json validates against task-schema.json with in_flight null and a reset owner_nonce", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    const snapshotTask = JSON.parse(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"));
    const validate = new Ajv({ allErrors: true, strict: false }).compile(taskSchema);
    const valid = validate(snapshotTask);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
    expect(snapshotTask.control.in_flight).toBeNull();
    expect(snapshotTask.control.owner_nonce).toMatch(/^[0-9a-f]{6}$/);
    expect(snapshotTask.control.owner_nonce).not.toBe(ORIGINAL_NONCE);
    expect(snapshotTask.work_item).toBe(ID);
    expect(snapshotTask.task).toBe(TASK);
  });

  it("ASDLC-1/AC-12 does not modify the live .tasks/ file (nonce and in_flight preserved)", async () => {
    seedTask();
    const before = readFileSync(LIVE_PATH, "utf8");
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    expect(readFileSync(LIVE_PATH, "utf8")).toBe(before);
    const live = readTaskFixture(ID, TASK);
    expect(live.control.owner_nonce).toBe(ORIGINAL_NONCE);
    expect(live.control.in_flight).not.toBeNull();
  });

  it("ASDLC-1/AC-12 every seeded secret, token, env value and home path is redacted from both files", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    for (const name of stateFiles()) {
      const text = readFileSync(join(repo, STATE_DIR, name), "utf8");
      for (const seed of SEEDS) expect(text).not.toContain(seed);
      expect(text).not.toMatch(/(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE)=(?!\[REDACTED)/);
      expect(text).not.toMatch(/\/Users\/(?!\[REDACTED)[^/\s]+\//);
      expect(text).not.toMatch(/\/home\/(?!\[REDACTED)[^/\s]+\//);
    }
    // Redaction masks rather than deletes the surrounding output.
    expect(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8")).toContain("[REDACTED");
  });

  it("ASDLC-1/AC-12 test output is capped at stack.state.max_bytes and task.json stays valid JSON", async () => {
    const max = 20000;
    seedTask(`${"x".repeat(150_000)} tail-marker`);
    await writeStateSnapshot(ID, TASK, cfg({ persist: "tree", redact: true, max_bytes: max }));
    for (const name of stateFiles()) {
      expect(statBytes(join(repo, STATE_DIR, name))).toBeLessThanOrEqual(max);
    }
    const parsed = JSON.parse(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"));
    expect(parsed.log[0].note).toMatch(/truncated/i);
    expect(JSON.stringify(parsed)).not.toContain("tail-marker");
  });

  it("ASDLC-1/AC-12 defaults (no state config): snapshot written, redacted", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, cfg(undefined));
    expect(stateFiles()).toEqual(["STATE.md", "task.json"]);
    for (const name of stateFiles()) {
      const text = readFileSync(join(repo, STATE_DIR, name), "utf8");
      for (const seed of SEEDS) expect(text).not.toContain(seed);
    }
  });

  it("ASDLC-1/AC-12 default max_bytes (262144) caps output", async () => {
    seedTask(`${"z".repeat(300_000)} tail-marker`);
    await writeStateSnapshot(ID, TASK, cfg(undefined));
    for (const name of stateFiles()) {
      expect(statBytes(join(repo, STATE_DIR, name))).toBeLessThanOrEqual(262144);
    }
    const parsed = JSON.parse(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"));
    expect(parsed.log[0].note).toMatch(/truncated/i);
    expect(JSON.stringify(parsed)).not.toContain("tail-marker");
  });

  it("ASDLC-1/AC-12 multibyte output is capped by bytes, not characters", async () => {
    const max = 20000;
    seedTask(`${"é".repeat(60_000)} tail-marker`);
    await writeStateSnapshot(ID, TASK, cfg({ persist: "tree", redact: true, max_bytes: max }));
    for (const name of stateFiles()) {
      expect(statBytes(join(repo, STATE_DIR, name))).toBeLessThanOrEqual(max);
      expect(readFileSync(join(repo, STATE_DIR, name), "utf8")).not.toContain("\uFFFD");
    }
    const parsed = JSON.parse(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"));
    expect(parsed.log[0].note).toMatch(/truncated/i);
    expect(JSON.stringify(parsed)).not.toContain("tail-marker");
  });

  it("ASDLC-1/AC-12 output under the cap is not truncated", async () => {
    seedTask("short note");
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    const parsed = JSON.parse(readFileSync(join(repo, STATE_DIR, "task.json"), "utf8"));
    expect(parsed.log[0].note).toContain("short note");
    expect(parsed.log[0].note).not.toMatch(/truncated/i);
  });

  it("ASDLC-1/AC-12 redact false: no state is written", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, cfg({ persist: "tree", redact: false }));
    expect(existsSync(join(repo, STATE_DIR))).toBe(false);
    expect(existsSync(join(repo, "docs", "dev", ID, "state"))).toBe(false);
  });

  it("ASDLC-1/AC-12 persist notes or none: no tree state is written", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, cfg({ persist: "notes", redact: true }));
    await writeStateSnapshot(ID, TASK, cfg({ persist: "none", redact: true }));
    expect(existsSync(join(repo, STATE_DIR))).toBe(false);
  });
});

function statBytes(path: string): number {
  return Buffer.byteLength(readFileSync(path, "utf8"), "utf8");
}

describe("ASDLC-1/AC-12 snapshot staged with every typed commit (ASDLC-1/TC-13)", () => {
  it("ASDLC-1/AC-12 a phase commit stages STATE.md and task.json, redacted, and no raw packet", async () => {
    seedTask();
    seedSidecars();
    write(TEST_FILE, "// red\n");
    const result = await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      phasePacket(),
      TREE_CFG,
      repo,
    );
    expect(result.ok).toBe(true);
    const files = filesOf("HEAD");
    expect(files).toContain(`${STATE_DIR}/STATE.md`);
    expect(files).toContain(`${STATE_DIR}/task.json`);
    expect(files).toContain(TEST_FILE);
    const stateInCommit = files.filter((file) => file.startsWith(`docs/dev/${ID}/state/`));
    expect(stateInCommit.sort()).toEqual([`${STATE_DIR}/STATE.md`, `${STATE_DIR}/task.json`]);
    expect(files.some((file) => /T\d+-phase-test\.json$/.test(file))).toBe(false);
    expect(files.some((file) => file.startsWith(".tasks/"))).toBe(false);

    const committed = git("show", `HEAD:${STATE_DIR}/task.json`);
    const committedMd = git("show", `HEAD:${STATE_DIR}/STATE.md`);
    for (const seed of [...SEEDS, "leak"]) {
      expect(committed).not.toContain(seed);
      expect(committedMd).not.toContain(seed);
    }
    expect(files.some((file) => /T\d+-[a-z-]+\.(json|output\.txt)$/.test(file))).toBe(false);
    for (const file of git("ls-tree", "-r", "--name-only", "HEAD").trim().split("\n")) {
      const text = git("show", `HEAD:${file}`);
      expect(text).not.toContain(RAW_PACKET_MARKER);
      for (const seed of SEEDS) expect(text).not.toContain(seed);
    }
    for (const marker of MARKERS) expect(committed).not.toContain(marker);
    expect(JSON.parse(committed).control.in_flight).toBeNull();
    expect(git("status", "--porcelain", "--untracked-files=all")).not.toContain("state/");
  });

  it("ASDLC-1/AC-12 a review commit rewrites the snapshot from the live task", async () => {
    seedTask();
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(ID, TASK, "T1/phase-test", "phase-test", phasePacket(), TREE_CFG, repo);
    appendLive("T1/review-test", "review-marker-42");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/review-test",
      "review-test",
      { verdict: "clean", findings: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      TREE_CFG,
      repo,
    );
    const files = filesOf("HEAD");
    expect(files).toContain(`${STATE_DIR}/STATE.md`);
    expect(files).toContain(`${STATE_DIR}/task.json`);
    expect(
      files.some((file) => file.startsWith(`docs/dev/${ID}/reviews/task-${String(TASK)}/`)),
    ).toBe(true);
    const md = git("show", `HEAD:${STATE_DIR}/STATE.md`);
    expect(md).toContain("review-marker-42");
    expect(md).toBe(renderTaskTrace(JSON.parse(git("show", `HEAD:${STATE_DIR}/task.json`))));
  });

  it("ASDLC-1/AC-12 every typed commit (all six agents) carries a fresh snapshot", async () => {
    seedTask();
    const usage = { prompt_tokens: 1, completion_tokens: 1 };
    const review = { verdict: "clean", findings: [], usage };
    const steps: Array<[string, string, Record<string, unknown>]> = [
      ["T1/phase-test", "phase-test", phasePacket()],
      ["T1/review-test", "review-test", review],
      [
        "C1/phase-code",
        "phase-code",
        {
          status: "done",
          tests_passing: true,
          changes: [{ file: "src/foo.ts", action: "add", kind: "code", ac_ids: ["AC-12"] }],
          usage,
        },
      ],
      ["C1/review-security", "review-security", review],
      ["C1/review-code", "review-code", review],
      ["V1/phase-verify-task", "phase-verify-task", { status: "done", usage }],
    ];
    for (const [ref, agent, packet] of steps) {
      if (agent === "phase-test") write(TEST_FILE, "// red\n");
      if (agent === "phase-code") write("src/foo.ts", "export const foo = 1;\n");
      appendLive(ref, `snap-${agent}`);
      const result = await tryCommitPhase(ID, TASK, ref, agent, packet, TREE_CFG, repo);
      expect(result.ok).toBe(true);
      expect(git("log", "-1", "--format=%s")).toContain(ref);
      expect(filesOf("HEAD")).toContain(`${STATE_DIR}/STATE.md`);
      expect(filesOf("HEAD")).toContain(`${STATE_DIR}/task.json`);
      expect(git("show", `HEAD:${STATE_DIR}/STATE.md`)).toContain(`snap-${agent}`);
    }
  });

  it("ASDLC-1/AC-12 a phase-test commit stages only this task's snapshot, not other state files", async () => {
    seedTask();
    write(TEST_FILE, "// red\n");
    write(`docs/dev/${ID}/state/task-8/STATE.md`, "other");
    write(`docs/dev/${ID}/state/contract-amend.open`, "nonce");
    await tryCommitPhase(ID, TASK, "T1/phase-test", "phase-test", phasePacket(), TREE_CFG, repo);
    expect(
      filesOf("HEAD")
        .filter((file) => file.startsWith(`docs/dev/${ID}/state/`))
        .sort(),
    ).toEqual([`${STATE_DIR}/STATE.md`, `${STATE_DIR}/task.json`]);
    const status = git("status", "--porcelain", "--untracked-files=all");
    expect(status).toContain(`?? docs/dev/${ID}/state/task-8/STATE.md`);
    expect(status).toContain(`?? docs/dev/${ID}/state/contract-amend.open`);
  });

  it("ASDLC-1/AC-12 a phase-verify-task commit also carries the snapshot", async () => {
    seedTask();
    await tryCommitPhase(
      ID,
      TASK,
      "V1/phase-verify-task",
      "phase-verify-task",
      { status: "done", usage: { prompt_tokens: 1, completion_tokens: 1 } },
      TREE_CFG,
      repo,
    );
    expect(filesOf("HEAD")).toContain(`${STATE_DIR}/STATE.md`);
    expect(filesOf("HEAD")).toContain(`${STATE_DIR}/task.json`);
  });

  it("ASDLC-1/AC-12 redact false: a phase commit stages no state", async () => {
    seedTask();
    write(TEST_FILE, "// red\n");
    const result = await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      phasePacket(),
      cfg({ persist: "tree", redact: false }),
      repo,
    );
    expect(result.ok).toBe(true);
    expect(filesOf("HEAD").some((file) => file.includes("/state/"))).toBe(false);
    expect(existsSync(join(repo, "docs", "dev", ID, "state"))).toBe(false);
  });

  it("ASDLC-1/AC-12 persist none: a phase commit stages no state", async () => {
    seedTask();
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(
      ID,
      TASK,
      "T1/phase-test",
      "phase-test",
      phasePacket(),
      cfg({ persist: "none", redact: true }),
      repo,
    );
    expect(filesOf("HEAD").some((file) => file.includes("/state/"))).toBe(false);
  });

  it("ASDLC-1/AC-12 the final evidence commit leaves no state/task-<N>/", async () => {
    seedTask();
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(ID, TASK, "T1/phase-test", "phase-test", phasePacket(), TREE_CFG, repo);
    expect(git("ls-tree", "-r", "--name-only", "HEAD")).toContain(`${STATE_DIR}/STATE.md`);

    setTaskStatus("done");
    const result = await commitTaskEvidence(ID, [TASK], TREE_CFG, repo);
    expect(result.ok).toBe(true);
    expect(git("log", "-1", "--format=%s")).toContain(`evidence(task-${String(TASK)})`);

    const tree = git("ls-tree", "-r", "--name-only", "HEAD");
    expect(tree).not.toContain(`${STATE_DIR}/`);
    expect(tree).toContain(`docs/dev/${ID}/evidence/task-${String(TASK)}.json`);
    expect(existsSync(join(repo, STATE_DIR))).toBe(false);
    const added = git("show", "--name-status", "--pretty=format:", "HEAD")
      .split("\n")
      .filter((line) => line.startsWith("A") && line.includes("/state/"));
    expect(added).toEqual([]);
  });

  it("ASDLC-1/AC-12 snapshot files contain no secret assignment and no home path", async () => {
    seedTask();
    write(TEST_FILE, "// red\n");
    await tryCommitPhase(ID, TASK, "T1/phase-test", "phase-test", phasePacket(), TREE_CFG, repo);
    for (const name of ["STATE.md", "task.json"]) {
      const text = readFileSync(join(repo, STATE_DIR, name), "utf8");
      expect(text).not.toMatch(/(SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE)=(?!\[REDACTED)/);
      expect(text).not.toMatch(/\/Users\/(?!\[REDACTED)[A-Za-z0-9._-]+\//);
      expect(text).not.toMatch(/\/home\/(?!\[REDACTED)[A-Za-z0-9._-]+\//);
    }
  });
});

describe("ASDLC-1/AC-29 stack.state.snapshot emission (ASDLC-1/TC-30)", () => {
  it("ASDLC-1/AC-29 emits debug stack.state.snapshot with exact fields and counts only", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    const events = logged().filter((line) => line.includes("stack.state.snapshot"));
    expect(events).toHaveLength(1);
    const line = events[0] as string;
    expect(line).toStartWith("[accord:stack:debug] stack.state.snapshot ");
    const fields = Object.fromEntries(
      line
        .slice("[accord:stack:debug] stack.state.snapshot ".length)
        .split(" ")
        .map((pair) => pair.split("=") as [string, string]),
    );
    expect(Object.keys(fields).sort()).toEqual(
      ["bytes", "file_count", "redactions", "task", "work_item_id"].sort(),
    );
    expect(fields.work_item_id).toBe(ID);
    expect(fields.task).toBe(String(TASK));
    expect(fields.file_count).toBe("2");
    const total = stateFiles().reduce(
      (sum, name) => sum + statBytes(join(repo, STATE_DIR, name)),
      0,
    );
    expect(fields.bytes).toBe(String(total));
    const live = JSON.parse(readFileSync(LIVE_PATH, "utf8")) as Record<string, unknown>;
    expect(Number(fields.redactions)).toBe(redactTaskFile(live).redactions);
    expect(Number(fields.redactions)).toBeGreaterThanOrEqual(5);
    for (const key of ["task", "file_count", "bytes", "redactions"]) {
      expect(fields[key]).toMatch(/^\d+$/);
    }
  });

  it("ASDLC-1/AC-29 event line carries no content: no seed, path or note text", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    const line = logged().find((entry) => entry.includes("stack.state.snapshot")) as string;
    for (const seed of [...SEEDS, "FAIL at", "Authorization", "REDACTED", STATE_DIR]) {
      expect(line).not.toContain(seed);
    }
  });

  it("ASDLC-1/AC-29 is not emitted at info level (debug only)", async () => {
    setLogLevel("info");
    seedTask();
    await writeStateSnapshot(ID, TASK, TREE_CFG);
    expect(logged().some((line) => line.includes("stack.state.snapshot"))).toBe(false);
  });

  it("ASDLC-1/AC-29 is not emitted when persist is none or notes", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, cfg({ persist: "none", redact: true }));
    await writeStateSnapshot(ID, TASK, cfg({ persist: "notes", redact: true }));
    expect(logged().some((line) => line.includes("stack.state.snapshot"))).toBe(false);
  });

  it("ASDLC-1/AC-29 is not emitted when redact is false and nothing is written", async () => {
    seedTask();
    await writeStateSnapshot(ID, TASK, cfg({ persist: "tree", redact: false }));
    expect(logged().some((line) => line.includes("stack.state.snapshot"))).toBe(false);
  });
});
