import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AccordTrailer,
  buildCommitMessage,
} from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { prepareCloseout } from "@clive.shirley/accord-core/state/closeout.js";
import { createLeftoverStateRule } from "../src/checks/leftover-state.js";
import { evidenceRules, runEvidenceCheck } from "../src/evidence-check.js";

const ID = "ASDLC-1";
const DIR = `docs/dev/${ID}`;
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
let repo: string;

function sh(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content = "{}\n"): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}
function remove(rel: string): void {
  rmSync(join(repo, rel), { recursive: true, force: true });
}
function commit(message: string): string {
  sh("add", "-A");
  sh("commit", "-q", "--allow-empty", "-m", message);
  return sh("rev-parse", "HEAD");
}
function msg(over: Partial<AccordTrailer> = {}, summary = "commit"): string {
  return buildCommitMessage({
    summary,
    trailer: {
      v: 1,
      id: ID,
      task: 1,
      seq: 1,
      ref: "task-1",
      agent: "orchestrator",
      loop: "task",
      round: 0,
      outcome: "done",
      ...over,
    },
  });
}
/** Mirrors commit/evidence-commit.ts: ref evidence(task-N[,M]), agent harness, loop evidence, round 1, outcome done. */
function evidenceMessage(taskIds: number[], id = ID): string {
  return msg(
    {
      id,
      task: taskIds[0] as number,
      ref: `evidence(task-${taskIds.join(",")})`,
      agent: "harness",
      loop: "evidence",
      round: 1,
      outcome: "done",
    },
    "final evidence",
  );
}
/** Typed phase commit as the orchestrator makes it (T = test loop, C = code loop). */
function phaseMessage(loop: "T" | "C", task: number): string {
  return loop === "T"
    ? msg({ task, ref: `T1/phase-test`, agent: "phase-test", loop: "T", round: 1, outcome: "red" })
    : msg({
        task,
        ref: `C1/phase-code`,
        agent: "phase-code",
        loop: "C",
        round: 1,
        outcome: "done",
      });
}
/** Mirrors state/closeout.ts (ref V0/closeout, loop V, outcome closeout). */
function closeoutMessage(id = ID): string {
  return msg({
    id,
    task: 0,
    seq: 0,
    ref: "V0/closeout",
    agent: "closeout",
    loop: "V",
    outcome: "closeout",
  });
}
async function check(base: string, head = "HEAD") {
  return runEvidenceCheck([createLeftoverStateRule(repo)], { base, head });
}
async function expectPass(base: string, head = "HEAD") {
  const result = await check(base, head);
  expect(result.failures).toEqual([]);
  expect(result.exitCode).toBe(0);
}
async function expectLeftover(base: string, path: string, head = "HEAD") {
  const result = await check(base, head);
  expect(result.exitCode).toBe(1);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]?.rule).toBe("leftover-state");
  expect(result.failures[0]?.message).toContain(path);
}
/** init commit on main; returns its sha. */
function initMain(): string {
  write("README.md", "x\n");
  return commit("init");
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "leftover-state-"));
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("ASDLC-1/AC-14 leftover state rule (ASDLC-1/TC-15)", () => {
  test("rule is named leftover-state and registered in evidenceRules()", () => {
    expect(createLeftoverStateRule(repo).name).toBe("leftover-state");
    expect(evidenceRules().map((rule) => rule.name)).toContain("leftover-state");
  });

  describe("PR head", () => {
    test("passes with state/work-item.json and in-flight task state", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-3/task.json`);
      write(`${DIR}/state/task-3/STATE.md`, "# s\n");
      commit("[ASDLC-1] green task 3");
      await expectPass(base);
    });

    test("fails when state/task-<N> remains after evidence(task-<N>)", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-3/task.json`);
      commit("green task 3");
      write(`${DIR}/evidence/task-3.json`);
      write(`${DIR}/evidence/task-3.md`, "# e\n");
      commit(evidenceMessage([3]));
      await expectLeftover(base, `${DIR}/state/task-3`);
    });

    test("passes when state/task-<N> was removed by the evidence commit", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-3/task.json`);
      commit("green task 3");
      remove(`${DIR}/state/task-3`);
      write(`${DIR}/evidence/task-3.json`);
      commit(evidenceMessage([3]));
      await expectPass(base);
    });

    test("evidence for another task does not flag in-flight task state", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/evidence/task-2.json`);
      write(`${DIR}/state/task-3/task.json`);
      commit(evidenceMessage([2]));
      await expectPass(base);
    });

    test("flags only the task that has evidence", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/evidence/task-2.json`);
      write(`${DIR}/state/task-2/task.json`);
      write(`${DIR}/state/task-3/task.json`);
      commit(evidenceMessage([2]));
      const result = await check(base);
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain(`${DIR}/state/task-2`);
      expect(result.failures[0]?.message).not.toContain(`${DIR}/state/task-3`);
    });
  });

  describe("main with an open work item", () => {
    test("passes with state/ present and no closeout marker", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-1/task.json`);
      commit("[ASDLC-1] task 1");
      await expectPass(base);
    });

    test("passes with stack.commits task: trace.json already committed per task", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-1/task.json`);
      write(`${DIR}/state/task-1/trace.json`);
      commit(msg({ task: 1, ref: "task-1" }));
      write(`${DIR}/state/task-2/trace.json`);
      commit(msg({ task: 2, ref: "task-2" }));
      await expectPass(base);
    });

    test("closeout of a different work item does not flag this one", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write("docs/dev/ASDLC-2/evidence/closeout.json");
      commit(closeoutMessage("ASDLC-2"));
      await expectPass(base);
    });
  });

  describe("main with a closed-out work item", () => {
    test("fails when closeout.json exists and state/ remains", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/evidence/closeout.json`);
      commit("closeout without trailer");
      await expectLeftover(base, `${DIR}/state`);
    });

    test("fails when closeout.json exists and only state/task-* remains", async () => {
      const base = initMain();
      write(`${DIR}/state/task-4/task.json`);
      write(`${DIR}/evidence/closeout.json`);
      commit("closeout");
      await expectLeftover(base, `${DIR}/state`);
    });

    test("fails when a closeout trailer commit exists and state/ remains", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      commit(closeoutMessage());
      await expectLeftover(base, `${DIR}/state`);
    });

    test("squash simulation: trailer dropped, closeout.json still detects leftover state", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/evidence/closeout.json`);
      write(`${DIR}/evidence/task-1.json`);
      commit("ASDLC-1: closeout (#42)");
      expect(sh("log", "-1", "--format=%B")).not.toContain("Accord:");
      await expectLeftover(base, `${DIR}/state`);
    });

    test("passes after closeout removed all state/ (closeout.json present)", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-1/task.json`);
      commit("task 1");
      remove(`${DIR}/state`);
      write(`${DIR}/evidence/closeout.json`);
      commit(closeoutMessage());
      await expectPass(base);
    });

    test("passes after closeout when state/ was removed on an earlier base (base == closeout)", async () => {
      write(`${DIR}/evidence/closeout.json`);
      write(`${DIR}/evidence/task-1.json`);
      const closeout = commit(closeoutMessage());
      write("README.md", "later\n");
      commit("later work");
      await expectPass(closeout);
    });

    test("detects leftover state of a closed-out item among several work items", async () => {
      const base = initMain();
      write("docs/dev/ASDLC-2/state/work-item.json");
      write(`${DIR}/evidence/closeout.json`);
      write(`${DIR}/state/task-9/task.json`);
      commit("mixed");
      const result = await check(base);
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain(`${DIR}/state`);
      expect(result.failures[0]?.message).not.toContain("ASDLC-2");
    });
  });

  describe("real producer fixtures", () => {
    test("real evidence commit: state/task-3 remains", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/task-3/task.json`);
      commit(phaseMessage("C", 3));
      write(`${DIR}/evidence/task-3.json`);
      commit(evidenceMessage([3]));
      await expectLeftover(base, `${DIR}/state/task-3`);
    });

    test("packed evidence(task-3,4): leftover task 4 is reported, task 3 is not", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/task-3/task.json`);
      write(`${DIR}/state/task-4/task.json`);
      commit(phaseMessage("C", 3));
      remove(`${DIR}/state/task-3`);
      write(`${DIR}/evidence/task-3.json`);
      write(`${DIR}/evidence/task-4.json`);
      commit(evidenceMessage([3, 4]));
      const result = await check(base);
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain(`${DIR}/state/task-4`);
      expect(result.failures[0]?.message).not.toContain(`${DIR}/state/task-3`);
    });

    test("packed evidence(task-3,4): both removed passes", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/task-3/task.json`);
      write(`${DIR}/state/task-4/task.json`);
      commit(phaseMessage("C", 3));
      remove(`${DIR}/state/task-3`);
      remove(`${DIR}/state/task-4`);
      write(`${DIR}/evidence/task-3.json`);
      commit(evidenceMessage([3, 4]));
      await expectPass(base);
    });

    test("in-flight typed phase commits (T then C) with state/ pass", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-3/task.json`);
      commit(phaseMessage("T", 3));
      write(`${DIR}/state/task-3/STATE.md`, "# s\n");
      commit(phaseMessage("C", 3));
      await expectPass(base);
    });

    test("real closeout trailer from prepareCloseout() with state re-added and marker removed fails", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      commit("open");
      const prepared = prepareCloseout(ID, repo);
      remove(prepared.markerRel);
      write(`${DIR}/state/work-item.json`);
      commit(prepared.message);
      await expectLeftover(base, `${DIR}/state`);
    });

    test("real closeout from prepareCloseout() passes when state is removed", async () => {
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-1/task.json`);
      const base = commit("open");
      const prepared = prepareCloseout(ID, repo);
      commit(prepared.message);
      await expectPass(base);
    });
  });

  describe("state re-added after history before base", () => {
    test("A: closeout (marker + trailer) on base, state/task-5 re-added", async () => {
      initMain();
      write(`${DIR}/evidence/closeout.json`);
      const base = commit(closeoutMessage());
      write(`${DIR}/state/task-5/task.json`);
      commit("re-add");
      await expectLeftover(base, `${DIR}/state`);
    });

    test("B: closeout trailer only on base (no marker), state/work-item.json added", async () => {
      initMain();
      const base = commit(closeoutMessage());
      write(`${DIR}/state/work-item.json`);
      commit("re-add");
      await expectLeftover(base, `${DIR}/state`);
    });

    test("C: closeout.json and state/work-item.json already on base, unrelated edit", async () => {
      initMain();
      write(`${DIR}/evidence/closeout.json`);
      write(`${DIR}/state/work-item.json`);
      const base = commit("closeout without trailer");
      write("README.md", "unrelated\n");
      commit("edit");
      await expectLeftover(base, `${DIR}/state`);
    });

    test("D: evidence(task-3) on base removed state/task-3, then re-added", async () => {
      initMain();
      write(`${DIR}/state/task-3/task.json`);
      commit(phaseMessage("C", 3));
      remove(`${DIR}/state/task-3`);
      write(`${DIR}/evidence/task-3.json`);
      const base = commit(evidenceMessage([3]));
      write(`${DIR}/state/task-3/task.json`);
      commit("re-add");
      await expectLeftover(base, `${DIR}/state/task-3`);
    });

    test("E: evidence(task-3) then re-add inside the checked range", async () => {
      const base = initMain();
      write(`${DIR}/state/task-3/task.json`);
      commit(phaseMessage("C", 3));
      remove(`${DIR}/state/task-3`);
      write(`${DIR}/evidence/task-3.json`);
      commit(evidenceMessage([3]));
      write(`${DIR}/state/task-3/task.json`);
      commit("re-add");
      await expectLeftover(base, `${DIR}/state/task-3`);
    });
  });

  describe("trace.json is not a closeout signal", () => {
    test("work-item-root trace.json and trace.md with state/ and a per-task commit pass", async () => {
      const base = initMain();
      write(`${DIR}/state/work-item.json`);
      write(`${DIR}/state/task-1/task.json`);
      write(`${DIR}/trace.json`);
      write(`${DIR}/trace.md`, "# t\n");
      commit("[ASDLC-1] Task 1: title");
      await expectPass(base);
    });
  });

  describe("in-flight state allowed", () => {
    test("task-1 evidence does not flag state/task-12 (prefix)", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/task-12/task.json`);
      write(`${DIR}/evidence/task-1.json`);
      commit(evidenceMessage([1]));
      await expectPass(base);
    });

    test("task-1 evidence flags state/task-1 but not state/task-12", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/task-1/task.json`);
      write(`${DIR}/state/task-12/task.json`);
      write(`${DIR}/evidence/task-1.json`);
      commit(evidenceMessage([1]));
      const result = await check(base);
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toMatch(/docs\/dev\/ASDLC-1\/state\/task-1(?!\d)/);
      expect(result.failures[0]?.message).not.toContain("state/task-12");
    });

    test("evidence of another work item with the same task number does not flag", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write("docs/dev/ASDLC-2/evidence/task-3.json");
      write(`${DIR}/state/task-3/task.json`);
      commit(evidenceMessage([3], "ASDLC-2"));
      await expectPass(base);
    });

    test("malformed Accord line in unrelated history does not fail an open work item", async () => {
      const base = initMain();
      write("README.md", "y\n");
      commit("unrelated\n\nAccord: not-a-pair");
      write(`${DIR}/state/work-item.json`);
      commit("[ASDLC-1] open");
      await expectPass(base);
    });
  });

  describe("head and work tree are independent", () => {
    test("leftover at a head SHA that is not checked out is detected", async () => {
      const base = initMain();
      sh("checkout", "-q", "-b", "pr");
      write(`${DIR}/state/task-3/task.json`);
      write(`${DIR}/evidence/task-3.json`);
      const prHead = commit(evidenceMessage([3]));
      sh("checkout", "-q", "main");
      await expectLeftover(base, `${DIR}/state/task-3`, prHead);
    });

    test("untracked closeout.json and state/ in the work tree are ignored", async () => {
      const base = initMain();
      write(`${DIR}/evidence/closeout.json`);
      write(`${DIR}/state/work-item.json`);
      await expectPass(base);
    });
  });

  describe("state/ shapes after closeout", () => {
    test.each([`${DIR}/state/STATE.md`, `${DIR}/state/misc/notes.txt`])(
      "fails with %s",
      async (file) => {
        const base = initMain();
        write(file, "x\n");
        write(`${DIR}/evidence/closeout.json`);
        commit("closeout");
        await expectLeftover(base, `${DIR}/state`);
      },
    );
  });

  test("registered rule run by the evidence-check CLI fails on leftover state", async () => {
    const base = initMain();
    write(`${DIR}/evidence/closeout.json`);
    write(`${DIR}/state/work-item.json`);
    commit("closeout");
    const proc = Bun.spawnSync(
      [
        process.execPath,
        join(REPO_ROOT, "packages/accord-ci/src/evidence-check.ts"),
        "--base",
        base,
        "--head",
        "HEAD",
      ],
      { cwd: repo },
    );
    const out = proc.stdout.toString();
    expect(proc.exitCode).toBe(1);
    expect(out).toContain("accord/evidence: leftover-state:");
    expect(out).toContain(`${DIR}/state`);
  });

  test("repository without docs/dev passes", async () => {
    const base = initMain();
    write("README.md", "y\n");
    commit("edit");
    await expectPass(base);
  });
});

describe("ASDLC-1/AC-31 docs for accord-ci change", () => {
  test("docs/ci/pre-merge-smoke.md documents the leftover-state rule", () => {
    const doc = readFileSync(join(REPO_ROOT, "docs/ci/pre-merge-smoke.md"), "utf8");
    const start = doc.indexOf("## accord/evidence");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = doc.slice(start + 3);
    const next = rest.indexOf("\n## ");
    const section = next < 0 ? rest : rest.slice(0, next);
    for (const needle of [
      "leftover-state",
      "packages/accord-ci/src/checks/leftover-state.ts",
      "outcome=closeout",
      "closeout.json",
      "state/task-",
      "evidence(task-",
      "bun test packages/accord-ci/tests/evidence-check.test.ts",
    ]) {
      expect(section).toContain(needle);
    }
  });
});
