import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildCommitMessage } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { applyContractAmend } from "@clive.shirley/accord-core/contract/amend.js";
import { hashLocked, writeContractLock } from "@clive.shirley/accord-core/contract/lock.js";
import { createContractLockRule } from "../src/checks/contract-lock.js";
import { evidenceRules, runEvidenceCheck } from "../src/evidence-check.js";

const ID = "ASDLC-1";
const BASE_DIR = `docs/dev/${ID}`;
const SPEC_V1 = `${JSON.stringify({ id: "spec", acceptance_criteria: [{ id: "AC-1" }] }, null, 2)}\n`;
const SPEC_V2 = `${JSON.stringify({ id: "spec", acceptance_criteria: [{ id: "AC-1" }, { id: "AC-2" }] }, null, 2)}\n`;
const SPEC_V3 = `${JSON.stringify({ id: "spec", acceptance_criteria: [{ id: "AC-3" }] }, null, 2)}\n`;
const PLAN_V2 = `${JSON.stringify(
  {
    schema_version: "1.0",
    work_item_id: ID,
    tasks: [
      { id: 1, title: "t", covers_ac: ["AC-1"] },
      { id: 2, title: "t2", covers_ac: ["AC-1"] },
    ],
  },
  null,
  2,
)}\n`;
const PLAN_GUIDANCE = `${JSON.stringify({ schema_version: "1.0", work_item_id: ID, tasks: [{ id: 1, title: "t", covers_ac: ["AC-1"] }], guidance: [{ directive: "as-built", source: "review-deviation" }] }, null, 2)}\n`;
// Spec shape renderSpecMarkdown accepts (used with the real applyContractAmend producer).
const SPEC_REAL_V1 = `${JSON.stringify({ id: "spec", title: "Spec", acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "constraint", criterion: "one" }] }, null, 2)}\n`;
const SPEC_REAL_V2 = `${JSON.stringify({ id: "spec", title: "Spec", acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "constraint", criterion: "one reworded" }] }, null, 2)}\n`;
const PLAN = `${JSON.stringify({ schema_version: "1.0", work_item_id: ID, tasks: [{ id: 1, title: "t", covers_ac: ["AC-1"] }] }, null, 2)}\n`;

let repo: string;

function sh(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content: string): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
function commit(message: string, ...files: string[]): string {
  sh("add", "-A", "--", ...(files.length > 0 ? files : ["."]));
  sh("commit", "-q", "-m", message);
  return sh("rev-parse", "HEAD");
}
type AmendShape = "orchestrator" | "harness";
const SHAPES: Record<AmendShape, { ref: string; agent: string; loop: string; round: number }> = {
  orchestrator: { ref: "C0", agent: "orchestrator", loop: "contract", round: 1 },
  // Shape produced by the real applyContractAmend.
  harness: { ref: "contract-amend", agent: "harness", loop: "amend", round: 0 },
};
function amendMessage(id = ID, outcome = "amend", shape: AmendShape = "orchestrator"): string {
  return buildCommitMessage({
    summary: "contract amend",
    trailer: { v: 1, id, task: 0, seq: 1, ...SHAPES[shape], outcome },
  });
}
/** Rewrites the lock to match current locked files and appends a hand-written amendment record. */
async function relock(): Promise<void> {
  const lock = await writeContractLock(ID, repo);
  write(
    `${BASE_DIR}/contract.lock.json`,
    `${JSON.stringify({ ...lock, amendments: [{ diff: "d", reason: "r", affected_acs: ["AC-1"], stale_task_ids: [1], at: "2026-01-01T00:00:00.000Z" }] }, null, 2)}\n`,
  );
}
function addLockedFiles(spec = SPEC_V1): void {
  write(`${BASE_DIR}/brief.md`, "# Brief\n");
  write(`${BASE_DIR}/spec.json`, spec);
  write(`${BASE_DIR}/plan.json`, PLAN);
  write(`${BASE_DIR}/state/work-item.json`, '{"state":1}\n');
}
async function addLock(): Promise<string> {
  await writeContractLock(ID, repo);
  return commit(`[${ID}][task-0] PR0: contract lock`);
}
/** main = init + locked files + lock commit. Returns main sha; leaves HEAD on branch `pr`. */
async function mainWithLock(spec = SPEC_V1): Promise<string> {
  commit("init", "README.md");
  addLockedFiles(spec);
  commit("add contract files");
  await addLock();
  const main = sh("rev-parse", "HEAD");
  sh("checkout", "-q", "-b", "pr");
  return main;
}
const specFailure = () => [
  { rule: "contract-lock", message: expect.stringContaining(`${BASE_DIR}/spec.json`) },
];
async function check(base: string, headSha?: string) {
  const head = headSha ?? sh("rev-parse", "HEAD");
  const rule = createContractLockRule(repo);
  return runEvidenceCheck([rule], { base, head });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "contract-lock-check-"));
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
  write("README.md", "x\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("ASDLC-1/AC-9 contract-lock rule registration", () => {
  test("ASDLC-1/AC-9 evidenceRules() registers a rule named contract-lock", () => {
    expect(evidenceRules().map((rule) => rule.name)).toContain("contract-lock");
  });
  test("ASDLC-1/AC-9 createContractLockRule(cwd) yields a rule named contract-lock", () => {
    expect(createContractLockRule(repo).name).toBe("contract-lock");
  });
});

describe("ASDLC-1/AC-9 locked-file edits without a contract-amend fail", () => {
  test("ASDLC-1/AC-9 non-amend commit after the lock editing spec.json fails and names the file", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("edit spec");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rule).toBe("contract-lock");
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/spec.json`);
  });

  for (const file of ["brief.md", "plan.json"]) {
    test(`ASDLC-1/AC-9 non-amend edit of ${file} fails`, async () => {
      const main = await mainWithLock();
      write(`${BASE_DIR}/${file}`, file === "brief.md" ? "# changed\n" : PLAN_V2);
      commit(`edit ${file}`);
      const result = await check(main);
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain(`${BASE_DIR}/${file}`);
    });
  }

  test("ASDLC-1/AC-9 non-amend deletion of a locked file fails", async () => {
    const main = await mainWithLock();
    rmSync(join(repo, BASE_DIR, "brief.md"));
    commit("delete brief");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/brief.md`);
  });

  test("ASDLC-1/AC-9 unrelated edits and state/work-item.json edits (not locked) pass", async () => {
    const main = await mainWithLock();
    write("src/x.ts", "export const x = 1;\n");
    write(`${BASE_DIR}/state/work-item.json`, '{"state":2}\n');
    commit("feature work");
    const result = await check(main);
    expect(result).toEqual({ exitCode: 0, lines: [], failures: [] });
  });

  test("ASDLC-1/AC-9 failure line uses the 'accord/evidence: contract-lock: ' format", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("edit spec");
    const result = await check(main);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.startsWith("accord/evidence: contract-lock: ")).toBe(true);
  });
});

describe("ASDLC-1/AC-9 orchestrator amend commit passes only when well-formed", () => {
  for (const shape of ["orchestrator", "harness"] as const) {
    test(`ASDLC-1/AC-9 amend commit touching locked file, lock and state/** passes (${shape} trailer shape)`, async () => {
      const main = await mainWithLock();
      write(`${BASE_DIR}/spec.json`, SPEC_V2);
      await relock();
      write(`${BASE_DIR}/state/contract-amend.open`, "n\n");
      commit(amendMessage(ID, "amend", shape));
      const result = await check(main);
      expect(result).toEqual({ exitCode: 0, lines: [], failures: [] });
    });
  }

  test("ASDLC-1/AC-9 commit produced by the real applyContractAmend (incl. spec.md) passes", async () => {
    const main = await mainWithLock(SPEC_REAL_V1);
    write(`${BASE_DIR}/spec.json`, SPEC_REAL_V2);
    const amended = await applyContractAmend(
      ID,
      { diff: "d", reason: "r", affected_acs: ["AC-1"] },
      repo,
    );
    expect(amended.ok).toBe(true);
    expect(
      sh("show", "--name-only", "--pretty=format:", "HEAD").split("\n").filter(Boolean),
    ).toContain(`${BASE_DIR}/spec.md`);
    expect(await check(main)).toEqual({ exitCode: 0, lines: [], failures: [] });
  });

  test("ASDLC-1/AC-9 valid amend commit that also adds evidence/task-1.md fails naming that path", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    write(`${BASE_DIR}/evidence/task-1.md`, "# e\n");
    commit(amendMessage());
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual([
      {
        rule: "contract-lock",
        message: expect.stringContaining(`${BASE_DIR}/evidence/task-1.md`),
      },
    ]);
  });

  test("ASDLC-1/AC-9 amend-trailer commit editing spec.json but leaving the lock stale fails", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit(amendMessage());
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 amend-trailer commit with rewritten hashes but no amendment record fails", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await writeContractLock(ID, repo);
    commit(amendMessage());
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 amend commit that also touches an unrelated file fails", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    write("src/sneaky.ts", "export const s = 1;\n");
    commit(amendMessage());
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain("src/sneaky.ts");
  });

  test("ASDLC-1/AC-9 amend trailer for a different work item does not legitimise the edit", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit(amendMessage("OTHER-9"));
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/spec.json`);
  });

  test("ASDLC-1/AC-9 trailer with outcome other than amend does not legitimise the edit", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit(amendMessage(ID, "green"));
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 'outcome=amend' text in the commit body but not the Accord trailer does not legitimise", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit(`[${ID}][task-0] C0: edit\n\noutcome=amend id=${ID}`);
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 non-amend locked edit followed by a valid amend in the same PR still fails", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("sneaky unreviewed spec edit");
    write(`${BASE_DIR}/spec.json`, SPEC_V3);
    await relock();
    commit(amendMessage());
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/spec.json`);
  });
});

describe("ASDLC-1/AC-9 forged lock", () => {
  test("ASDLC-1/AC-9 matching hashes plus hand-written amendment record in a non-amend commit fails", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit("forged: lock updated by hand");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/spec.json`);
  });
});

describe("ASDLC-1/AC-9 scope: only base..head after the lock commit; base records trusted", () => {
  test("ASDLC-1/AC-9 PR0's own PR (adds locked files and the lock) passes", async () => {
    commit("init", "README.md");
    const main = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "pr0");
    addLockedFiles();
    commit("PR0: contract files");
    await addLock();
    const result = await check(main);
    expect(result).toEqual({ exitCode: 0, lines: [], failures: [] });
  });

  test("ASDLC-1/AC-9 PR0 with locked-file edits before the lock commit passes (only later commits are checked)", async () => {
    commit("init", "README.md");
    const main = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "pr0");
    addLockedFiles();
    commit("PR0: contract files");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("PR0: refine spec before lock");
    await addLock();
    const result = await check(main);
    expect(result).toEqual({ exitCode: 0, lines: [], failures: [] });
  });

  test("ASDLC-1/AC-9 PR0 with a non-amend locked edit after the lock commit fails", async () => {
    commit("init", "README.md");
    const main = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "pr0");
    addLockedFiles();
    commit("PR0: contract files");
    await addLock();
    write(`${BASE_DIR}/plan.json`, PLAN_V2);
    commit("late plan edit");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/plan.json`);
  });

  test("ASDLC-1/AC-9 squash-merged amend (no trailer on main) is trusted on later PRs that leave locked files alone", async () => {
    const main = await mainWithLock();
    sh("checkout", "-q", "main");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit("squash: amend contract (#12)");
    const newMain = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "later");
    write("src/y.ts", "export const y = 1;\n");
    commit("later feature work");
    const result = await check(newMain);
    expect(result).toEqual({ exitCode: 0, lines: [], failures: [] });
    expect(newMain).not.toBe(main);
  });

  test("ASDLC-1/AC-9 after a squash-merged amend, a non-amend edit of a locked file still fails", async () => {
    await mainWithLock();
    sh("checkout", "-q", "main");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit("squash: amend contract (#12)");
    const newMain = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "later");
    write(`${BASE_DIR}/spec.json`, SPEC_V3);
    commit("later spec edit");
    const result = await check(newMain);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/spec.json`);
  });

  test("ASDLC-1/AC-9 an amend trailer on a commit already on the base does not legitimise a later non-amend edit", async () => {
    await mainWithLock();
    sh("checkout", "-q", "main");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit(amendMessage());
    const newMain = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "later");
    write(`${BASE_DIR}/spec.json`, SPEC_V3);
    commit("later spec edit");
    const result = await check(newMain);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 accord/<ID>/contract tag is informational: absent tag passes, never required", async () => {
    const main = await mainWithLock();
    expect(sh("tag", "-l", `accord/${ID}/contract`)).toBe("");
    write("src/x.ts", "export const x = 1;\n");
    commit("feature work");
    const result = await check(main);
    expect(result.exitCode).toBe(0);
    expect(sh("tag", "-l")).toBe("");
  });

  test("ASDLC-1/AC-9 a tag on the lock commit does not excuse a non-amend locked edit", async () => {
    const main = await mainWithLock();
    sh("tag", `accord/${ID}/contract`, main);
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("edit spec");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });
});

describe("ASDLC-1/AC-9 repos without contract.lock.json", () => {
  test("ASDLC-1/AC-9 repo with no lock passes even when docs/dev files change", async () => {
    commit("init", "README.md");
    addLockedFiles();
    commit("contract files, no lock");
    const base = sh("rev-parse", "HEAD");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("edit spec");
    expect(existsSync(join(repo, BASE_DIR, "contract.lock.json"))).toBe(false);
    const result = await check(base);
    expect(result).toEqual({ exitCode: 0, lines: [], failures: [] });
    expect(readFileSync(join(repo, BASE_DIR, "spec.json"), "utf8")).toBe(SPEC_V2);
  });
});

describe("ASDLC-1/AC-9 renames, merges and changes to the lock itself", () => {
  test("ASDLC-1/AC-9 renaming a locked file away fails naming the old path", async () => {
    const main = await mainWithLock();
    sh("mv", `${BASE_DIR}/brief.md`, `${BASE_DIR}/brief-old.md`);
    commit("rename brief");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.rule).toBe("contract-lock");
    expect(result.failures[0]?.message).toContain(`${BASE_DIR}/brief.md`);
  });

  test("ASDLC-1/AC-9 locked file edited during merge resolution (evil merge) fails", async () => {
    const main = await mainWithLock();
    sh("checkout", "-q", "-b", "side", main);
    write("src/a.ts", "export const a = 1;\n");
    commit("side work");
    sh("checkout", "-q", "pr");
    sh("merge", "--no-ff", "--no-commit", "side");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    sh("add", "-A");
    sh("commit", "-q", "-m", "merge side");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 benign merge of an updated main (squash amend on main) passes", async () => {
    await mainWithLock();
    write("src/x.ts", "export const x = 1;\n");
    commit("pr work");
    sh("checkout", "-q", "main");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    commit("squash: amend contract (#12)");
    const newMain = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "pr");
    sh("merge", "--no-ff", "-m", "merge main", "main");
    expect(await check(newMain)).toEqual({ exitCode: 0, lines: [], failures: [] });
  });

  const lockCases: Array<{
    name: string;
    run: () => Promise<void>;
    path: string;
  }> = [
    {
      name: "drop lock and edit spec in one commit",
      path: `${BASE_DIR}/spec.json`,
      run: async () => {
        rmSync(join(repo, BASE_DIR, "contract.lock.json"));
        write(`${BASE_DIR}/spec.json`, SPEC_V2);
        commit("drop lock");
      },
    },
    {
      name: "drop the lock only",
      path: `${BASE_DIR}/contract.lock.json`,
      run: async () => {
        rmSync(join(repo, BASE_DIR, "contract.lock.json"));
        commit("drop lock");
      },
    },
    {
      name: "corrupt the lock and edit spec",
      path: `${BASE_DIR}/spec.json`,
      run: async () => {
        write(`${BASE_DIR}/contract.lock.json`, "not json");
        write(`${BASE_DIR}/spec.json`, SPEC_V2);
        commit("corrupt lock");
      },
    },
    {
      name: "drop lock + edit spec, then re-lock in a later commit",
      path: `${BASE_DIR}/spec.json`,
      run: async () => {
        rmSync(join(repo, BASE_DIR, "contract.lock.json"));
        write(`${BASE_DIR}/spec.json`, SPEC_V2);
        commit("drop lock and edit");
        await writeContractLock(ID, repo);
        commit("re-lock");
      },
    },
  ];
  for (const lockCase of lockCases) {
    test(`ASDLC-1/AC-9 lock tampering fails: ${lockCase.name}`, async () => {
      const main = await mainWithLock();
      await lockCase.run();
      const result = await check(main);
      expect(result.exitCode).toBe(1);
      expect(result.failures).toEqual([
        { rule: "contract-lock", message: expect.stringContaining(lockCase.path) },
      ]);
    });
  }

  test("ASDLC-1/AC-9 PR0 branch: late spec edit then re-lock in a non-amend commit fails", async () => {
    commit("init", "README.md");
    const main = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "pr0");
    addLockedFiles();
    commit("PR0: contract files");
    await addLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("late edit");
    await writeContractLock(ID, repo);
    commit("relock");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  for (const withTrailer of [false, true]) {
    test(`ASDLC-1/AC-9 real PR0 shape (files and lock in one commit${withTrailer ? ", outcome=locked trailer" : ""}) passes`, async () => {
      commit("init", "README.md");
      const main = sh("rev-parse", "HEAD");
      sh("checkout", "-q", "-b", "pr0");
      addLockedFiles();
      await writeContractLock(ID, repo);
      commit(
        withTrailer
          ? buildCommitMessage({
              summary: "contract PR0",
              trailer: {
                v: 1,
                id: ID,
                task: 0,
                seq: 1,
                ref: "contract-pr0",
                agent: "harness",
                loop: "contract",
                round: 0,
                outcome: "locked",
              },
            })
          : "PR0: contract and lock",
      );
      expect(await check(main)).toEqual({ exitCode: 0, lines: [], failures: [] });
    });
  }
});

describe("ASDLC-1/AC-9 plan.json hashing follows core lock semantics", () => {
  test("ASDLC-1/AC-9 fixture PLAN_V2 changes the locked hash (guard for the plan edit tests)", async () => {
    await mainWithLock();
    const before = hashLocked(`${BASE_DIR}/plan.json`, repo);
    write(`${BASE_DIR}/plan.json`, PLAN_V2);
    expect(hashLocked(`${BASE_DIR}/plan.json`, repo)).not.toBe(before);
  });

  test("ASDLC-1/AC-9 guidance-only plan.json change keeps the lock hash and passes (as-built guidance)", async () => {
    const main = await mainWithLock();
    const before = hashLocked(`${BASE_DIR}/plan.json`, repo);
    write(`${BASE_DIR}/plan.json`, PLAN_GUIDANCE);
    expect(hashLocked(`${BASE_DIR}/plan.json`, repo)).toBe(before);
    commit("as-built guidance");
    expect(await check(main)).toEqual({ exitCode: 0, lines: [], failures: [] });
  });
});

describe("ASDLC-1/AC-9 several locked work items", () => {
  async function mainWithTwoLocks(): Promise<string> {
    commit("init", "README.md");
    addLockedFiles();
    write("docs/dev/OTHER-2/brief.md", "# o\n");
    write("docs/dev/OTHER-2/spec.json", SPEC_V1);
    write("docs/dev/OTHER-2/plan.json", PLAN);
    commit("contract files");
    await writeContractLock(ID, repo);
    await writeContractLock("OTHER-2", repo);
    commit("locks");
    const main = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "-b", "pr");
    return main;
  }

  test("ASDLC-1/AC-9 non-amend edit of another work item's locked spec fails", async () => {
    const main = await mainWithTwoLocks();
    write("docs/dev/OTHER-2/spec.json", SPEC_V2);
    commit("edit other spec");
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain("docs/dev/OTHER-2/spec.json");
  });

  test("ASDLC-1/AC-9 a valid ASDLC-1 amend commit cannot also edit OTHER-2's locked spec", async () => {
    const main = await mainWithTwoLocks();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    await relock();
    write("docs/dev/OTHER-2/spec.json", SPEC_V2);
    commit(amendMessage());
    const result = await check(main);
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain("docs/dev/OTHER-2/spec.json");
  });

  test("ASDLC-1/AC-9 edit under a work item with no lock passes", async () => {
    const main = await mainWithTwoLocks();
    write("docs/dev/OTHER-3/spec.json", SPEC_V2);
    commit("unlocked work item");
    expect(await check(main)).toEqual({ exitCode: 0, lines: [], failures: [] });
  });
});

describe("ASDLC-1/AC-9 head is the commit range, not the working tree; fail closed", () => {
  test("ASDLC-1/AC-9 failing head is detected while a different commit is checked out", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("edit spec");
    const head = sh("rev-parse", "HEAD");
    sh("checkout", "-q", "main");
    const result = await check(main, head);
    expect(result.exitCode).toBe(1);
    expect(result.failures).toEqual(specFailure());
  });

  test("ASDLC-1/AC-9 clean head passes even when the working tree holds an uncommitted locked edit", async () => {
    const main = await mainWithLock();
    write("src/x.ts", "export const x = 1;\n");
    commit("feature");
    const head = sh("rev-parse", "HEAD");
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    expect(await check(main, head)).toEqual({ exitCode: 0, lines: [], failures: [] });
  });

  test("ASDLC-1/AC-9 unresolvable base fails closed", async () => {
    await mainWithLock();
    const head = sh("rev-parse", "HEAD");
    const result = await runEvidenceCheck([createContractLockRule(repo)], {
      base: "1".repeat(40),
      head,
    });
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.rule).toBe("contract-lock");
  });

  test("ASDLC-1/AC-9 unresolvable head fails closed", async () => {
    const main = await mainWithLock();
    const result = await runEvidenceCheck([createContractLockRule(repo)], {
      base: main,
      head: "2".repeat(40),
    });
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.rule).toBe("contract-lock");
  });

  test("ASDLC-1/AC-9 default registry via the bun entry point exits 1 naming spec.json and posts a failure status", async () => {
    const main = await mainWithLock();
    write(`${BASE_DIR}/spec.json`, SPEC_V2);
    commit("edit spec");
    const head = sh("rev-parse", "HEAD");
    const out = join(repo, "..", `${repo.split("/").pop()}-status.json`);
    const proc = Bun.spawnSync(
      [
        "bun",
        join(import.meta.dir, "..", "src", "evidence-check.ts"),
        "--base",
        main,
        "--head",
        head,
        "--status-out",
        out,
      ],
      { cwd: repo },
    );
    try {
      expect(proc.exitCode).toBe(1);
      const stdout = proc.stdout.toString();
      expect(stdout).toContain("accord/evidence: contract-lock: ");
      expect(stdout).toContain(`${BASE_DIR}/spec.json`);
      expect(JSON.parse(readFileSync(out, "utf8")).state).toBe("failure");
    } finally {
      rmSync(out, { force: true });
    }
  });
});

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("ASDLC-1/AC-31 docs and okf describe the contract-lock rule", () => {
  // Enforcement of validate:okf, validate:ste and check:biome belongs to phase-verify-task.
  test("ASDLC-1/AC-31 pre-merge-smoke.md accord/evidence section documents the contract-lock rule", () => {
    const doc = readFileSync(join(ROOT, "docs", "ci", "pre-merge-smoke.md"), "utf8");
    const section = doc.split(/^## /m).find((part) => part.startsWith("accord/evidence")) ?? "";
    expect(section).toContain("contract-lock");
    expect(section).toContain("contract.lock.json");
    expect(section).toContain("bun test packages/accord-ci/tests/contract-lock-check.test.ts");
  });

  test("ASDLC-1/AC-31 okf/log.md has a dated (>= 2026-10-06) entry naming contract-lock and accord/evidence", () => {
    const log = readFileSync(join(ROOT, "okf/log.md"), "utf8");
    const parts = log.split(/^## (\d{4}-\d{2}-\d{2})$/m);
    const dates: string[] = [];
    for (let index = 1; index < parts.length; index += 2) {
      const body = parts[index + 1] ?? "";
      if (
        /^\* \*\*[A-Za-z]+\*\*:.*contract-lock.*accord\/evidence|^\* \*\*[A-Za-z]+\*\*:.*accord\/evidence.*contract-lock/m.test(
          body,
        )
      ) {
        dates.push(parts[index] as string);
      }
    }
    expect(dates.some((date) => date >= "2026-10-06")).toBe(true);
  });

  test("ASDLC-1/AC-31 an okf concept listing evidence-check.ts as a source describes contract-lock", () => {
    const dir = join(ROOT, "okf");
    const hits = [...new Bun.Glob("**/*.md").scanSync({ cwd: dir })].filter((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const front = text.split(/^---$/m)[1] ?? "";
      const body = text.split(/^---$/m).slice(2).join("---");
      return (
        front.includes("resource: /packages/accord-ci/src/evidence-check.ts") &&
        body.includes("contract-lock")
      );
    });
    expect(hits.length).toBeGreaterThan(0);
  });
});
