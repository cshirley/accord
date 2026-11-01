import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { validateArtifact, validateReturn } from "../src/artifacts/validation.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { verifyContractLock } from "../src/contract/lock.js";
import { buildContractPr0, registerPreLockHook } from "../src/contract/pr0.js";
import { processSubagentToolResult } from "../src/harness/index.js";
import type { HarnessMutableState } from "../src/harness/types.js";
import { loadPricing } from "../src/telemetry/usage.js";

const ID = "TESTLOCK-1";
const TAG = `accord/${ID}/contract`;
const BASE = `docs/dev/${ID}`;
const BRIEF = "# Brief\nhello\n";
const SPEC = `${JSON.stringify({ id: "spec", acceptance_criteria: [{ id: "AC-1", text: "a" }] }, null, 2)}\n`;
const PLAN = `${JSON.stringify(
  {
    schema_version: "1.0",
    work_item_id: ID,
    spec: `docs/dev/${ID}/spec.json`,
    tasks: [
      {
        id: 1,
        title: "t1",
        covers_ac: ["AC-1"],
        challenge: false,
        files: [{ path: "src/a.ts", action: "add" }],
        steps: [{ tag: "impl", description: "d" }],
      },
    ],
  },
  null,
  2,
)}\n`;
const TOKEN = `ghp_${"a".repeat(36)}`;
const HOME_PATH = "/Users/alice/x";
const PR0_FILES = [
  `${BASE}/brief.md`,
  `${BASE}/contract.lock.json`,
  `${BASE}/plan.json`,
  `${BASE}/spec.json`,
  `${BASE}/state/work-item.json`,
];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

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
const ON = cfg({ enabled: true, contract: { lock: true, tag: true } });

let repo: string;
let originalCwd: string;
let nonGit: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}
function seed(pattern = "implement", title = "t"): void {
  write(`${BASE}/brief.md`, BRIEF);
  write(`${BASE}/spec.json`, SPEC);
  write(`${BASE}/plan.json`, PLAN);
  write(
    `.tasks/${ID}.json`,
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title,
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern,
      phase: "planning",
      task_ids: [1],
      spec: `${BASE}/spec.json`,
      plan: `${BASE}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
}
function commitCount(): number {
  return Number(git("rev-list", "--count", "HEAD"));
}
function filesOf(rev: string): string[] {
  return git("show", "--name-only", "--pretty=format:", rev).split("\n").filter(Boolean).sort();
}
function tagExists(): boolean {
  return git("tag", "-l", TAG) === TAG;
}
function openAmend(): void {
  write(`.tasks/${ID}-amend.json`, JSON.stringify({ nonce: "n0nce1" }));
  write(`${BASE}/state/contract-amend.open`, "n0nce1");
}
/** Surfaced error: either a rejection or `ok: false`; never `ok: true` and never swallowed. */
async function surfaced(
  fn: () => Promise<{ ok: boolean; reason?: string }>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await fn();
    return { ok: result.ok, message: result.reason ?? "" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

beforeEach(() => {
  originalCwd = process.cwd();
  // unit tests run from a NON-git dir so process.cwd()-based git calls fail loudly
  nonGit = realpathSync(mkdtempSync(join(tmpdir(), "contract-pr0-nogit-")));
  process.chdir(nonGit);
  repo = realpathSync(mkdtempSync(join(tmpdir(), "contract-pr0-")));
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("README.md", "# r\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
  rmSync(nonGit, { recursive: true, force: true });
});

describe("ASDLC-1/AC-9 PR0 contract commit and tag", () => {
  it("ASDLC-1/AC-9 builds one commit with exactly brief, spec, plan, state/work-item.json and contract.lock.json", async () => {
    seed();
    const before = git("rev-parse", "HEAD");
    const result = await buildContractPr0(ID, ON, repo);
    expect(result.ok).toBe(true);
    expect(commitCount()).toBe(2);
    expect(git("rev-parse", "HEAD~1")).toBe(before);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("ASDLC-1/AC-9 lock holds sha256 of brief/spec/plan (not work-item.json) and the preceding commit sha", async () => {
    seed();
    const before = git("rev-parse", "HEAD");
    await buildContractPr0(ID, ON, repo);
    const lock = JSON.parse(readFileSync(join(repo, BASE, "contract.lock.json"), "utf8"));
    expect(lock.preceding_commit).toBe(before);
    expect(Object.keys(lock.files).sort()).toEqual([
      `${BASE}/brief.md`,
      `${BASE}/plan.json`,
      `${BASE}/spec.json`,
    ]);
    expect(lock.files[`${BASE}/brief.md`]).toBe(sha(BRIEF));
    expect(lock.files[`${BASE}/spec.json`]).toBe(sha(SPEC));
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
    // the committed lock equals the lock on disk
    expect(git("show", `HEAD:${BASE}/contract.lock.json`)).toBe(
      readFileSync(join(repo, BASE, "contract.lock.json"), "utf8").trim(),
    );
  });

  it("ASDLC-1/AC-9 tags the lock commit accord/<ID>/contract pointing at HEAD (the lock commit)", async () => {
    seed();
    const result = await buildContractPr0(ID, ON, repo);
    expect(tagExists()).toBe(true);
    expect(git("rev-parse", `${TAG}^{commit}`)).toBe(git("rev-parse", "HEAD"));
    expect(result.tag).toBe(TAG);
    expect(result.hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(git("rev-parse", result.hash as string)).toBe(git("rev-parse", "HEAD"));
  });

  it("ASDLC-1/AC-9 state/work-item.json is derived from .tasks/<ID>.json (id, pattern)", async () => {
    seed();
    await buildContractPr0(ID, ON, repo);
    const snapshot = JSON.parse(git("show", `HEAD:${BASE}/state/work-item.json`));
    expect(snapshot.id).toBe(ID);
    expect(snapshot.pattern).toBe("implement");
  });

  it("ASDLC-1/AC-9 committed state/work-item.json is redacted (token and home path)", async () => {
    seed("implement", `leak ${TOKEN} at ${HOME_PATH}/y`);
    await buildContractPr0(ID, ON, repo);
    const committed = git("show", `HEAD:${BASE}/state/work-item.json`);
    expect(committed).toContain("[REDACTED");
    expect(committed).not.toContain(TOKEN);
    expect(committed).not.toContain(HOME_PATH);
    expect(readFileSync(join(repo, BASE, "state", "work-item.json"), "utf8")).not.toContain(TOKEN);
  });

  it("ASDLC-1/AC-9 unrelated untracked, modified and pre-staged files never enter the PR0 commit", async () => {
    seed();
    write("src/unrelated.ts", "export const u = 1;\n");
    write("README.md", "dirty\n");
    write("src/staged.ts", "export const s = 1;\n");
    git("add", "src/staged.ts");
    await buildContractPr0(ID, ON, repo);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
  });

  it("ASDLC-1/AC-9 greenfield work item also gets PR0", async () => {
    seed("greenfield");
    const result = await buildContractPr0(ID, ON, repo);
    expect(result.ok).toBe(true);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(true);
  });

  it("ASDLC-1/AC-9 lock already present: no second lock commit, no new tag", async () => {
    seed();
    await buildContractPr0(ID, ON, repo);
    const head = git("rev-parse", "HEAD");
    const count = commitCount();
    const second = await buildContractPr0(ID, ON, repo);
    expect(second.skipped).toBe(true);
    expect(commitCount()).toBe(count);
    expect(git("rev-parse", "HEAD")).toBe(head);
  });

  it("ASDLC-1/AC-9 amend open: plan post-result writes no lock, no commit, no tag", async () => {
    seed();
    openAmend();
    const head = git("rev-parse", "HEAD");
    const result = await buildContractPr0(ID, ON, repo);
    expect(result.skipped).toBe(true);
    expect(existsSync(join(repo, BASE, "contract.lock.json"))).toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(tagExists()).toBe(false);
  });

  it("ASDLC-1/AC-9 an amend session without a matching marker is not open: PR0 is built", async () => {
    seed();
    write(`.tasks/${ID}-amend.json`, JSON.stringify({ nonce: "n0nce1" }));
    write(`${BASE}/state/contract-amend.open`, "different");
    const result = await buildContractPr0(ID, ON, repo);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(tagExists()).toBe(true);
  });
});

describe("ASDLC-1/AC-9 contract.lock / contract.tag config (defaults true)", () => {
  it("ASDLC-1/AC-9 {enabled:true} alone builds PR0 and tags (defaults)", async () => {
    seed();
    const result = await buildContractPr0(ID, cfg({ enabled: true }), repo);
    expect(result.ok).toBe(true);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(true);
  });
  it("ASDLC-1/AC-9 {contract:{tag:true}} builds PR0 (lock defaults true)", async () => {
    seed();
    const result = await buildContractPr0(
      ID,
      cfg({ enabled: true, contract: { tag: true } }),
      repo,
    );
    expect(result.ok).toBe(true);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
  });
  it("ASDLC-1/AC-9 {contract:{lock:false}} skips: no commit, lock or tag", async () => {
    seed();
    const head = git("rev-parse", "HEAD");
    const result = await buildContractPr0(
      ID,
      cfg({ enabled: true, contract: { lock: false } }),
      repo,
    );
    expect(result.skipped).toBe(true);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(existsSync(join(repo, BASE, "contract.lock.json"))).toBe(false);
    expect(tagExists()).toBe(false);
  });
  it("ASDLC-1/AC-9 {contract:{lock:true, tag:false}} commits PR0 without a tag", async () => {
    seed();
    const result = await buildContractPr0(
      ID,
      cfg({ enabled: true, contract: { lock: true, tag: false } }),
      repo,
    );
    expect(result.ok).toBe(true);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(false);
    expect(result.tag).toBeUndefined();
  });
});

describe("ASDLC-1/AC-26 no PR0 outside implement/greenfield with stack enabled", () => {
  const cases: Array<[string, string, DevHarnessConfig | null]> = [
    ["quick_fix", "quick_fix", ON],
    [
      "stack.enabled false",
      "implement",
      cfg({ enabled: false, contract: { lock: true, tag: true } }),
    ],
    ["stack unset", "implement", cfg()],
    ["null config", "implement", null],
  ];
  for (const [name, pattern, config] of cases) {
    it(`ASDLC-1/AC-26 ${name}: no commit, lock or tag`, async () => {
      seed(pattern);
      const head = git("rev-parse", "HEAD");
      const result = await buildContractPr0(ID, config, repo);
      expect(result.skipped).toBe(true);
      expect(result.ok).toBe(true);
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(existsSync(join(repo, BASE, "contract.lock.json"))).toBe(false);
      expect(tagExists()).toBe(false);
    });
  }
});

describe("ASDLC-1/AC-27 PR0 is append-only", () => {
  it("ASDLC-1/AC-27 existing tag is left as is (not forced) and PR0 still commits", async () => {
    seed();
    const initial = git("rev-parse", "HEAD");
    git("tag", TAG, initial);
    const result = await buildContractPr0(ID, ON, repo);
    expect(result.ok).toBe(true);
    expect(commitCount()).toBe(2);
    expect(git("rev-parse", `${TAG}^{commit}`)).toBe(initial);
    expect(git("rev-parse", "HEAD")).not.toBe(initial);
  });

  it("ASDLC-1/AC-27 history only grows: prior commit hashes unchanged", async () => {
    seed();
    const initial = git("rev-parse", "HEAD");
    await buildContractPr0(ID, ON, repo);
    expect(git("rev-list", "--reverse", "HEAD").split("\n")[0]).toBe(initial);
    expect(git("merge-base", "--is-ancestor", initial, "HEAD") === "").toBe(true);
    expect(git("reflog", "-n", "5", "--format=%gs")).not.toMatch(/^commit \(amend\)/m);
  });
});

describe("ASDLC-1/AC-9 commit and tag errors are surfaced", () => {
  it("ASDLC-1/AC-9 a failing commit (pre-commit hook) is reported, no tag is created", async () => {
    seed();
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho blocked-by-hook >&2\nexit 1\n", { mode: 0o755 });
    const count = commitCount();
    const outcome = await surfaced(() => buildContractPr0(ID, ON, repo));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/blocked-by-hook|hook|commit/i);
    expect(outcome.message).not.toMatch(/not implemented/);
    expect(commitCount()).toBe(count);
    expect(tagExists()).toBe(false);
    expect(git("diff", "--cached", "--name-only")).toBe("");
    // recovery: remove the hook, retry builds and tags PR0
    rmSync(hook);
    const retry = await buildContractPr0(ID, ON, repo);
    expect(retry.ok).toBe(true);
    expect(retry.skipped).toBeUndefined();
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(true);
  });

  it("ASDLC-1/AC-9 a failing tag (ref name conflict) is reported, never ok:true", async () => {
    seed();
    git("tag", "accord", "HEAD"); // 'accord' tag blocks creating 'accord/<ID>/contract'
    const outcome = await surfaced(() => buildContractPr0(ID, ON, repo));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/tag|accord\/TESTLOCK-1\/contract|ref/i);
    expect(outcome.message).not.toMatch(/not implemented/);
  });
});

describe("ASDLC-1/AC-9 pre-lock hooks", () => {
  it("ASDLC-1/AC-9 hooks run before writeContractLock so the lock matches the final files", async () => {
    seed();
    let active = true;
    const calls: Array<[string, string, boolean]> = [];
    const off = registerPreLockHook((workItemId, cwd) => {
      if (!active) return;
      calls.push([workItemId, cwd, existsSync(join(cwd, BASE, "contract.lock.json"))]);
      writeFileSync(join(cwd, BASE, "spec.json"), `${SPEC.trimEnd()}\n\n`);
    });
    try {
      await buildContractPr0(ID, ON, repo);
    } finally {
      active = false;
      if (typeof off === "function") off();
    }
    expect(calls).toEqual([[ID, repo, false]]);
    const lock = JSON.parse(readFileSync(join(repo, BASE, "contract.lock.json"), "utf8"));
    expect(lock.files[`${BASE}/spec.json`]).toBe(sha(`${SPEC.trimEnd()}\n\n`));
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
    expect(git("show", `HEAD:${BASE}/spec.json`)).toBe(`${SPEC.trimEnd()}`);
  });

  it("ASDLC-1/AC-9 async hooks are awaited before the lock is written", async () => {
    seed();
    let active = true;
    const edited = `${SPEC.trimEnd()}\n\n\n`;
    const off = registerPreLockHook(async (_id, cwd) => {
      if (!active) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
      writeFileSync(join(cwd, BASE, "spec.json"), edited);
    });
    try {
      await buildContractPr0(ID, ON, repo);
    } finally {
      active = false;
      off();
    }
    const lock = JSON.parse(readFileSync(join(repo, BASE, "contract.lock.json"), "utf8"));
    expect(lock.files[`${BASE}/spec.json`]).toBe(sha(edited));
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
    expect(git("show", `HEAD:${BASE}/spec.json`)).toBe(edited.trim());
  });

  it("ASDLC-1/AC-9 the unregister function returned by registerPreLockHook removes the hook", async () => {
    seed();
    let count = 0;
    const off = registerPreLockHook(() => {
      count++;
    });
    off();
    await buildContractPr0(ID, ON, repo);
    expect(count).toBe(0);
  });

  it("ASDLC-1/AC-9 hooks are not run when PR0 is skipped (quick_fix)", async () => {
    seed("quick_fix");
    let ran = 0;
    let active = true;
    const off = registerPreLockHook(() => {
      if (active) ran++;
    });
    try {
      await buildContractPr0(ID, ON, repo);
    } finally {
      active = false;
      if (typeof off === "function") off();
    }
    expect(ran).toBe(0);
  });
});

describe("ASDLC-1/AC-9 plan post-result wiring (processSubagentToolResult)", () => {
  const donePacket = {
    status: "done",
    plan_path: `${BASE}/plan.json`,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
  async function planResult(
    config: DevHarnessConfig | null,
    packet: Record<string, unknown> = donePacket,
    agent = "phase-plan",
  ): Promise<string> {
    const state: HarnessMutableState = {
      devConfig: config,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    return processSubagentToolResult({
      details: {
        results: [
          {
            agent,
            task: `${ID} plan run`,
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
  }
  function expectNoPr0(head: string): void {
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(existsSync(join(repo, BASE, "contract.lock.json"))).toBe(false);
    expect(tagExists()).toBe(false);
  }

  it("ASDLC-1/AC-9 the wiring fixture plan is schema-valid", async () => {
    seed();
    expect((await validateArtifact(join(repo, BASE, "plan.json"))).errors).toEqual([]);
    expect((await validateReturn("phase-plan", donePacket)).errors).toEqual([]);
  });

  it("ASDLC-1/AC-9 commit and tag exist when the plan post-result returns (before next spawn)", async () => {
    seed();
    process.chdir(repo);
    const out = await planResult(ON);
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(true);
    expect(out).toContain(TAG);
  });

  it("ASDLC-1/AC-9 default config {enabled:true} builds PR0 from the plan post-result", async () => {
    seed();
    process.chdir(repo);
    await planResult(cfg({ enabled: true }));
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(true);
  });

  it("ASDLC-1/AC-9 contract.tag:false: PR0 committed, no tag", async () => {
    seed();
    process.chdir(repo);
    await planResult(cfg({ enabled: true, contract: { lock: true, tag: false } }));
    expect(filesOf("HEAD")).toEqual(PR0_FILES);
    expect(tagExists()).toBe(false);
  });

  it("ASDLC-1/AC-9 contract.lock:false: plan post-result makes no PR0", async () => {
    seed();
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(cfg({ enabled: true, contract: { lock: false } }));
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-9 a plan post-result during an open amend writes no lock commit", async () => {
    seed();
    openAmend();
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(ON);
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-26 stack disabled: plan post-result makes no PR0", async () => {
    seed();
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(cfg({ enabled: false, contract: { lock: true } }));
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-9 invalid plan (missing spec) is rejected: no PR0", async () => {
    seed();
    const { spec: _spec, ...invalid } = JSON.parse(PLAN);
    write(`${BASE}/plan.json`, `${JSON.stringify(invalid, null, 2)}\n`);
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(ON);
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-9 phase-plan needs_input: no PR0", async () => {
    seed();
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(ON, {
      status: "needs_input",
      draft: {},
      questions: [{ id: "q1", stage: "plan", text: "which?" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-9 phase-plan stuck: no PR0", async () => {
    seed();
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(ON, {
      status: "stuck",
      question: "q",
      context: "c",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-9 another agent (phase-spec done): no PR0", async () => {
    seed();
    process.chdir(repo);
    const head = git("rev-parse", "HEAD");
    await planResult(
      ON,
      {
        status: "done",
        spec_path: `${BASE}/spec.json`,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      "phase-spec",
    );
    expectNoPr0(head);
  });

  it("ASDLC-1/AC-9 a failing PR0 commit is surfaced in the returned orchestrator text", async () => {
    seed();
    writeFileSync(
      join(repo, ".git", "hooks", "pre-commit"),
      "#!/bin/sh\necho blocked-by-hook >&2\nexit 1\n",
      { mode: 0o755 },
    );
    process.chdir(repo);
    const out = await planResult(ON);
    expect(out).toMatch(/blocked-by-hook/);
    expect(out).toMatch(/PR0|contract/i);
    expect(tagExists()).toBe(false);
  });

  it("ASDLC-1/AC-9 a failing PR0 tag is surfaced in the returned orchestrator text", async () => {
    seed();
    git("tag", "accord", "HEAD");
    process.chdir(repo);
    const out = await planResult(ON);
    expect(out).toMatch(/accord\/TESTLOCK-1\/contract|tag/i);
  });
});
