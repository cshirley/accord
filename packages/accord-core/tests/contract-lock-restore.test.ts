import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
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
import { type AccordTrailer, buildCommitMessage } from "../src/commit/commit-grammar.js";
import { guardStagedPaths } from "../src/commit/commit-guard.js";
import { verifyContractLock, writeContractLock } from "../src/contract/lock.js";
import { verifyAfterSpawn } from "../src/contract/lock-verify.js";
import { processSubagentToolResult } from "../src/harness/index.js";
import type { HarnessMutableState } from "../src/harness/types.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";
import { loadPricing } from "../src/telemetry/usage.js";

// ASDLC-1/AC-9, ASDLC-1/TC-9: post-spawn lock verification, restore, amend-only commits.
const ID = "RESTORE-1";
const BASE = `docs/dev/${ID}`;
const NONCE = "n0nce1";
const SPEC = `${BASE}/spec.json`;
const PLAN = `${BASE}/plan.json`;
const BRIEF = `${BASE}/brief.md`;
const LOCK = `${BASE}/contract.lock.json`;
const MARKER = `${BASE}/state/contract-amend.open`;
const SESSION = `.tasks/${ID}-amend.json`;
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const planObj = (guidance: unknown[] = []) => ({
  schema_version: "1.0",
  work_item_id: ID,
  tasks: [{ id: 1, title: "t1", covers_ac: ["AC-1"] }],
  guidance,
});
const SPEC0 = json({ id: "spec", title: "Spec", acceptance_criteria: [{ id: "AC-1" }] });
const BRIEF0 = "# Brief\nhello\n";
const PLAN0 = json(planObj());

let repo: string;
let errSpy: ReturnType<typeof spyOn>;
let priorLevel: ReturnType<typeof getLogLevel>;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function put(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
const logged = (): string[] => errSpy.mock.calls.map((call: unknown[]) => String(call[0]));
const rejections = () => logged().filter((line) => line.includes("stack.guard.rejected"));
const openAmend = (marker = NONCE) => {
  put(SESSION, JSON.stringify({ nonce: NONCE }));
  put(MARKER, marker);
};

beforeEach(async () => {
  priorLevel = getLogLevel();
  setLogLevel("debug");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  repo = realpathSync(mkdtempSync(join(tmpdir(), "lock-restore-")));
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  put(".gitignore", ".tasks/\n");
  put(BRIEF, BRIEF0);
  put(SPEC, SPEC0);
  put(PLAN, PLAN0);
  put(`${BASE}/state/work-item.json`, "{}\n");
  git("add", ".");
  git("commit", "-q", "-m", "contract inputs");
  await writeContractLock(ID, repo);
  git("add", ".");
  git("commit", "-q", "-m", "lock");
  git("tag", `accord/${ID}/contract`);
});
afterEach(() => {
  errSpy.mockRestore();
  setLogLevel(priorLevel);
  rmSync(repo, { recursive: true, force: true });
});

describe("ASDLC-1/AC-9 verifyAfterSpawn restores locked files written outside an amend", () => {
  for (const [file, original, edited] of [
    [BRIEF, BRIEF0, "# Brief\nHACKED\n"],
    [SPEC, SPEC0, json({ id: "spec", title: "HACKED" })],
    [PLAN, PLAN0, json({ ...planObj(), tasks: [] })],
  ] as const) {
    it(`ASDLC-1/AC-9 ${file} edited by phase-code is restored and rejected with locked-file-written`, async () => {
      put(file, edited);
      await verifyAfterSpawn(ID, repo, "phase-code");
      expect(read(file)).toBe(original);
      expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
      const lines = rejections();
      expect(lines).toHaveLength(1);
      const line = lines.find((entry) => entry.includes(`path=${file}`)) as string;
      expect(line).toBeDefined();
      expect(line).toContain("rule=locked-file-written");
      expect(line).toContain(`work_item_id=${ID}`);
      expect(line).toContain("[accord:stack:warn]");
      expect(read(file)).not.toContain("HACKED");
    });
  }

  it("ASDLC-1/AC-9 contract.lock.json rewritten by a spawn is restored", async () => {
    const original = read(LOCK);
    put(LOCK, json({ ...JSON.parse(original), files: {} }));
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(LOCK)).toBe(original);
    expect(
      rejections().some(
        (l) => l.includes(`path=${LOCK}`) && l.includes("rule=locked-file-written"),
      ),
    ).toBe(true);
  });

  it("ASDLC-1/AC-9 deleted locked file is restored", async () => {
    rmSync(join(repo, SPEC));
    await verifyAfterSpawn(ID, repo, "phase-test");
    expect(read(SPEC)).toBe(SPEC0);
    expect(rejections().some((l) => l.includes(`path=${SPEC}`))).toBe(true);
  });

  it("ASDLC-1/AC-9 restore reverts a staged locked edit too", async () => {
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    git("add", SPEC);
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(git("show", `:${SPEC}`)).toBe(SPEC0.trim());
  });

  it("ASDLC-1/AC-9 only locked paths are touched: other edits and clean runs emit nothing", async () => {
    put("src/foo.ts", "export const x = 1;\n");
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read("src/foo.ts")).toBe("export const x = 1;\n");
    rmSync(join(repo, "src/foo.ts"));
    errSpy.mockClear();
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(rejections()).toHaveLength(0);
    expect(read(SPEC)).toBe(SPEC0);
  });
});

describe("ASDLC-1/AC-9 open amend (valid nonce) authorises phase-spec and phase-plan only", () => {
  for (const agent of ["phase-spec", "phase-plan"]) {
    it(`ASDLC-1/AC-9 ${agent} locked writes kept while amend is open`, async () => {
      openAmend();
      put(SPEC, json({ id: "spec", title: "amended" }));
      put(BRIEF, "# Brief\namended\n");
      put(PLAN, json({ ...planObj(), tasks: [] }));
      await verifyAfterSpawn(ID, repo, agent);
      expect(read(SPEC)).toBe(json({ id: "spec", title: "amended" }));
      expect(read(BRIEF)).toBe("# Brief\namended\n");
      expect(read(PLAN)).toBe(json({ ...planObj(), tasks: [] }));
      expect(rejections()).toHaveLength(0);
      expect(read(MARKER)).toBe(NONCE);
    });
  }

  for (const agent of [
    "phase-code",
    "phase-test",
    "review-code",
    "review-security",
    "phase-verify-task",
    "phase-spec-x",
    "",
  ]) {
    it(`ASDLC-1/AC-9 ${JSON.stringify(agent)} writes restored even when marker and nonce match`, async () => {
      openAmend();
      put(SPEC, json({ id: "spec", title: "HACKED" }));
      put(PLAN, json({ ...planObj(), tasks: [] }));
      await verifyAfterSpawn(ID, repo, agent);
      expect(read(SPEC)).toBe(SPEC0);
      expect(read(PLAN)).toBe(PLAN0);
      expect(
        rejections().some(
          (l) => l.includes(`path=${SPEC}`) && l.includes("rule=locked-file-written"),
        ),
      ).toBe(true);
      expect(read(MARKER)).toBe(NONCE);
      expect(existsSync(join(repo, SESSION))).toBe(true);
    });
  }

  it("ASDLC-1/AC-9 phase-spec cannot keep a rewritten contract.lock.json even with an open amend", async () => {
    openAmend();
    const original = read(LOCK);
    put(LOCK, json({ ...JSON.parse(original), files: {} }));
    const amended = json({ id: "spec", title: "amended" });
    put(SPEC, amended);
    await verifyAfterSpawn(ID, repo, "phase-spec");
    expect(read(LOCK)).toBe(original);
    expect(read(SPEC)).toBe(amended);
    const lines = rejections();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`path=${LOCK}`);
  });
});

describe("ASDLC-1/AC-9 marker without the matching nonce", () => {
  it("ASDLC-1/AC-9 wrong-nonce marker is deleted and does not authorise the write", async () => {
    openAmend("forged-nonce");
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await verifyAfterSpawn(ID, repo, "phase-spec");
    expect(existsSync(join(repo, MARKER))).toBe(false);
    expect(read(SPEC)).toBe(SPEC0);
    expect(rejections().some((l) => l.includes("rule=locked-file-written"))).toBe(true);
  });

  it("ASDLC-1/AC-9 marker with no session file is deleted and does not authorise the write", async () => {
    put(MARKER, NONCE);
    put(PLAN, json({ ...planObj(), tasks: [] }));
    await verifyAfterSpawn(ID, repo, "phase-plan");
    expect(existsSync(join(repo, MARKER))).toBe(false);
    expect(read(PLAN)).toBe(PLAN0);
  });

  it("ASDLC-1/AC-9 wrong-nonce marker with no locked edits: marker deleted, files unchanged", async () => {
    openAmend("forged-nonce");
    await verifyAfterSpawn(ID, repo, "phase-spec");
    expect(existsSync(join(repo, MARKER))).toBe(false);
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(BRIEF)).toBe(BRIEF0);
    expect(read(PLAN)).toBe(PLAN0);
    expect(read(LOCK)).toBe(`${git("show", `HEAD:${LOCK}`)}\n`);
  });
});

describe("ASDLC-1/AC-9 plan.json guidance-only changes are kept", () => {
  const guided = json(planObj([{ directive: "as-built: x", source: "review-deviation" }]));
  for (const agent of ["phase-code", "review-code", "phase-verify-task"]) {
    it(`ASDLC-1/AC-9 guidance[]-only plan change by ${agent} is kept, no rejection`, async () => {
      put(PLAN, guided);
      await verifyAfterSpawn(ID, repo, agent);
      expect(read(PLAN)).toBe(guided);
      expect(rejections()).toHaveLength(0);
      expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
    });
  }

  it("ASDLC-1/AC-9 guidance change plus a task change restores the whole plan.json", async () => {
    put(PLAN, json({ ...planObj([{ directive: "d", source: "x" }]), tasks: [] }));
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(PLAN)).toBe(PLAN0);
    expect(rejections().some((l) => l.includes(`path=${PLAN}`))).toBe(true);
  });
});

describe("ASDLC-1/AC-9 guardStagedPaths locked-path rule", () => {
  const SRC = "packages/accord-core/src/foo.ts";
  const LOCKED = [BRIEF, SPEC, PLAN, LOCK];
  const types = [
    "phase-test",
    "phase-code",
    "review-test",
    "review-code",
    "review-security",
    "phase-verify-task",
    "state",
    "evidence",
  ];

  for (const type of types) {
    it(`ASDLC-1/AC-9 ${type} commit drops locked files and the lock`, () => {
      const result = guardStagedPaths(type, ID, [...LOCKED, SRC], "**/*.test.ts");
      for (const path of LOCKED) {
        expect(result.kept).not.toContain(path);
        expect(result.rejected).toContain(path);
      }
      expect(result.rule).toBeDefined();
      for (const path of LOCKED) {
        expect(
          rejections().some(
            (l) => l.includes(`path=${path}`) && l.includes("stack.guard.rejected"),
          ),
        ).toBe(true);
      }
    });
  }

  it("ASDLC-1/AC-9 phase-test keeps source/test paths and rejects only locked ones with rule locked-path", () => {
    const test = "packages/accord-core/tests/foo.test.ts";
    const result = guardStagedPaths("phase-test", ID, [SPEC, test, SRC, LOCK], "**/*.test.ts");
    expect(result.kept).toEqual([test, SRC]);
    expect(result.rejected).toEqual([SPEC, LOCK]);
    expect(result.rule).toBe("locked-path");
    expect(rejections().filter((l) => l.includes("rule=locked-path"))).toHaveLength(2);
  });

  it("ASDLC-1/AC-9 phase-code locked file is rejected with locked-path and nothing else changes", () => {
    const result = guardStagedPaths("phase-code", ID, [SRC, PLAN], "**/*.test.ts");
    expect(result.kept).toEqual([SRC]);
    expect(result.rejected).toEqual([PLAN]);
    expect(result.rule).toBe("locked-path");
  });

  it("ASDLC-1/AC-9 locked-path rule ignores another work item's files", () => {
    const other = "docs/dev/OTHER-9/spec.json";
    const result = guardStagedPaths("phase-test", ID, [other], "**/*.test.ts");
    expect(result.kept).toEqual([other]);
    expect(result.rejected).toEqual([]);
  });

  it("ASDLC-1/AC-9 phase-code with a test file and a locked file: test path and lock rejected, respawn phase-test", () => {
    const test = "packages/accord-core/tests/foo.test.ts";
    const result = guardStagedPaths("phase-code", ID, [SRC, test, PLAN], "**/*.test.ts");
    expect(result.kept).toEqual([SRC]);
    expect(result.rejected).toContain(test);
    expect(result.rejected).toContain(PLAN);
    expect(result.respawn).toBe("phase-test");
  });

  it("ASDLC-1/AC-9 amend commit keeps locked files, lock and state/** only", () => {
    const state = `${BASE}/state/task-1/task.json`;
    const spec2 = `${BASE}/spec.md`; // derived spec.md is committed by applyContractAmend
    const result = guardStagedPaths(
      "amend",
      ID,
      [
        BRIEF,
        SPEC,
        PLAN,
        LOCK,
        state,
        SRC,
        "README.md",
        `${BASE}/evidence/task-1.md`,
        `${BASE}/reviews/task-1/f.json`,
        "docs/dev/OTHER-9/spec.json",
        `${BASE}/state/../spec.md`,
        spec2,
      ],
      "**/*.test.ts",
    );
    expect(result.kept).toEqual([BRIEF, SPEC, PLAN, LOCK, state, spec2]);
    expect(result.rejected).toEqual([
      SRC,
      "README.md",
      `${BASE}/evidence/task-1.md`,
      `${BASE}/reviews/task-1/f.json`,
      "docs/dev/OTHER-9/spec.json",
      `${BASE}/state/../spec.md`,
    ]);
    expect(result.rule).toBeDefined();
  });

  it("ASDLC-1/AC-9 amend commit with only allowed paths has no rejection", () => {
    const result = guardStagedPaths("amend", ID, [SPEC, LOCK], "**/*.test.ts");
    expect(result.kept).toEqual([SPEC, LOCK]);
    expect(result.rejected).toEqual([]);
    expect(result.rule).toBeUndefined();
  });
});

const trailer = (outcome: string, id: string = ID): AccordTrailer => ({
  v: 1,
  id,
  task: 0,
  seq: 1,
  ref: "contract-amend",
  agent: "harness",
  loop: "amend",
  round: 0,
  outcome,
});
const amendMessage = (id: string = ID) =>
  buildCommitMessage({ summary: "amend contract: ok", trailer: trailer("amend", id) });

// Edits spec.json, regenerates the lock, optionally appends a hand-written amendment record, commits.
async function forge(message: string, title = "FORGED", withAmendment = true): Promise<void> {
  const previous: unknown[] = JSON.parse(read(LOCK)).amendments ?? [];
  put(SPEC, json({ id: "spec", title }));
  await writeContractLock(ID, repo);
  const lock = JSON.parse(read(LOCK));
  lock.amendments = withAmendment
    ? [
        ...previous,
        {
          diff: "d",
          reason: "r",
          affected_acs: ["AC-1"],
          stale_task_ids: [],
          at: new Date(0).toISOString(),
        },
      ]
    : previous;
  put(LOCK, json(lock));
  git("add", ".");
  git("commit", "-q", "-m", message);
}

describe("ASDLC-1/AC-9 restore source is the latest lock-changing commit", () => {
  it("ASDLC-1/AC-9 after an approved amend commit, a later hack is restored to the amended content, not PR0", async () => {
    await forge(amendMessage(), "AMENDED");
    const amended = json({ id: "spec", title: "AMENDED" });
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(amended);
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
    const lines = rejections();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`path=${SPEC}`);
  });

  it("ASDLC-1/AC-9 a locked edit committed by the spawn (lock untouched) is still reverted to the locked content", async () => {
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    git("commit", "-qam", "sneaky");
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(rejections().some((l) => l.includes(`path=${SPEC}`))).toBe(true);
  });

  it("ASDLC-1/AC-9 spec.json edit plus regenerated lock: both are restored from the committed lock", async () => {
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await writeContractLock(ID, repo);
    const headLock = `${git("show", `HEAD:${LOCK}`)}\n`;
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(LOCK)).toBe(headLock);
    const lines = rejections();
    expect(
      lines.some((l) => l.includes(`path=${SPEC}`) && l.includes("rule=locked-file-written")),
    ).toBe(true);
    expect(
      lines.some((l) => l.includes(`path=${LOCK}`) && l.includes("rule=locked-file-written")),
    ).toBe(true);
  });

  for (const staged of [false, true]) {
    it(`ASDLC-1/AC-9 deleted contract.lock.json (${staged ? "git rm --cached + rm" : "rm"}) is restored, together with a spec edit`, async () => {
      const headLock = `${git("show", `HEAD:${LOCK}`)}\n`;
      if (staged) git("rm", "-q", "--cached", LOCK);
      rmSync(join(repo, LOCK));
      put(SPEC, json({ id: "spec", title: "HACKED" }));
      await verifyAfterSpawn(ID, repo, "phase-code");
      expect(read(LOCK)).toBe(headLock);
      expect(read(SPEC)).toBe(SPEC0);
      expect(
        rejections().some(
          (l) => l.includes(`path=${LOCK}`) && l.includes("rule=locked-file-written"),
        ),
      ).toBe(true);
    });
  }

  it("ASDLC-1/AC-9 never-locked work item: locked-path edits are kept and nothing is rejected", async () => {
    const other = "NOLOCK-1";
    put(`docs/dev/${other}/brief.md`, BRIEF0);
    put(`docs/dev/${other}/spec.json`, SPEC0);
    put(`docs/dev/${other}/plan.json`, PLAN0);
    git("add", ".");
    git("commit", "-q", "-m", "nolock inputs");
    const edited = json({ id: "spec", title: "free edit" });
    put(`docs/dev/${other}/spec.json`, edited);
    await verifyAfterSpawn(other, repo, "phase-code");
    expect(read(`docs/dev/${other}/spec.json`)).toBe(edited);
    expect(rejections()).toHaveLength(0);
  });
});

describe("ASDLC-1/AC-9 restore source ignores lock history written by the spawn", () => {
  it("ASDLC-1/AC-9 plain commit of hacked spec plus regenerated lock is reverted to the tagged lock", async () => {
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await writeContractLock(ID, repo);
    git("add", ".");
    git("commit", "-qm", "sneaky");
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(LOCK)).toBe(`${git("show", `accord/${ID}/contract:${LOCK}`)}\n`);
    expect(
      rejections().some(
        (l) => l.includes(`path=${SPEC}`) && l.includes("rule=locked-file-written"),
      ),
    ).toBe(true);
  });

  it("ASDLC-1/AC-9 committed deletion of the lock does not make the item look never-locked", async () => {
    git("rm", "-q", LOCK);
    git("commit", "-qm", "drop lock");
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(LOCK)).toBe(`${git("show", `accord/${ID}/contract:${LOCK}`)}\n`);
    expect(read(SPEC)).toBe(SPEC0);
    expect(rejections().some((l) => l.includes(`path=${LOCK}`))).toBe(true);
  });
});

describe("ASDLC-1/AC-9 restore source survives tag deletion and re-added locks", () => {
  it("ASDLC-1/AC-9 deleted accord/<ID>/contract tag: spec hack still restored, item not treated as never-locked", async () => {
    const tagLock = `${git("show", `accord/${ID}/contract:${LOCK}`)}\n`;
    git("tag", "-d", `accord/${ID}/contract`);
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(LOCK)).toBe(tagLock);
    expect(
      rejections().some(
        (l) => l.includes(`path=${SPEC}`) && l.includes("rule=locked-file-written"),
      ),
    ).toBe(true);
  });

  it("ASDLC-1/AC-9 lock deleted then re-added with forged hashes in plain commits: first lock stays the base", async () => {
    const tagLock = `${git("show", `accord/${ID}/contract:${LOCK}`)}\n`;
    git("rm", "-q", LOCK);
    git("commit", "-qm", "drop");
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    await writeContractLock(ID, repo);
    git("add", ".");
    git("commit", "-qm", "readd");
    const verdict = await verifyContractLock(ID, repo);
    expect(verdict.unchanged).toBe(false);
    expect(verdict.changed).toContain(SPEC);
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(LOCK)).toBe(tagLock);
  });
});

describe("ASDLC-1/AC-9 restore is limited to the offending locked paths", () => {
  it("ASDLC-1/AC-9 a valid guidance-only plan edit is kept while a spec hack is restored with exactly one rejection", async () => {
    const guided = json(planObj([{ directive: "as-built: x", source: "review-deviation" }]));
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    put(PLAN, guided);
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(PLAN)).toBe(guided);
    const lines = rejections();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`path=${SPEC}`);
  });

  it("ASDLC-1/AC-9 tracked state/** and reviews/** edits survive a spec restore", async () => {
    put(SPEC, json({ id: "spec", title: "HACKED" }));
    put(`${BASE}/state/work-item.json`, '{"x":1}\n');
    put(`${BASE}/reviews/task-1/f.json`, "{}");
    await verifyAfterSpawn(ID, repo, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(read(`${BASE}/state/work-item.json`)).toBe('{"x":1}\n');
    expect(read(`${BASE}/reviews/task-1/f.json`)).toBe("{}");
  });
});

describe("ASDLC-1/AC-9 processSubagentToolResult wiring", () => {
  const originalCwd = process.cwd();
  const seedTask = (id: string) =>
    put(
      `.tasks/${id}.json`,
      JSON.stringify({
        schema_version: "1.0",
        id,
        title: "t",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
        pattern: "implement",
        phase: "implementing",
        task_ids: [1],
        spec: `docs/dev/${id}/spec.json`,
        plan: `docs/dev/${id}/plan.json`,
        verify: null,
        brief: null,
        decisions: [],
        deviations: [],
        cost_usd: 0,
      }),
    );
  const text = (value: string) => [{ role: "assistant", content: [{ type: "text", text: value }] }];
  const packet = (body: unknown) => text(`\`\`\`json\n${JSON.stringify(body)}\n\`\`\``);
  const shapes: Record<string, Record<string, unknown>> = {
    "valid done packet": {
      exitCode: 0,
      messages: packet({
        status: "done",
        tests_passing: true,
        changes: [{ file: "src/foo.ts", ac_ids: ["AC-1"] }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    },
    timedOut: { exitCode: 1, timedOut: true, messages: [] },
    "missing packet": { exitCode: 0, messages: text("finished, no packet here") },
    "invalid packet": { exitCode: 0, messages: packet({ status: "bogus-status" }) },
    aborted: { aborted: true, exitCode: 1, messages: [] },
    "empty response": { exitCode: 0, messages: [] },
  };
  async function run(
    id: string,
    extra: Record<string, unknown>,
    agent = "phase-code",
  ): Promise<string> {
    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    return processSubagentToolResult({
      details: { results: [{ agent, task: `${id} task 1`, ...extra }] },
      state,
      pricing: loadPricing(),
    });
  }
  afterEach(() => process.chdir(originalCwd));

  for (const [label, extra] of Object.entries(shapes)) {
    it(`ASDLC-1/AC-9 ${label}: locked spec.json edit is restored and rejected`, async () => {
      seedTask(ID);
      process.chdir(repo);
      put(SPEC, json({ id: "spec", title: "HACKED" }));
      const out = await run(ID, extra);
      if (label === "valid done packet") {
        expect(out).not.toContain("Return packet validation failed");
      }
      expect(read(SPEC)).toBe(SPEC0);
      expect(
        rejections().some(
          (l) => l.includes(`path=${SPEC}`) && l.includes("rule=locked-file-written"),
        ),
      ).toBe(true);
    });
  }

  for (const committed of [false, true]) {
    it(`ASDLC-1/AC-9 spawn deletes contract.lock.json (${committed ? "committed" : "working tree"}) and edits spec.json: restored via processSubagentToolResult`, async () => {
      seedTask(ID);
      process.chdir(repo);
      const tagLock = `${git("show", `accord/${ID}/contract:${LOCK}`)}\n`;
      if (committed) {
        git("rm", "-q", LOCK);
        git("commit", "-qm", "drop lock");
      } else {
        rmSync(join(repo, LOCK));
      }
      put(SPEC, json({ id: "spec", title: "HACKED" }));
      await run(ID, shapes["invalid packet"] as Record<string, unknown>);
      expect(read(LOCK)).toBe(tagLock);
      expect(read(SPEC)).toBe(SPEC0);
      expect(
        rejections().some(
          (l) => l.includes(`path=${LOCK}`) && l.includes("rule=locked-file-written"),
        ),
      ).toBe(true);
    });
  }

  const doneShape = shapes["invalid packet"] as Record<string, unknown>;
  it("ASDLC-1/AC-9 the returning agent name reaches the check: phase-spec keeps an open-amend write, phase-code does not", async () => {
    seedTask(ID);
    process.chdir(repo);
    openAmend();
    const amended = json({ id: "spec", title: "amended" });
    put(SPEC, amended);
    await run(ID, doneShape, "phase-spec");
    expect(read(SPEC)).toBe(amended);
    expect(rejections()).toHaveLength(0);
    await run(ID, doneShape, "phase-code");
    expect(read(SPEC)).toBe(SPEC0);
    expect(rejections().some((l) => l.includes(`path=${SPEC}`))).toBe(true);
  });

  it("ASDLC-1/AC-9 never-locked work item: the same spec.json edit is kept", async () => {
    const other = "NOLOCK-2";
    put(`docs/dev/${other}/brief.md`, BRIEF0);
    put(`docs/dev/${other}/spec.json`, SPEC0);
    put(`docs/dev/${other}/plan.json`, PLAN0);
    git("add", ".");
    git("commit", "-q", "-m", "nolock inputs");
    seedTask(other);
    process.chdir(repo);
    const edited = json({ id: "spec", title: "free edit" });
    put(`docs/dev/${other}/spec.json`, edited);
    await run(other, shapes["valid done packet"] as Record<string, unknown>);
    expect(read(`docs/dev/${other}/spec.json`)).toBe(edited);
    expect(rejections()).toHaveLength(0);
  });
});

describe("ASDLC-1/AC-9 forged lock with hand-written amendment is not accepted", () => {
  it("ASDLC-1/AC-9 plain commit carrying matching hashes and an amendment record is rejected", async () => {
    await forge("sneaky edit");
    const result = await verifyContractLock(ID, repo);
    expect(result.unchanged).toBe(false);
    expect(result.changed).toContain(SPEC);
  });

  it("ASDLC-1/AC-9 commit trailer with a non-amend outcome is rejected", async () => {
    await forge(buildCommitMessage({ summary: "sneaky", trailer: trailer("green") }));
    const result = await verifyContractLock(ID, repo);
    expect(result.unchanged).toBe(false);
    expect(result.changed).toContain(SPEC);
  });

  it("ASDLC-1/AC-9 the same forged content committed with an outcome=amend trailer is accepted", async () => {
    await forge(amendMessage());
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
  });

  const rows: [string, () => Promise<void>, boolean][] = [
    [
      "valid amend then an unrelated plain commit",
      async () => {
        await forge(amendMessage());
        put("src/x.ts", "export const x = 1;\n");
        git("add", ".");
        git("commit", "-q", "-m", "unrelated");
      },
      true,
    ],
    [
      "valid amend then a second forged lock change in a plain commit",
      async () => {
        await forge(amendMessage());
        await forge("plain second edit", "FORGED2");
      },
      false,
    ],
    [
      "hash-matching lock without any amendment record in a plain commit",
      async () => {
        await forge("plain", "FORGED", false);
      },
      false,
    ],
    [
      "message text mentions outcome=amend but has no Accord trailer",
      async () => {
        await forge("sneaky outcome=amend");
      },
      false,
    ],
    [
      "amend trailer for a different work item id",
      async () => {
        await forge(amendMessage("OTHER-1"));
      },
      false,
    ],
    [
      "forged plain commit followed by an empty amend-trailer commit",
      async () => {
        await forge("sneaky");
        git("commit", "-q", "--allow-empty", "-m", amendMessage());
      },
      false,
    ],
  ];
  for (const [label, setup, expected] of rows) {
    it(`ASDLC-1/AC-9 ${label}: unchanged=${expected}`, async () => {
      await setup();
      const result = await verifyContractLock(ID, repo);
      expect(result.unchanged).toBe(expected);
      if (!expected) expect(result.changed).toContain(SPEC);
    });
  }
});
