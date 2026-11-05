import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as traceArtifact from "@clive.shirley/accord-core/artifacts/trace-artifact.js";
import * as costArtifact from "@clive.shirley/accord-core/artifacts/workflow-cost-artifact.js";
import { parseAccordTrailer } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import {
  getCloseoutBranchHook,
  registerCloseoutBranchHook,
} from "@clive.shirley/accord-core/commit/hooks.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import { commitWorkItemArtifacts } from "@clive.shirley/accord-core/orchestration/commit-on-task-done.js";
import * as verifySummary from "@clive.shirley/accord-core/queries/verify-summary.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TASK = join(here, "..", "schemas", "task-file.example.json");
const ID = "ASDLC-1";
const DEV = `docs/dev/${ID}`;
const STATE_FILES = [
  `${DEV}/state/work-item.json`,
  `${DEV}/state/task-1/STATE.md`,
  `${DEV}/state/task-1/task.json`,
  `${DEV}/state/task-2/STATE.md`,
];
const OTHER_STATE = "docs/dev/ASDLC-2/state/work-item.json";
const OLD_SUBJECT = `[${ID}] Closeout: verify report, implementation trace, workflow cost`;

const STACK_ON = {
  stack: { enabled: true, commits: "phase" },
} as unknown as DevHarnessConfig;
const STACK_ON_NO_FINALIZE = {
  stack: { enabled: true, commits: "phase" },
  orchestration: { commit: { on_finalize: false } },
} as unknown as DevHarnessConfig;
const STACK_OFF = { stack: { enabled: false } } as unknown as DevHarnessConfig;
const STACK_OFF_NO_FINALIZE = {
  orchestration: { commit: { on_finalize: false } },
} as unknown as DevHarnessConfig;

let originalCwd: string;
let repo: string;
let previousHook: ReturnType<typeof getCloseoutBranchHook>;

// Closeout trailer shape is not pinned by the spec beyond v, id and outcome=closeout
// (ASDLC-1/AC-15); the remaining trailer keys (task, seq, ref, agent, loop, round) are left to the
// commit grammar and are deliberately not asserted here.

beforeAll(() => {
  previousHook = getCloseoutBranchHook();
});
afterAll(() => {
  registerCloseoutBranchHook(previousHook);
});

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
function exampleTask(taskId: number): TaskFileV2 {
  const task = JSON.parse(readFileSync(EXAMPLE_TASK, "utf8")) as TaskFileV2;
  task.task = taskId;
  task.control.status = "done";
  return task;
}
function writeTask(task: TaskFileV2): void {
  write(join(".tasks", `${ID}-task-${String(task.task)}.json`), JSON.stringify(task));
}
function commitVerifyFixture(): void {
  write(
    join(DEV, "verify.json"),
    JSON.stringify({ verdict: "pass", criteria: [{ ac_id: "AC-15", status: "pass" }] }),
  );
  const wiPath = join(".tasks", `${ID}.json`);
  const wi = JSON.parse(readFileSync(wiPath, "utf8")) as Record<string, unknown>;
  wi.verify = `${DEV}/verify.json`;
  writeFileSync(wiPath, JSON.stringify(wi));
  git("add", join(DEV, "verify.json"));
  git("commit", "-q", "-m", "verify fixture");
}
function headStatus(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of git("show", "--name-status", "--pretty=format:", "HEAD")
    .trim()
    .split("\n")
    .filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    out[rest[rest.length - 1] ?? ""] = status ?? "";
  }
  return out;
}

beforeEach(() => {
  registerCloseoutBranchHook(undefined);
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-closeout-")));
  process.chdir(repo);
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("README.md", "# repo\n");
  write(join(".tasks", `${ID}.json`), "");
  writeFileSync(
    join(".tasks", `${ID}.json`),
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Closeout fixture",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1, 2],
      spec: null,
      plan: `${DEV}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  write(
    join(DEV, "plan.json"),
    JSON.stringify({
      tasks: [
        { id: 1, title: "One", files: [{ path: "src/one.ts", action: "create" }] },
        { id: 2, title: "Two", files: [{ path: "src/two.ts", action: "create" }] },
      ],
    }),
  );
  for (const file of STATE_FILES) write(file, `{"snapshot":"${file}"}\n`);
  write(OTHER_STATE, '{"other":true}\n');
  git("add", ".");
  git("commit", "-q", "-m", "init with state");
  writeTask(exampleTask(1));
  writeTask(exampleTask(2));
});

afterEach(() => {
  registerCloseoutBranchHook(undefined);
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe("ASDLC-1/AC-15 closeout builds artifacts then removes state (ASDLC-1/TC-16)", () => {
  test("ASDLC-1/AC-15 stack enabled: closeout commit adds trace/cost/closeout marker and deletes all of state/", async () => {
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    expect(result.hash).toBeTruthy();

    const status = headStatus();
    // built artifacts are in the closeout commit
    expect(Object.keys(status)).toContain(`${DEV}/trace.json`);
    expect(Object.keys(status)).toContain(`${DEV}/trace.md`);
    expect(Object.keys(status)).toContain(`${DEV}/workflow-cost.json`);
    expect(status[`${DEV}/evidence/closeout.json`]).toBe("A");
    // every state file, including work-item.json, is deleted in the same commit
    for (const file of STATE_FILES) expect(status[file]).toBe("D");

    // on disk and in tree
    expect(existsSync(join(repo, DEV, "state"))).toBe(false);
    expect(git("ls-tree", "-r", "--name-only", "HEAD", `${DEV}/state`).trim()).toBe("");
    expect(
      git("ls-tree", "-r", "--name-only", "HEAD", `${DEV}/evidence/closeout.json`).trim(),
    ).toBe(`${DEV}/evidence/closeout.json`);
    expect(git("status", "--porcelain").trim()).toBe("");
    // unrelated committed files untouched
    expect(status["README.md"]).toBeUndefined();
    expect(status[`${DEV}/plan.json`]).toBeUndefined();
    // other work items' state is untouched
    expect(existsSync(join(repo, OTHER_STATE))).toBe(true);
    expect(status[OTHER_STATE]).toBeUndefined();
  });

  test.each([
    { name: "enabled only (commits defaults to task)", cfg: { stack: { enabled: true } } },
    { name: "commits task", cfg: { stack: { enabled: true, commits: "task" } } },
    { name: "commits phase", cfg: { stack: { enabled: true, commits: "phase" } } },
  ])("ASDLC-1/AC-15 closeout removes state for stack config: $name", async ({ cfg }) => {
    const result = await commitWorkItemArtifacts(ID, cfg as unknown as DevHarnessConfig, repo);
    expect(result.ok).toBe(true);
    const status = headStatus();
    for (const file of STATE_FILES) expect(status[file]).toBe("D");
    expect(status[`${DEV}/evidence/closeout.json`]).toBe("A");
    expect(existsSync(join(repo, DEV, "state"))).toBe(false);
    const trailer = parseAccordTrailer(git("log", "-1", "--pretty=%B"));
    expect(trailer?.outcome).toBe("closeout");
    expect(trailer?.id).toBe(ID);
  });

  test("ASDLC-1/AC-15 verify.md is built and committed; verify.json kept; state/ removed", async () => {
    commitVerifyFixture();
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    const status = headStatus();
    expect(status[`${DEV}/verify.md`]).toBe("A");
    expect(statSync(join(repo, DEV, "verify.md")).mtimeMs).toBeLessThanOrEqual(
      statSync(join(repo, DEV, "evidence", "closeout.json")).mtimeMs,
    );
    expect(git("ls-tree", "-r", "--name-only", "HEAD", `${DEV}/verify.json`).trim()).toBe(
      `${DEV}/verify.json`,
    );
    for (const file of STATE_FILES) expect(status[file]).toBe("D");
  });

  test("ASDLC-1/AC-15 state/ still exists while verify, trace and workflow-cost are built (deleted after)", async () => {
    commitVerifyFixture();
    const stateAtBuild: Record<string, boolean[]> = { trace: [], cost: [], verify: [] };
    const stateExists = () => existsSync(join(repo, DEV, "state", "work-item.json"));
    const realTrace = traceArtifact.writeWorkItemTrace;
    const realCost = costArtifact.devPersistWorkflowCost;
    const realVerify = verifySummary.devVerifySummary;
    const traceSpy = spyOn(traceArtifact, "writeWorkItemTrace").mockImplementation(((
      ...args: Parameters<typeof realTrace>
    ) => {
      stateAtBuild.trace?.push(stateExists());
      return realTrace(...args);
    }) as typeof realTrace);
    const costSpy = spyOn(costArtifact, "devPersistWorkflowCost").mockImplementation(((
      ...args: Parameters<typeof realCost>
    ) => {
      stateAtBuild.cost?.push(stateExists());
      return realCost(...args);
    }) as typeof realCost);
    const verifySpy = spyOn(verifySummary, "devVerifySummary").mockImplementation(((
      ...args: Parameters<typeof realVerify>
    ) => {
      stateAtBuild.verify?.push(stateExists());
      return realVerify(...args);
    }) as typeof realVerify);
    try {
      const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
      expect(result.ok).toBe(true);
    } finally {
      traceSpy.mockRestore();
      costSpy.mockRestore();
      verifySpy.mockRestore();
    }
    for (const key of ["trace", "cost", "verify"]) {
      expect(stateAtBuild[key]?.length ?? 0).toBeGreaterThan(0);
      expect(stateAtBuild[key]?.every((value) => value === true)).toBe(true);
    }
    expect(existsSync(join(repo, DEV, "state"))).toBe(false);
  });

  test("ASDLC-1/AC-15 artifacts are built before the closeout marker (mtime order) and marker is valid JSON", async () => {
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    const marker = join(repo, DEV, "evidence", "closeout.json");
    const markerTime = statSync(marker).mtimeMs;
    for (const built of ["trace.json", "trace.md", "workflow-cost.json"]) {
      expect(statSync(join(repo, DEV, built)).mtimeMs).toBeLessThanOrEqual(markerTime);
    }
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
    expect(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)).toBe(true);
    expect(JSON.stringify(parsed)).toContain(ID);
  });

  test("ASDLC-1/AC-15 closeout commit carries Accord trailer outcome=closeout for the work item", async () => {
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    const message = git("log", "-1", "--pretty=%B");
    expect(message).toMatch(/^Accord: /m);
    const trailer = parseAccordTrailer(message);
    expect(trailer?.outcome).toBe("closeout");
    expect(trailer?.id).toBe(ID);
    expect(trailer?.v).toBe(1);
    expect(git("log", "-1", "--pretty=%s")).toContain(`[${ID}]`);
  });

  test("ASDLC-1/AC-15 closeout is the last commit: state removal not left for a later commit", async () => {
    await commitWorkItemArtifacts(ID, STACK_ON, repo);
    const head = git("rev-parse", "HEAD").trim();
    expect(git("log", "-1", "--pretty=%H", "--", `${DEV}/state`).trim()).toBe(head);
    expect(git("log", "-1", "--pretty=%H", "--", `${DEV}/trace.json`).trim()).toBe(head);
  });

  test("ASDLC-1/AC-15 stack disabled keeps today's closeout: old subject, state/ kept, no marker (ASDLC-1/AC-26)", async () => {
    write(join(DEV, "workflow-cost.json"), "{}\n");
    const result = await commitWorkItemArtifacts(ID, STACK_OFF, repo);
    expect(result.ok).toBe(true);
    expect(git("log", "-1", "--pretty=%s").trim()).toBe(OLD_SUBJECT);
    expect(parseAccordTrailer(git("log", "-1", "--pretty=%B"))).toBeNull();
    for (const file of STATE_FILES) expect(existsSync(join(repo, file))).toBe(true);
    expect(existsSync(join(repo, DEV, "evidence", "closeout.json"))).toBe(false);
    expect(Object.values(headStatus())).not.toContain("D");
  });

  test("ASDLC-1/AC-15 stack disabled with no stack config at all keeps state/ (default off)", async () => {
    write(join(DEV, "workflow-cost.json"), "{}\n");
    const result = await commitWorkItemArtifacts(ID, null, repo);
    expect(result.ok).toBe(true);
    expect(git("log", "-1", "--pretty=%s").trim()).toBe(OLD_SUBJECT);
    for (const file of STATE_FILES) expect(existsSync(join(repo, file))).toBe(true);
  });
});

describe("ASDLC-1/AC-15 closeout branch hook and clean-tree precondition", () => {
  test("ASDLC-1/AC-15 awaits the branch hook before any artifact write or state removal", async () => {
    const seen: { traceExists: boolean; costExists: boolean; stateExists: boolean }[] = [];
    let hookFinished = false;
    registerCloseoutBranchHook(async () => {
      seen.push({
        traceExists: existsSync(join(repo, DEV, "trace.json")),
        costExists: existsSync(join(repo, DEV, "workflow-cost.json")),
        stateExists: existsSync(join(repo, DEV, "state", "work-item.json")),
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // still nothing written after the async delay: the hook was awaited, not fired and forgotten
      seen.push({
        traceExists: existsSync(join(repo, DEV, "trace.json")),
        costExists: existsSync(join(repo, DEV, "workflow-cost.json")),
        stateExists: existsSync(join(repo, DEV, "state", "work-item.json")),
      });
      hookFinished = true;
    });
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    expect(hookFinished).toBe(true);
    expect(seen).toEqual([
      { traceExists: false, costExists: false, stateExists: true },
      { traceExists: false, costExists: false, stateExists: true },
    ]);
    expect(existsSync(join(repo, DEV, "state"))).toBe(false);
  });

  test("ASDLC-1/AC-15 verify, trace and workflow-cost files written before closeout do not refuse it and are committed", async () => {
    for (const file of [
      "verify.json",
      "verify.md",
      "trace.json",
      "trace.md",
      "workflow-cost.json",
    ]) {
      write(`${DEV}/${file}`, file.endsWith(".json") ? "{}\n" : "# x\n");
    }
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    expect(result.skipped).not.toBe(true);
    const tracked = git("ls-files", DEV).split("\n");
    for (const file of ["verify.json", "verify.md", "trace.json", "trace.md"]) {
      expect(tracked).toContain(`${DEV}/${file}`);
    }
    expect(git("status", "--porcelain").trim()).toBe("");
  });

  test("ASDLC-1/AC-15 hook is called exactly once per closeout", async () => {
    let calls = 0;
    registerCloseoutBranchHook(() => {
      calls += 1;
    });
    await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(calls).toBe(1);
  });

  test.each([
    { name: "tracked modification", setup: () => write("README.md", "# changed\n") },
    {
      name: "staged-only addition",
      setup: () => {
        write("src/staged.ts", "export const x = 1;\n");
        git("add", "src/staged.ts");
      },
    },
    { name: "untracked non-artifact in work-item dir", setup: () => write(`${DEV}/notes.md`, "x") },
    {
      name: "tracked modification in work-item dir",
      setup: () => write(`${DEV}/plan.json`, '{"tasks":[]}'),
    },
    { name: "untracked outside", setup: () => write("src/dirty.ts", "export const dirty = 1;\n") },
  ])(
    "ASDLC-1/AC-15 dirty tree ($name) refuses closeout: hook not called, nothing written, state/ intact",
    async ({ setup }) => {
      setup();
      let calls = 0;
      registerCloseoutBranchHook(() => {
        calls += 1;
      });
      const headBefore = git("rev-parse", "HEAD").trim();
      const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/clean|dirty|uncommitted/i);
      expect(calls).toBe(0);
      expect(git("rev-parse", "HEAD").trim()).toBe(headBefore);
      expect(existsSync(join(repo, DEV, "trace.json"))).toBe(false);
      expect(existsSync(join(repo, DEV, "workflow-cost.json"))).toBe(false);
      expect(existsSync(join(repo, DEV, "evidence", "closeout.json"))).toBe(false);
      for (const file of STATE_FILES) expect(existsSync(join(repo, file))).toBe(true);
    },
  );

  test("ASDLC-1/AC-15 hook receives (id, config, options with cwd)", async () => {
    const received: unknown[][] = [];
    registerCloseoutBranchHook((...args) => {
      received.push(args);
    });
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    expect(received).toEqual([[ID, STACK_ON, expect.objectContaining({ cwd: repo })]]);
  });

  test.each([
    {
      name: "refusal result",
      expected: "unmerged task PRs",
      hook: () => ({
        ok: false,
        reason:
          "Closeout blocked: unmerged task PRs: stack/ASDLC-1/pr-1 (#1, open). Merge them first.",
      }),
    },
    {
      name: "throwing hook",
      expected: "gh pr list failed",
      hook: async () => {
        throw new Error("gh pr list failed");
      },
    },
  ])(
    "ASDLC-1/AC-15 hook $name aborts closeout with the reason, nothing written",
    async ({ hook, expected }) => {
      registerCloseoutBranchHook(hook);
      const headBefore = git("rev-parse", "HEAD").trim();
      const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
      expect(result.ok).toBe(false);
      expect(result.skipped).not.toBe(true);
      expect(result.reason).toContain(expected);
      expect(git("rev-parse", "HEAD").trim()).toBe(headBefore);
      expect(existsSync(join(repo, DEV, "trace.json"))).toBe(false);
      expect(existsSync(join(repo, DEV, "workflow-cost.json"))).toBe(false);
      expect(existsSync(join(repo, DEV, "evidence", "closeout.json"))).toBe(false);
      for (const file of STATE_FILES) expect(existsSync(join(repo, file))).toBe(true);
    },
  );

  test("ASDLC-1/AC-15 hook returning ok proceeds with closeout", async () => {
    registerCloseoutBranchHook(() => ({
      ok: true,
      branch: "stack/ASDLC-1/closeout",
      base: "origin/main",
    }));
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    expect(existsSync(join(repo, DEV, "state"))).toBe(false);
  });

  test("ASDLC-1/AC-15 closeout commit lands on the branch the hook switched to", async () => {
    const original = git("rev-parse", "--abbrev-ref", "HEAD").trim();
    const headBefore = git("rev-parse", "HEAD").trim();
    registerCloseoutBranchHook(() => {
      git("checkout", "-q", "-b", "stack/ASDLC-1/closeout");
      return { ok: true, branch: "stack/ASDLC-1/closeout", base: original };
    });
    const result = await commitWorkItemArtifacts(ID, STACK_ON, repo);
    expect(result.ok).toBe(true);
    expect(git("rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("stack/ASDLC-1/closeout");
    expect(git("rev-parse", "HEAD").trim()).toBe(result.hash ?? "");
    expect(git("rev-parse", original).trim()).toBe(headBefore);
    expect(headStatus()[`${DEV}/evidence/closeout.json`]).toBe("A");
  });

  test("ASDLC-1/AC-15 stack disabled ignores the hook and dirty tree (today's closeout)", async () => {
    write("src/dirty.ts", "export const dirty = 1;\n");
    write(join(DEV, "workflow-cost.json"), "{}\n");
    let calls = 0;
    registerCloseoutBranchHook(() => {
      calls += 1;
    });
    const result = await commitWorkItemArtifacts(ID, STACK_OFF, repo);
    expect(result.ok).toBe(true);
    expect(calls).toBe(0);
    expect(git("log", "-1", "--pretty=%s").trim()).toBe(OLD_SUBJECT);
  });
});

describe("ASDLC-1/AC-15 finalize refusal when on_finalize is false", () => {
  test("ASDLC-1/AC-15 stack enabled + on_finalize=false refuses with a clear message and leaves state/", async () => {
    let calls = 0;
    registerCloseoutBranchHook(() => {
      calls += 1;
    });
    const headBefore = git("rev-parse", "HEAD").trim();
    const result = await commitWorkItemArtifacts(ID, STACK_ON_NO_FINALIZE, repo);
    expect(result.ok).toBe(false);
    expect(result.skipped).not.toBe(true);
    expect(result.reason).toMatch(/on_finalize/);
    expect(result.reason).toMatch(/stack/i);
    expect(git("rev-parse", "HEAD").trim()).toBe(headBefore);
    expect(calls).toBe(0);
    for (const file of STATE_FILES) expect(existsSync(join(repo, file))).toBe(true);
    expect(existsSync(join(repo, DEV, "trace.json"))).toBe(false);
    expect(existsSync(join(repo, DEV, "workflow-cost.json"))).toBe(false);
    expect(git("status", "--porcelain").trim()).toBe("");
  });

  test("ASDLC-1/AC-15 stack disabled + on_finalize=false is still a silent skip (unchanged)", async () => {
    const result = await commitWorkItemArtifacts(ID, STACK_OFF_NO_FINALIZE, repo);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("commit.on_finalize explicitly disabled");
    for (const file of STATE_FILES) expect(existsSync(join(repo, file))).toBe(true);
  });
});
