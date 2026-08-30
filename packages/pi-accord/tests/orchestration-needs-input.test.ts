import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyInterviewNeedsInputPostResult } from "../src/core/orchestration/post-result/needs-input.js";
import { applyPhaseSpecPostResult } from "../src/core/orchestration/post-result/phase-spec.js";
import { buildInterviewResumeTaskIfApplicable } from "../src/core/orchestration/resolve/interview-task.js";
import { postSpawnReplanDecision } from "../src/core/orchestration/spawn-followup.js";

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-needs-input-"));
  process.chdir(tempCwd);
  mkdirSync(join(tempCwd, ".tasks"), { recursive: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function writeWorkItem(id: string, body: Record<string, unknown>) {
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

describe("phase-spec needs_input handoff", () => {
  test("postSpawnReplanDecision stops on phase-spec needs_input", () => {
    expect(
      postSpawnReplanDecision(
        {
          status: "needs_input",
          draft: {},
          questions: [{ id: "q_problem_1", topic: "problem", text: "What is the core problem?" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        },
        "phase-spec",
      ),
    ).toBe("stop");
  });

  test("applyInterviewNeedsInputPostResult writes checkpoint and surfaces questions", () => {
    writeWorkItem("SPEC-1", {
      schema_version: "1.0",
      id: "SPEC-1",
      title: "Spec interview",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "speccing",
      brief: "docs/dev/SPEC-1/brief.md",
      spec: null,
      plan: null,
      verify: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });

    const packet = {
      status: "needs_input",
      draft: { problem_statement: "partial" },
      questions: [
        { id: "q_problem_1", topic: "problem", text: "Confirm the problem statement?" },
        { id: "q_scope_1", topic: "scope", text: "Anything explicitly out of scope?" },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const markdown = applyInterviewNeedsInputPostResult("SPEC-1", "phase-spec", "speccing", packet);

    expect(markdown).toContain("phase-spec needs your input");
    expect(markdown).toContain("q_problem_1");
    expect(markdown).toContain("Confirm the problem statement?");

    const cpPath = join(".tasks", "SPEC-1-checkpoint.json");
    expect(existsSync(cpPath)).toBe(true);
    const cp = JSON.parse(readFileSync(cpPath, "utf8"));
    expect(cp.phase).toBe("speccing");
    expect(cp.pending).toEqual(["q_problem_1", "q_scope_1"]);
    expect(cp.draft).toEqual({ problem_statement: "partial" });

    const wi = JSON.parse(readFileSync(join(".tasks", "SPEC-1.json"), "utf8"));
    expect(wi.decisions.length).toBe(2);
    expect(wi.decisions[0].status).toBe("pending");
    expect(wi.decisions[0].source).toBe("spec");
  });

  test("applyPhaseSpecPostResult delegates needs_input without requiring done", () => {
    writeWorkItem("SPEC-2", {
      schema_version: "1.0",
      id: "SPEC-2",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "speccing",
      brief: "docs/dev/SPEC-2/brief.md",
      spec: null,
      plan: null,
      verify: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });

    const out = applyPhaseSpecPostResult("SPEC-2", {
      status: "needs_input",
      draft: {},
      questions: [{ id: "q1", topic: "problem", text: "Question one?" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    expect(out).toContain("needs your input");
    expect(existsSync(join(".tasks", "SPEC-2-checkpoint.json"))).toBe(true);
  });

  test("buildInterviewResumeTaskIfApplicable inlines checkpoint draft and answered", () => {
    writeWorkItem("SPEC-3", {
      schema_version: "1.0",
      id: "SPEC-3",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "speccing",
      brief: "docs/dev/SPEC-3/brief.md",
      spec: null,
      plan: null,
      verify: null,
      task_ids: [],
      decisions: [
        {
          id: "q1",
          source: "spec",
          status: "resolved",
          question: "q",
          answer: "answered value",
          phase: "speccing",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      deviations: [],
      cost_usd: 0,
    });

    writeFileSync(
      join(".tasks", "SPEC-3-checkpoint.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "SPEC-3",
        phase: "speccing",
        draft: { problem_statement: "from checkpoint" },
        answered: [],
        pending: ["q2"],
      })}\n`,
      "utf8",
    );

    const task = buildInterviewResumeTaskIfApplicable({
      workItemId: "SPEC-3",
      phase: "speccing",
      title: "t",
      pattern: "implement",
      variant: "standard",
      dispatchAgent: "phase-spec",
    });

    expect(task).toContain("brief_path: docs/dev/SPEC-3/brief.md");
    expect(task).toContain("from checkpoint");
    expect(task).toContain('"q1": "answered value"');
    expect(task).toContain("pending question ids: q2");
  });
});
