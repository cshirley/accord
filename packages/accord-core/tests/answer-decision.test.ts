import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateArtifact } from "@clive.shirley/accord-core/artifacts/validation.js";
import { pendingDecisionsGateMessage } from "@clive.shirley/accord-core/orchestration/pending-decisions-gate.js";
import {
  answerDecisions,
  devAnswer,
  listPendingDecisions,
  parseAnswerArgs,
  runAnswer,
} from "@clive.shirley/accord-core/queries/answer-decision.js";
import { loadWorkItem, writeJson } from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import type { Decision, WorkItem } from "@clive.shirley/accord-core/work-items/types.js";

let tempCwd: string;
let originalCwd: string;
const WI_PATH = join(".tasks", "ANS-1.json");

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-answer-"));
  process.chdir(tempCwd);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

function decision(id: string, overrides: Partial<Decision> = {}): Decision {
  return {
    id,
    source: "escalation",
    status: "pending",
    question: `question ${id}?`,
    context: "ctx",
    phase: "implementing",
    asked_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function bootstrapWithDecisions(decisions: Decision[]): void {
  devBootstrap("ANS-1", "Answer fixture", "implement", "standard");
  const wi = JSON.parse(readFileSync(WI_PATH, "utf8")) as WorkItem;
  wi.decisions = decisions;
  writeJson(WI_PATH, wi);
}

function readWi(): WorkItem {
  return JSON.parse(readFileSync(WI_PATH, "utf8")) as WorkItem;
}

describe("answerDecisions", () => {
  test("resolves a pending decision with answer + resolved_at and clears the resume gate", async () => {
    bootstrapWithDecisions([decision("phase-code-stuck-1")]);
    expect(pendingDecisionsGateMessage(readWi(), "phase-code")).not.toBeNull();

    const result = answerDecisions("ANS-1", [
      { id: "phase-code-stuck-1", answer: "  Test defect; F-007 rewritten.  " },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = readWi().decisions?.[0];
    expect(stored?.status).toBe("resolved");
    expect(stored?.answer).toBe("Test defect; F-007 rewritten.");
    expect(typeof stored?.resolved_at).toBe("string");
    expect(result.value.resolved).toEqual([{ id: "phase-code-stuck-1", previously: "pending" }]);
    expect(result.value.remaining_pending).toEqual([]);
    expect(result.value.formatted).toContain("accord resume ANS-1");
    expect(pendingDecisionsGateMessage(readWi(), "phase-code")).toBeNull();

    // resolved_at must be schema-valid (decision items are additionalProperties: false).
    const validation = await validateArtifact(join(tempCwd, WI_PATH));
    expect(validation.errors ?? []).toEqual([]);
  });

  test("answers several decisions in one call and reports what is still pending", () => {
    bootstrapWithDecisions([decision("q1"), decision("q2"), decision("q3")]);
    const result = answerDecisions("ANS-1", [
      { id: "q1", answer: "a1" },
      { id: "q3", answer: "a3" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.remaining_pending.map((d) => d.id)).toEqual(["q2"]);
    expect(result.value.formatted).toContain("`q2`");
    expect(readWi().decisions?.map((d) => d.status)).toEqual(["resolved", "pending", "resolved"]);
  });

  test("is all-or-nothing: one bad id leaves the file untouched", () => {
    bootstrapWithDecisions([decision("q1")]);
    const before = readFileSync(WI_PATH, "utf8");
    const mtimeBefore = statSync(WI_PATH).mtimeMs;

    const result = answerDecisions("ANS-1", [
      { id: "q1", answer: "a1" },
      { id: "nope", answer: "x" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("`nope` not found");
    expect(readFileSync(WI_PATH, "utf8")).toBe(before);
    expect(statSync(WI_PATH).mtimeMs).toBe(mtimeBefore);
  });

  test("rejects empty answers and duplicate ids", () => {
    bootstrapWithDecisions([decision("q1")]);
    const empty = answerDecisions("ANS-1", [{ id: "q1", answer: "   " }]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain("empty");

    const dup = answerDecisions("ANS-1", [
      { id: "q1", answer: "a" },
      { id: "q1", answer: "b" },
    ]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("more than once");
    expect(readWi().decisions?.[0].status).toBe("pending");
  });

  test("refuses to overwrite a resolved decision unless force is set", () => {
    bootstrapWithDecisions([decision("q1", { status: "resolved", answer: "old" })]);
    const refused = answerDecisions("ANS-1", [{ id: "q1", answer: "new" }]);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain("already resolved");
    expect(readWi().decisions?.[0].answer).toBe("old");

    const forced = answerDecisions("ANS-1", [{ id: "q1", answer: "new" }], { force: true });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.value.resolved).toEqual([{ id: "q1", previously: "resolved" }]);
    expect(readWi().decisions?.[0].answer).toBe("new");
  });

  test("errors on a missing work item without creating a file", () => {
    const result = answerDecisions("NOPE-1", [{ id: "q1", answer: "a" }]);
    expect(result.ok).toBe(false);
    expect(loadWorkItem("NOPE-1")).toBeNull();
  });
});

describe("listPendingDecisions", () => {
  test("lists only pending decisions", () => {
    bootstrapWithDecisions([decision("q1"), decision("q2", { status: "resolved", answer: "a" })]);
    const result = listPendingDecisions("ANS-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pending.map((d) => d.id)).toEqual(["q1"]);
    expect(result.value.formatted).toContain("accord answer ANS-1");
  });

  test("reports an empty queue", () => {
    bootstrapWithDecisions([]);
    const result = listPendingDecisions("ANS-1");
    expect(result.ok && result.value.formatted).toBe("ANS-1: no pending decisions.");
  });
});

describe("arg parsing", () => {
  test("parses id/answer pairs, --force, and lists when no pairs are given", () => {
    expect(parseAnswerArgs(["ANS-1", "q1", "use X", "q2", "no", "--force"])).toEqual({
      workItemId: "ANS-1",
      answers: [
        { id: "q1", answer: "use X" },
        { id: "q2", answer: "no" },
      ],
      force: true,
      list: false,
      errors: [],
    });
    expect(parseAnswerArgs(["ANS-1"]).list).toBe(true);
  });

  test("flags a dangling decision id and unknown flags", () => {
    expect(parseAnswerArgs(["ANS-1", "q1"]).errors).toEqual(["Decision `q1` has no answer."]);
    expect(parseAnswerArgs(["ANS-1", "--bogus"]).errors).toEqual(["Unknown flag --bogus."]);
  });

  test("runAnswer lists or answers; devAnswer honours shell-style quoting", () => {
    bootstrapWithDecisions([decision("q1"), decision("q2")]);
    const listed = runAnswer(["ANS-1"]);
    expect(listed.ok && listed.value.kind).toBe("list");

    const answered = devAnswer(`ANS-1 q1 "use the \\"new\\" method" q2 'fine'`);
    expect(answered.ok && answered.value.kind).toBe("answer");
    expect(readWi().decisions?.map((d) => d.answer)).toEqual(['use the "new" method', "fine"]);

    const usage = devAnswer("");
    expect(usage.ok).toBe(false);
  });
});
