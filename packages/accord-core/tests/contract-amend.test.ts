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
import { validateArtifact } from "../src/artifacts/validation.js";
import { parseAccordTrailer } from "../src/commit/commit-grammar.js";
import { applyContractAmend } from "../src/contract/amend.js";
import { isAmendOpen, verifyContractLock, writeContractLock } from "../src/contract/lock.js";

const ID = "TESTLOCK-1";
const BASE = `docs/dev/${ID}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const specObj = (text: string) => ({
  id: "spec",
  title: "Spec",
  acceptance_criteria: [
    { id: "AC-1", requirement: "MUST", type: "constraint", criterion: text },
    { id: "AC-2", requirement: "MUST", type: "constraint", criterion: "two" },
    { id: "AC-3", requirement: "MUST", type: "constraint", criterion: "three" },
  ],
});
const planObj = () => ({
  schema_version: "1.0",
  work_item_id: ID,
  tasks: [
    { id: 1, title: "t1", covers_ac: ["AC-1"] },
    { id: 2, title: "t2", covers_ac: ["AC-2"] },
    { id: 3, title: "t3", covers_ac: ["AC-1", "AC-3"] },
    { id: 4, title: "t4", covers_ac: ["AC-3"] },
  ],
});
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

let repo: string;
let nonGit: string;
let originalCwd: string;
let lockHeadBefore: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}
function read(rel: string): string {
  return readFileSync(join(repo, rel), "utf8");
}
function files(rev: string): string[] {
  return git("show", "--name-only", "--pretty=format:", rev).split("\n").filter(Boolean);
}
const lockJson = () => JSON.parse(read(`${BASE}/contract.lock.json`));
const input = (over: Record<string, unknown> = {}) => ({
  diff: "AC-1 criterion reworded",
  reason: "clarify AC-1",
  affected_acs: ["AC-1"],
  ...over,
});
async function surfaced(fn: () => Promise<{ ok: boolean; reason?: string }>) {
  try {
    const r = await fn();
    return { ok: r.ok, message: r.reason ?? "" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
/** Amend session editing the locked files in the working tree. */
function editLocked(): { spec: string; plan: string; brief: string } {
  const spec = json(specObj("AC-1 amended wording"));
  const plan = json({
    ...planObj(),
    tasks: [...planObj().tasks, { id: 5, title: "t5", covers_ac: ["AC-2"] }],
  });
  const brief = "# Brief\namended\n";
  write(`${BASE}/spec.json`, spec);
  write(`${BASE}/plan.json`, plan);
  write(`${BASE}/brief.md`, brief);
  return { spec, plan, brief };
}

beforeEach(async () => {
  originalCwd = process.cwd();
  // run from a NON-git dir so process.cwd()-based git calls fail loudly
  nonGit = realpathSync(mkdtempSync(join(tmpdir(), "contract-amend-nogit-")));
  process.chdir(nonGit);
  repo = realpathSync(mkdtempSync(join(tmpdir(), "contract-amend-")));
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write(`${BASE}/brief.md`, "# Brief\nhello\n");
  write(`${BASE}/spec.json`, json(specObj("AC-1 original")));
  write(`${BASE}/plan.json`, json(planObj()));
  write(`${BASE}/state/work-item.json`, "{}\n");
  git("add", ".");
  git("commit", "-q", "-m", "contract inputs");
  await writeContractLock(ID, repo);
  git("add", ".");
  git("commit", "-q", "-m", "lock");
  lockHeadBefore = git("rev-parse", "HEAD");
  // open amend session
  write(`.tasks/${ID}-amend.json`, JSON.stringify({ nonce: "n0nce1" }));
  write(`${BASE}/state/contract-amend.open`, "n0nce1");
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
  rmSync(nonGit, { recursive: true, force: true });
});

describe("ASDLC-1/AC-9 applyContractAmend", () => {
  it("ASDLC-1/AC-9 rewrites contract.lock.json to match the amended files", async () => {
    const edited = editLocked();
    const before = lockJson();
    const result = await applyContractAmend(ID, input(), repo);
    expect(result.ok).toBe(true);
    const lock = lockJson();
    expect(lock.files[`${BASE}/spec.json`]).toBe(sha(edited.spec));
    expect(lock.files[`${BASE}/brief.md`]).toBe(sha(edited.brief));
    expect(lock.files[`${BASE}/spec.json`]).not.toBe(before.files[`${BASE}/spec.json`]);
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
    // the committed lock is the rewritten one
    expect(JSON.parse(git("show", `HEAD:${BASE}/contract.lock.json`))).toEqual(lock);
    // the amend commit holds the amended content of every locked file, and they are clean
    expect(git("show", `HEAD:${BASE}/brief.md`)).toBe(edited.brief.trim());
    expect(git("show", `HEAD:${BASE}/spec.json`)).toBe(edited.spec.trim());
    expect(git("show", `HEAD:${BASE}/plan.json`)).toBe(edited.plan.trim());
    expect(
      git(
        "status",
        "--porcelain",
        "--",
        `${BASE}/brief.md`,
        `${BASE}/spec.json`,
        `${BASE}/plan.json`,
        `${BASE}/contract.lock.json`,
      ),
    ).toBe("");
    expect(lock.preceding_commit).toBe(lockHeadBefore);
    // ASDLC-1/AC-9: ACs/CI read the lock through its schema (needs an `amendments` property)
    expect((await validateArtifact(join(repo, BASE, "contract.lock.json"))).errors).toEqual([]);
  });

  it("ASDLC-1/AC-9 a pre-staged unrelated file never enters the amend commit", async () => {
    editLocked();
    write("src/staged.ts", "export const s = 1;\n");
    git("add", "src/staged.ts");
    await applyContractAmend(ID, input(), repo);
    expect(files("HEAD")).not.toContain("src/staged.ts");
  });

  it("ASDLC-1/AC-9 appends an amendment record (diff, reason, affected ACs, stale tasks) to lock.amendments", async () => {
    editLocked();
    await applyContractAmend(ID, input({ affected_acs: ["AC-1", "AC-3"] }), repo);
    const amendments = lockJson().amendments;
    expect(amendments).toHaveLength(1);
    expect(amendments[0]).toMatchObject({
      diff: "AC-1 criterion reworded",
      reason: "clarify AC-1",
      affected_acs: ["AC-1", "AC-3"],
      stale_task_ids: [1, 3, 4],
    });
  });

  it("ASDLC-1/AC-9 a second amend appends, never replaces, the first record", async () => {
    editLocked();
    await applyContractAmend(ID, input({ reason: "first" }), repo);
    write(`.tasks/${ID}-amend.json`, JSON.stringify({ nonce: "n0nce2" }));
    write(`${BASE}/state/contract-amend.open`, "n0nce2");
    write(`${BASE}/brief.md`, "# Brief\namended again\n");
    await applyContractAmend(ID, input({ reason: "second", affected_acs: ["AC-2"] }), repo);
    const amendments = lockJson().amendments;
    expect(amendments.map((a: { reason: string }) => a.reason)).toEqual(["first", "second"]);
    expect((await validateArtifact(join(repo, BASE, "contract.lock.json"))).errors).toEqual([]);
    expect(amendments[1].stale_task_ids).toEqual([2, 5]);
  });

  it("ASDLC-1/AC-9 stale_task_ids covers only tasks covering the affected ACs", async () => {
    editLocked();
    await applyContractAmend(ID, input({ affected_acs: ["AC-2"] }), repo);
    expect(lockJson().amendments[0].stale_task_ids).toEqual([2, 5]);
  });

  it("ASDLC-1/AC-9 regenerates spec.md from the amended spec.json", async () => {
    editLocked();
    await applyContractAmend(ID, input(), repo);
    expect(existsSync(join(repo, BASE, "spec.md"))).toBe(true);
    expect(read(`${BASE}/spec.md`)).toContain("AC-1 amended wording");
  });

  it("ASDLC-1/AC-9 clears the amend marker", async () => {
    editLocked();
    expect(isAmendOpen(ID, repo)).toBe(true);
    await applyContractAmend(ID, input(), repo);
    expect(isAmendOpen(ID, repo)).toBe(false);
    expect(existsSync(join(repo, BASE, "state", "contract-amend.open"))).toBe(false);
  });

  it("ASDLC-1/AC-9 commits as one orchestrator commit with Accord trailer outcome=amend", async () => {
    editLocked();
    const result = await applyContractAmend(ID, input(), repo);
    expect(git("rev-list", "--count", `${lockHeadBefore}..HEAD`)).toBe("1");
    expect(git("rev-parse", "HEAD~1")).toBe(lockHeadBefore);
    expect(result.hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(git("rev-parse", result.hash as string)).toBe(git("rev-parse", "HEAD"));
    const trailer = parseAccordTrailer(git("show", "-s", "--format=%B", "HEAD"));
    expect(trailer?.v).toBe(1);
    expect(trailer?.id).toBe(ID);
    expect(trailer?.outcome).toBe("amend");
    expect(git("show", "-s", "--format=%B", "HEAD")).toContain("outcome=amend");
  });

  it("ASDLC-1/AC-9 commit touches only locked files, contract.lock.json, state/** (and derived spec.md); unrelated edits stay out", async () => {
    editLocked();
    write("src/unrelated.ts", "export const x = 1;\n");
    write("README.md", "dirty\n");
    write(`${BASE}/state/note.json`, "{}\n");
    await applyContractAmend(ID, input(), repo);
    const allowed = [
      `${BASE}/brief.md`,
      `${BASE}/spec.json`,
      `${BASE}/plan.json`,
      `${BASE}/spec.md`,
      `${BASE}/contract.lock.json`,
    ];
    for (const file of files("HEAD")) {
      expect(allowed.includes(file) || file.startsWith(`${BASE}/state/`)).toBe(true);
    }
    expect(files("HEAD")).toContain(`${BASE}/spec.json`);
    expect(files("HEAD")).toContain(`${BASE}/contract.lock.json`);
    expect(files("HEAD")).not.toContain("src/unrelated.ts");
    expect(files("HEAD")).not.toContain("README.md");
  });

  it("ASDLC-1/AC-27 amend adds a commit and never rewrites history", async () => {
    editLocked();
    const countBefore = Number(git("rev-list", "--count", "HEAD"));
    await applyContractAmend(ID, input(), repo);
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(countBefore + 1);
    git("merge-base", "--is-ancestor", lockHeadBefore, "HEAD");
    expect(git("reflog", "-n", "3", "--format=%gs")).not.toMatch(/^commit \(amend\)/m);
  });

  for (const [name, reason] of [
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "   \n"],
  ] as const) {
    it(`ASDLC-1/AC-9 ${name} reason is rejected: no commit, lock and files unchanged`, async () => {
      editLocked();
      const lockBefore = read(`${BASE}/contract.lock.json`);
      const outcome = await surfaced(() =>
        applyContractAmend(ID, { diff: "d", reason, affected_acs: ["AC-1"] } as never, repo),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toMatch(/reason/i);
      expect(git("rev-parse", "HEAD")).toBe(lockHeadBefore);
      expect(read(`${BASE}/contract.lock.json`)).toBe(lockBefore);
    });
  }
});
