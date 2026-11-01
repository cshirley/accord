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
import { parseAccordTrailer } from "../src/commit/commit-grammar.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import {
  affectedAcsFromSpecDiff,
  cancelAmend,
  closeAmend,
  openAmend,
} from "../src/contract/amend-session.js";
import {
  hashLocked,
  isAmendOpen,
  verifyContractLock,
  writeContractLock,
} from "../src/contract/lock.js";
import { contractLockToolCallBlock } from "../src/contract/lock-guard.js";
import { processSubagentToolResult } from "../src/harness/index.js";
import type { HarnessMutableState } from "../src/harness/types.js";
import { resolveDevSubcommandOrchestration } from "../src/orchestration/resolve/subcommand.js";
import { unblockTask } from "../src/queries/unblock-task.js";
import { loadPricing } from "../src/telemetry/usage.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

// ASDLC-1/AC-9, ASDLC-1/TC-9: `/dev amend-spec` session; ASDLC-1/AC-31: okf/log.md entry (enforced by
// `bun run validate:okf`, not a runtime test).
const ID = "AMS-1";
const BASE = `docs/dev/${ID}`;
const MARKER = `${BASE}/state/contract-amend.open`;
const SESSION = `.tasks/${ID}-amend.json`;
const SNAP = `.tasks/${ID}-amend`;
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
type AcShape = Record<string, unknown> & { id: string };
const specObj = (ac1: string, extra: AcShape[] = [], omit: string[] = []) => ({
  schema_version: "1.0",
  work_item_id: ID,
  title: "Spec",
  date: "2026-05-27",
  problem_statement: "Problem",
  proposed_solution: "Solution",
  scope: { in: [], out: [] },
  verification: { commands: [], test_cases: [] },
  acceptance_criteria: [
    { id: "AC-1", requirement: "MUST", type: "constraint", criterion: ac1 },
    { id: "AC-2", requirement: "MUST", type: "constraint", criterion: "two" },
    { id: "AC-3", requirement: "MUST", type: "constraint", criterion: "three" },
    ...extra,
  ].filter((ac: AcShape) => !omit.includes(ac.id)),
});
const planTask = (id: number, title: string, covers: string[]) => ({
  id,
  title,
  covers_ac: covers,
  challenge: false,
  files: [{ path: `src/t${id}.ts`, action: "add" }],
  steps: [{ tag: "impl", description: "d" }],
});
const planObj = (title2 = "t2") => ({
  schema_version: "1.0",
  work_item_id: ID,
  spec: `${BASE}/spec.json`,
  tasks: [
    planTask(1, "t1", ["AC-1"]),
    planTask(2, title2, ["AC-2"]),
    planTask(3, "t3", ["AC-1", "AC-3"]),
    planTask(4, "t4", ["AC-3"]),
  ],
});
const SPEC0 = json(specObj("AC-1 original"));
const PLAN0 = json(planObj());
const BRIEF0 = "# Brief\n";
const cfg = (stack?: Record<string, unknown>): DevHarnessConfig =>
  ({
    schema_version: "1.0",
    language: "typescript",
    test: { command: "true", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
    ...(stack ? { stack } : {}),
  }) as unknown as DevHarnessConfig;
const ON = cfg({ enabled: true });
const STALE = "stale after contract-amend";

let repo: string;
let originalCwd: string;
let nonGit: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function put(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
const exists = (rel: string) => existsSync(join(repo, rel));
const commitCount = () => Number(git("rev-list", "--count", "HEAD"));
const head = () => git("rev-parse", "HEAD");
const lockJson = () => JSON.parse(read(`${BASE}/contract.lock.json`));
const wiPhase = () => JSON.parse(read(`.tasks/${ID}.json`)).phase as string;
const amendCommits = () =>
  git("log", "--format=%H")
    .split("\n")
    .filter((sha) => parseAccordTrailer(git("log", "-1", "--format=%B", sha))?.outcome === "amend");
const taskStatus = (id: number) => readTaskFixture(ID, id, repo).control.status;

function seedWorkItem(): void {
  put(
    `.tasks/${ID}.json`,
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1, 2, 3, 4],
      brief: `${BASE}/brief.md`,
      spec: `${BASE}/spec.json`,
      plan: `${BASE}/plan.json`,
      verify: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  const covers: Record<number, string[]> = {
    1: ["AC-1"],
    2: ["AC-2"],
    3: ["AC-1", "AC-3"],
    4: ["AC-3"],
  };
  for (const id of [1, 2, 3, 4]) {
    writeTaskFixture(
      {
        workItemId: ID,
        taskId: id,
        phase: "phase-code",
        status: id === 3 ? "in_progress" : "pending",
        coversAc: covers[id],
      },
      repo,
    );
  }
}

async function lockRepo(): Promise<void> {
  git("add", ".");
  git("commit", "-q", "-m", "contract inputs");
  await writeContractLock(ID, repo);
  git("add", ".");
  git("commit", "-q", "-m", "lock");
  git("tag", `accord/${ID}/contract`);
}

beforeEach(() => {
  originalCwd = process.cwd();
  nonGit = realpathSync(mkdtempSync(join(tmpdir(), "amend-session-nogit-")));
  repo = realpathSync(mkdtempSync(join(tmpdir(), "amend-session-")));
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  put(".gitignore", ".tasks/\n");
  put(`${BASE}/brief.md`, BRIEF0);
  put(`${BASE}/spec.json`, SPEC0);
  put(`${BASE}/plan.json`, PLAN0);
  put(`${BASE}/state/work-item.json`, "{}\n");
  seedWorkItem();
  process.chdir(repo);
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
  rmSync(nonGit, { recursive: true, force: true });
});

function amend(args: string, config: DevHarnessConfig | null = ON) {
  return resolveDevSubcommandOrchestration("amend-spec", ID, `${ID} ${args}`, config);
}

async function agentResult(agent: string, packet: Record<string, unknown>): Promise<string> {
  const state: HarnessMutableState = {
    devConfig: ON,
    costCache: new Map(),
    sessionCost: 0,
    activeWorkItem: null,
  };
  const out = await processSubagentToolResult({
    details: {
      results: [
        {
          agent,
          task: `${ID} amend run`,
          exitCode: 0,
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
  expect(out).not.toContain("validation failed");
  return out;
}
const USAGE = { prompt_tokens: 1, completion_tokens: 1 };
const specDone = () =>
  agentResult("phase-spec", { status: "done", spec_path: `${BASE}/spec.json`, usage: USAGE });
const planDone = () =>
  agentResult("phase-plan", { status: "done", plan_path: `${BASE}/plan.json`, usage: USAGE });
const stuck = (agent: string) =>
  agentResult(agent, {
    status: "stuck",
    question: "which AC?",
    context: "amend",
    ...(agent === "phase-code" ? { tests_passing: false } : {}),
    usage: USAGE,
  });
const needsInput = (agent: string) =>
  agentResult(agent, {
    status: "needs_input",
    draft: {},
    questions: [
      agent === "phase-plan"
        ? { id: "q_1", stage: "task_decomposition", text: "Which AC changes?" }
        : { id: "q_1", topic: "scope", text: "Which AC changes?" },
    ],
    usage: USAGE,
  });

describe("ASDLC-1/AC-9 openAmend / closeAmend / cancelAmend", () => {
  it("ASDLC-1/AC-9 openAmend snapshots locked spec+plan, writes nonce marker and session", async () => {
    await lockRepo();
    const result = openAmend(ID, { reason: "clarify AC-1", replan: true }, repo);
    expect(result.ok).toBe(true);
    const nonce = (result as { nonce: string }).nonce;
    expect(nonce).toMatch(/^\S+$/);
    expect(nonce.length).toBeGreaterThanOrEqual(16);
    expect(nonce).not.toContain(ID);
    expect(read(`${SNAP}/spec.json`)).toBe(SPEC0);
    expect(read(`${SNAP}/plan.json`)).toBe(PLAN0);
    expect(read(MARKER)).toBe(nonce);
    expect(JSON.parse(read(SESSION))).toEqual({ nonce, reason: "clarify AC-1", replan: true });
    expect(isAmendOpen(ID, repo)).toBe(true);
  });

  it("ASDLC-1/AC-9 successive opens give different nonces (>=16 chars, not derived from the work item id)", async () => {
    await lockRepo();
    const a = openAmend(ID, { reason: "r", replan: false }, repo);
    cancelAmend(ID, repo);
    const b = openAmend(ID, { reason: "r", replan: false }, repo);
    if (!a.ok || !b.ok) throw new Error("openAmend refused");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.nonce).not.toContain(ID);
    expect(a.nonce.length).toBeGreaterThanOrEqual(16);
    expect(b.nonce.length).toBeGreaterThanOrEqual(16);
  });

  it("ASDLC-1/AC-9 snapshot is the locked spec even when the working copy was tampered before openAmend", async () => {
    await lockRepo();
    put(`${BASE}/spec.json`, json(specObj("tampered")));
    const result = openAmend(ID, { reason: "r", replan: false }, repo);
    // Either refusing (lock mismatch) or snapshotting the trusted locked version is acceptable.
    if (result.ok) expect(read(`${SNAP}/spec.json`)).toBe(SPEC0);
    else expect(exists(`${SNAP}/spec.json`)).toBe(false);
  });

  it("ASDLC-1/AC-9 replan false is recorded as false", async () => {
    await lockRepo();
    openAmend(ID, { reason: "r", replan: false }, repo);
    expect(JSON.parse(read(SESSION)).replan).toBe(false);
  });

  for (const reason of ["", "   ", "\n\t"]) {
    it(`ASDLC-1/AC-9 openAmend refuses blank reason ${JSON.stringify(reason)} before writing the marker`, async () => {
      await lockRepo();
      const result = openAmend(ID, { reason, replan: false }, repo);
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toMatch(/reason/i);
      expect(exists(MARKER)).toBe(false);
      expect(exists(SESSION)).toBe(false);
      expect(exists(SNAP)).toBe(false);
    });
  }

  it("ASDLC-1/AC-9 closeAmend clears marker and snapshot; amend no longer open", async () => {
    await lockRepo();
    openAmend(ID, { reason: "r", replan: true }, repo);
    closeAmend(ID, repo);
    expect(exists(MARKER)).toBe(false);
    expect(exists(SNAP)).toBe(false);
    expect(exists(SESSION)).toBe(false);
    expect(isAmendOpen(ID, repo)).toBe(false);
  });

  it("ASDLC-1/AC-9 cancelAmend clears marker and snapshot, makes no commit", async () => {
    await lockRepo();
    const before = head();
    openAmend(ID, { reason: "r", replan: false }, repo);
    cancelAmend(ID, repo);
    expect(exists(MARKER)).toBe(false);
    expect(exists(SNAP)).toBe(false);
    expect(exists(SESSION)).toBe(false);
    expect(isAmendOpen(ID, repo)).toBe(false);
    expect(head()).toBe(before);
  });

  it("ASDLC-1/AC-9 closeAmend and cancelAmend without an open amend do not throw", async () => {
    await lockRepo();
    expect(() => closeAmend(ID, repo)).not.toThrow();
    expect(() => cancelAmend(ID, repo)).not.toThrow();
    expect(isAmendOpen(ID, repo)).toBe(false);
  });
});

describe("ASDLC-1/AC-9 affectedAcsFromSpecDiff", () => {
  async function diffBetween(oldSpec: unknown, newSpec: unknown): Promise<string[]> {
    put(`${BASE}/spec.json`, json(oldSpec));
    await lockRepo();
    openAmend(ID, { reason: "r", replan: false }, repo);
    put(`${BASE}/spec.json`, json(newSpec));
    return affectedAcsFromSpecDiff(ID, repo).sort();
  }
  const diffWith = (newSpec: unknown) => diffBetween(specObj("AC-1 original"), newSpec);
  const withAc = (
    spec: ReturnType<typeof specObj>,
    index: number,
    patch: Record<string, unknown>,
  ) => {
    spec.acceptance_criteria[index] = { ...spec.acceptance_criteria[index], ...patch } as AcShape;
    return spec;
  };
  const scenarioAc = (text: string): AcShape => ({
    id: "AC-5",
    requirement: "MUST",
    type: "scenario",
    scenario: text,
  });
  it.each([
    [
      "requirement MUST->SHOULD",
      specObj("AC-1 original"),
      withAc(specObj("AC-1 original"), 1, { requirement: "SHOULD" }),
      ["AC-2"],
    ],
    [
      "type constraint->property",
      specObj("AC-1 original"),
      withAc(specObj("AC-1 original"), 2, { type: "property" }),
      ["AC-3"],
    ],
    [
      "scenario text change",
      specObj("AC-1 original", [scenarioAc("Given A")]),
      specObj("AC-1 original", [scenarioAc("Given B")]),
      ["AC-5"],
    ],
    [
      "array reversed, contents identical",
      specObj("AC-1 original"),
      (() => {
        const reversed = specObj("AC-1 original");
        reversed.acceptance_criteria.reverse();
        return reversed;
      })(),
      [],
    ],
  ] as const)("ASDLC-1/AC-9 diff %s", async (_label, oldSpec, newSpec, expected) => {
    expect(await diffBetween(oldSpec, newSpec)).toEqual([...expected]);
  });
  it("ASDLC-1/AC-9 changed AC only", async () => {
    expect(await diffWith(specObj("AC-1 reworded"))).toEqual(["AC-1"]);
  });
  it("ASDLC-1/AC-9 added AC is affected", async () => {
    const added = { id: "AC-4", requirement: "MUST", type: "constraint", criterion: "four" };
    expect(await diffWith(specObj("AC-1 original", [added]))).toEqual(["AC-4"]);
  });
  it("ASDLC-1/AC-9 removed AC is affected", async () => {
    expect(await diffWith(specObj("AC-1 original", [], ["AC-2"]))).toEqual(["AC-2"]);
  });
  it("ASDLC-1/AC-9 identical spec and key-reordered spec yield no affected ACs", async () => {
    expect(await diffWith(specObj("AC-1 original"))).toEqual([]);
    const base = specObj("AC-1 original");
    const reordered = {
      ...base,
      acceptance_criteria: base.acceptance_criteria.map((ac) => ({
        criterion: ac.criterion,
        type: ac.type,
        requirement: ac.requirement,
        id: ac.id,
      })),
    };
    put(`${BASE}/spec.json`, json(reordered));
    expect(affectedAcsFromSpecDiff(ID, repo)).toEqual([]);
  });
  it("ASDLC-1/AC-9 several changes are all reported", async () => {
    const spec = specObj("AC-1 reworded");
    spec.acceptance_criteria[2] = {
      ...(spec.acceptance_criteria[2] as AcShape),
      criterion: "three!",
    } as AcShape;
    expect(await diffWith(spec)).toEqual(["AC-1", "AC-3"]);
  });
});

describe("ASDLC-1/AC-9 /dev amend-spec routing", () => {
  it("ASDLC-1/AC-9 with lock + stack.enabled opens the amend and spawns phase-spec", async () => {
    await lockRepo();
    const resolution = amend("clarify the wording");
    expect(resolution.outcome).toBe("spawn");
    if (resolution.outcome !== "spawn") return;
    expect(resolution.agent).toBe("phase-spec");
    expect(resolution.task).toContain("clarify the wording");
    const session = JSON.parse(read(SESSION));
    expect(session.reason).toBe("clarify the wording");
    expect(session.replan).toBe(false);
    expect(read(MARKER)).toBe(session.nonce);
    expect(read(`${SNAP}/spec.json`)).toBe(SPEC0);
    expect(read(`${SNAP}/plan.json`)).toBe(PLAN0);
    expect(isAmendOpen(ID, repo)).toBe(true);
  });

  it("ASDLC-1/AC-9 --replan flag is parsed and excluded from the reason (any position)", async () => {
    await lockRepo();
    amend("clarify the wording --replan");
    let session = JSON.parse(read(SESSION));
    expect(session.reason).toBe("clarify the wording");
    expect(session.replan).toBe(true);
    cancelAmend(ID, repo);
    amend("--replan tighten scope");
    session = JSON.parse(read(SESSION));
    expect(session.reason).toBe("tighten scope");
    expect(session.replan).toBe(true);
  });

  for (const args of ["", "   ", "--replan"]) {
    it(`ASDLC-1/AC-9 no reason (${JSON.stringify(args)}) is refused before the marker is written`, async () => {
      await lockRepo();
      const before = head();
      const resolution = amend(args);
      expect(resolution.outcome).toBe("blocked");
      expect(JSON.stringify(resolution.messages)).toMatch(/reason/i);
      expect(exists(MARKER)).toBe(false);
      expect(exists(SESSION)).toBe(false);
      expect(exists(SNAP)).toBe(false);
      expect(head()).toBe(before);
    });
  }

  it("ASDLC-1/AC-9 --cancel closes an open amend without a commit", async () => {
    await lockRepo();
    const before = head();
    amend("some reason");
    expect(isAmendOpen(ID, repo)).toBe(true);
    const res = amend("--cancel");
    expect(res.outcome).not.toBe("spawn");
    expect(JSON.stringify(res)).toMatch(/cancel/i);
    expect(isAmendOpen(ID, repo)).toBe(false);
    expect(exists(MARKER)).toBe(false);
    expect(exists(SNAP)).toBe(false);
    expect(head()).toBe(before);
  });

  it("ASDLC-1/AC-9 --cancel with no open amend is not a spawn and writes nothing", async () => {
    await lockRepo();
    const res = amend("--cancel");
    expect(res.outcome).not.toBe("spawn");
    expect(exists(MARKER)).toBe(false);
    expect(exists(SESSION)).toBe(false);
    expect(exists(SNAP)).toBe(false);
  });

  it("ASDLC-1/AC-9 a second amend-spec while open keeps the original snapshot", async () => {
    await lockRepo();
    amend("first");
    put(`${BASE}/spec.json`, json(specObj("AC-1 partial")));
    amend("second");
    expect(read(`${SNAP}/spec.json`)).toBe(SPEC0);
    expect(isAmendOpen(ID, repo)).toBe(true);
  });

  it("ASDLC-1/AC-9 ASDLC-1/AC-26 without a lock file amend-spec behaves as today (no marker, session, snapshot)", () => {
    const resolution = amend("some reason");
    expect(resolution.outcome).toBe("spawn");
    if (resolution.outcome === "spawn") expect(resolution.agent).toBe("phase-spec");
    expect(exists(MARKER)).toBe(false);
    expect(exists(SESSION)).toBe(false);
    expect(exists(SNAP)).toBe(false);
  });

  for (const [label, config] of [
    ["stack absent", cfg()],
    ["stack.enabled false", cfg({ enabled: false })],
    ["no config", null],
  ] as const) {
    it(`ASDLC-1/AC-9 ASDLC-1/AC-26 lock present but ${label}: amend-spec behaves as today`, async () => {
      await lockRepo();
      const resolution = amend("some reason", config);
      if (config) {
        expect(resolution.outcome).toBe("spawn");
        if (resolution.outcome === "spawn") expect(resolution.agent).toBe("phase-spec");
      }
      expect(exists(MARKER)).toBe(false);
      expect(exists(SESSION)).toBe(false);
      expect(exists(SNAP)).toBe(false);
    });
  }
});

describe("ASDLC-1/AC-9 amend completion via processSubagentToolResult", () => {
  const amendedSpec = () => json(specObj("AC-1 amended wording"));

  it("ASDLC-1/AC-9 no --replan: phase-spec done → one amend commit, lock rewritten, marker cleared, phase-plan not spawned", async () => {
    await lockRepo();
    const lockedHash = hashLocked(`${BASE}/spec.json`, repo);
    amend("clarify AC wording");
    put(`${BASE}/spec.json`, amendedSpec());
    const before = commitCount();
    await specDone();

    expect(commitCount()).toBe(before + 1);
    const trailer = parseAccordTrailer(git("log", "-1", "--format=%B"));
    expect(trailer?.outcome).toBe("amend");
    expect(trailer?.id).toBe(ID);
    expect(trailer?.ac).toEqual(["AC-1"]);
    expect(git("log", "-1", "--format=%s")).toContain("clarify AC wording");
    const amendments = lockJson().amendments;
    expect(amendments).toHaveLength(1);
    expect(amendments[0].reason).toBe("clarify AC wording");
    expect(amendments[0].affected_acs).toEqual(["AC-1"]);
    expect(amendments[0].stale_task_ids).toEqual([1, 3]);
    expect(amendments[0].diff).toContain("AC-1 amended wording");
    expect(lockedHash).not.toBe(hashLocked(`${BASE}/spec.json`, repo));
    expect(lockJson().files[`${BASE}/spec.json`]).toBe(hashLocked(`${BASE}/spec.json`, repo));
    expect(await verifyContractLock(ID, repo)).toEqual({ unchanged: true, changed: [] });
    expect(`${git("show", `HEAD:${BASE}/spec.json`)}\n`).toBe(amendedSpec());
    const touched = git("show", "--name-only", "--pretty=format:", "HEAD");
    expect(touched).toContain(`${BASE}/spec.json`);
    expect(touched).toContain(`${BASE}/contract.lock.json`);
    expect(touched).not.toContain(`${BASE}/state/contract-amend.open`);
    expect(exists(MARKER)).toBe(false);
    expect(isAmendOpen(ID, repo)).toBe(false);
    expect(exists(SNAP)).toBe(false);
    expect(wiPhase()).toBe("implementing");
  });

  it("ASDLC-1/AC-9 --replan: amend stays open after phase-spec done, closes with one commit after phase-plan done", async () => {
    await lockRepo();
    amend("rework plan --replan");
    put(`${BASE}/spec.json`, amendedSpec());
    const before = commitCount();
    await specDone();
    expect(wiPhase()).toBe("planning");
    expect(commitCount()).toBe(before);
    expect(isAmendOpen(ID, repo)).toBe(true);
    expect(exists(SNAP)).toBe(true);
    expect(read(`${BASE}/spec.json`)).toBe(amendedSpec());

    put(`${BASE}/plan.json`, json(planObj("t2 replanned")));
    await planDone();
    expect(commitCount()).toBe(before + 1);
    expect(parseAccordTrailer(git("log", "-1", "--format=%B"))?.outcome).toBe("amend");
    expect(git("show", "--name-only", "--pretty=format:", "HEAD")).toContain(`${BASE}/plan.json`);
    expect(read(`${BASE}/plan.json`)).toBe(json(planObj("t2 replanned")));
    expect(isAmendOpen(ID, repo)).toBe(false);
    expect(exists(MARKER)).toBe(false);
    expect(exists(SNAP)).toBe(false);
    expect(lockJson().amendments[0].reason).toBe("rework plan");
    expect(parseAccordTrailer(git("log", "-1", "--format=%B"))?.ac).toEqual(["AC-1"]);
    expect(lockJson().amendments[0].affected_acs).toEqual(["AC-1"]);
    expect(lockJson().amendments[0].stale_task_ids).toEqual([1, 3]);
    expect(taskStatus(1)).toBe("blocked");
    expect(taskStatus(3)).toBe("blocked");
    expect(taskStatus(2)).toBe("pending");
    expect(git("show", "--name-only", "--pretty=format:", "HEAD")).toContain(`${BASE}/spec.json`);
    expect(read(`${BASE}/spec.json`)).toBe(amendedSpec());
    expect(wiPhase()).toBe("implementing");
  });

  it("ASDLC-1/AC-9 the lock guard keeps amended locked writes while open, and PR0 is not rebuilt (no tag move, no extra commit)", async () => {
    await lockRepo();
    const tagBefore = git("rev-parse", `accord/${ID}/contract`);
    const specWrite = { path: `${BASE}/spec.json` };
    expect(contractLockToolCallBlock("write", specWrite, repo)).not.toBeNull();
    amend("r");
    expect(contractLockToolCallBlock("write", specWrite, repo)).toBeNull();
    expect(contractLockToolCallBlock("write", { path: MARKER }, repo)).not.toBeNull();
    put(`${BASE}/spec.json`, amendedSpec());
    await specDone();
    expect(contractLockToolCallBlock("write", specWrite, repo)).not.toBeNull();
    expect(git("rev-parse", `accord/${ID}/contract`)).toBe(tagBefore);
    expect(amendCommits()).toHaveLength(1);
  });

  it("ASDLC-1/AC-9 stale tasks (covered ACs changed) are blocked 'stale after contract-amend'; others untouched", async () => {
    await lockRepo();
    amend("clarify");
    put(`${BASE}/spec.json`, amendedSpec());
    await specDone();
    for (const id of [1, 3]) {
      const task = readTaskFixture(ID, id, repo);
      expect(task.control.status).toBe("blocked");
      expect(task.control.blocked?.reason).toContain(STALE);
    }
    expect(taskStatus(2)).toBe("pending");
    expect(taskStatus(4)).toBe("pending");
    expect(readTaskFixture(ID, 2, repo).control.blocked).toBeNull();
    // no new task-schema field: control keys unchanged
    expect(Object.keys(readTaskFixture(ID, 1, repo).control).sort()).toEqual(
      Object.keys(readTaskFixture(ID, 2, repo).control).sort(),
    );
  });

  it("ASDLC-1/AC-9 stale tasks resume only after /dev unblock", async () => {
    await lockRepo();
    amend("clarify");
    put(`${BASE}/spec.json`, amendedSpec());
    await specDone();
    expect(taskStatus(1)).toBe("blocked");
    const result = unblockTask(ID, 1, { force: "contract amended; replanned" });
    expect(result.ok).toBe(true);
    expect(taskStatus(1)).toBe("pending");
    expect(taskStatus(3)).toBe("blocked");
  });

  for (const [agent, replanArg] of [
    ["phase-spec", ""],
    ["phase-spec", " --replan"],
    ["phase-plan", " --replan"],
  ] as const) {
    it(`ASDLC-1/AC-9 stuck in ${agent}${replanArg} clears marker and snapshot, no commit, no stale tasks`, async () => {
      await lockRepo();
      amend(`reason${replanArg}`);
      expect(isAmendOpen(ID, repo)).toBe(true);
      const before = commitCount();
      await stuck(agent);
      expect(exists(MARKER)).toBe(false);
      expect(exists(SNAP)).toBe(false);
      expect(isAmendOpen(ID, repo)).toBe(false);
      expect(commitCount()).toBe(before);
      expect(taskStatus(1)).toBe("pending");
      expect(taskStatus(3)).toBe("in_progress");
      expect(exists(SESSION)).toBe(false);
      // a later phase-spec done must not commit an amend from leftover state
      put(`${BASE}/spec.json`, amendedSpec());
      const after = commitCount();
      await specDone();
      expect(commitCount()).toBe(after);
      expect(amendCommits()).toHaveLength(0);
    });
  }

  it("ASDLC-1/AC-9 stuck from an agent outside the amend (phase-code) leaves the amend open", async () => {
    await lockRepo();
    amend("r");
    const before = commitCount();
    await stuck("phase-code");
    expect(isAmendOpen(ID, repo)).toBe(true);
    expect(exists(SNAP)).toBe(true);
    expect(commitCount()).toBe(before);
    put(`${BASE}/spec.json`, amendedSpec());
    await specDone();
    expect(commitCount()).toBe(before + 1);
    expect(amendCommits()).toHaveLength(1);
  });

  for (const agent of ["phase-spec", "phase-plan"]) {
    it(`ASDLC-1/AC-9 needs_input in ${agent} keeps the amend open (marker, snapshot, no commit)`, async () => {
      await lockRepo();
      amend("reason --replan");
      const before = commitCount();
      await needsInput(agent);
      expect(isAmendOpen(ID, repo)).toBe(true);
      expect(exists(SNAP)).toBe(true);
      expect(commitCount()).toBe(before);
      expect(taskStatus(1)).toBe("pending");
    });
  }

  it("ASDLC-1/AC-9 needs_input then done still completes with exactly one amend commit", async () => {
    await lockRepo();
    amend("reason");
    const before = commitCount();
    await needsInput("phase-spec");
    put(`${BASE}/spec.json`, amendedSpec());
    await specDone();
    expect(commitCount()).toBe(before + 1);
    expect(isAmendOpen(ID, repo)).toBe(false);
  });

  it("ASDLC-1/AC-9 needs_input then --cancel closes the amend", async () => {
    await lockRepo();
    amend("reason");
    await needsInput("phase-spec");
    expect(isAmendOpen(ID, repo)).toBe(true);
    const res = amend("--cancel");
    expect(res.outcome).not.toBe("spawn");
    expect(isAmendOpen(ID, repo)).toBe(false);
    expect(exists(SNAP)).toBe(false);
    expect(exists(SESSION)).toBe(false);
    put(`${BASE}/spec.json`, amendedSpec());
    const after = commitCount();
    await specDone();
    expect(commitCount()).toBe(after);
    expect(amendCommits()).toHaveLength(0);
  });

  it("ASDLC-1/AC-9 a phase-spec done with no amend open commits no amend", async () => {
    await lockRepo();
    const before = commitCount();
    put(`${BASE}/spec.json`, amendedSpec());
    await specDone();
    expect(commitCount()).toBe(before);
    expect(amendCommits()).toHaveLength(0);
  });
});
