import { describe, expect, test } from "bun:test";

import { dispatchTerminal, type TerminalOpts } from "../../scripts/ci/parse-phase-result.js";

const OPTS: TerminalOpts = {
  ticket: "PROJ-1",
  secrets: [],
  transitions: {
    needs_input: "Needs Author Input",
    blocked: "Blocked",
    gaps: "Gaps Reported",
    stuck: "Stuck",
    cost_exceeded: "Cost Exceeded",
    in_review: "In Review",
  },
};

describe("dispatchTerminal — needs_input (AC-4)", () => {
  test("returns a `comment` action with question id/topic/text verbatim", () => {
    const r = dispatchTerminal(
      {
        status: "needs_input",
        questions: [
          { id: "q1", topic: "scope", text: "Should we include cross-region replication?" },
          { id: "q2", topic: "rate", text: "Is 60 req/min the right default?" },
        ],
      },
      OPTS,
    );
    expect(r.kind).toBe("comment");
    expect(r.transition).toBe("Needs Author Input");
    expect(r.uploadStateArtifact).toBe(true);
    expect(r.body).toContain("q1");
    expect(r.body).toContain("scope");
    expect(r.body).toContain("Should we include cross-region replication?");
    expect(r.body).toContain("q2");
    expect(r.body).toContain("60 req/min");
  });

  test("exit code is 0 (workflow does not fail on author-input request)", () => {
    const r = dispatchTerminal(
      { status: "needs_input", questions: [{ id: "q1", topic: "x", text: "y" }] },
      OPTS,
    );
    expect(r.exitCode).toBe(0);
  });
});

describe("dispatchTerminal — blocked (AC-10)", () => {
  test("renders blockers[] verbatim and transitions to Blocked", () => {
    const r = dispatchTerminal(
      {
        status: "blocked",
        blockers: [
          { reason: "external service down" },
          { reason: "dependency unmerged: PROJ-99" },
        ],
      },
      OPTS,
    );
    expect(r.transition).toBe("Blocked");
    expect(r.body).toContain("external service down");
    expect(r.body).toContain("dependency unmerged: PROJ-99");
    expect(r.exitCode).toBe(0);
  });

  test("does NOT call any jira-create helper (AC-10 — no follow-up tickets)", () => {
    const r = dispatchTerminal(
      {
        status: "blocked",
        blockers: [{ reason: "external service down" }],
      },
      OPTS,
    );
    expect(r.createsFollowUpTicket).toBeFalsy();
  });
});

describe("dispatchTerminal — gaps (AC-10)", () => {
  test("renders gaps[] verbatim and transitions to Gaps Reported", () => {
    const r = dispatchTerminal(
      {
        status: "gaps",
        gaps: [
          { ac_id: "AC-3", reason: "no test covers cross-region path" },
          { ac_id: "AC-9", reason: "verify report empty for AC-9" },
        ],
      },
      OPTS,
    );
    expect(r.transition).toBe("Gaps Reported");
    expect(r.body).toContain("AC-3");
    expect(r.body).toContain("no test covers cross-region path");
    expect(r.body).toContain("AC-9");
    expect(r.exitCode).toBe(0);
  });

  test("does NOT auto-create follow-up tickets (AC-10)", () => {
    const r = dispatchTerminal(
      {
        status: "gaps",
        gaps: [{ ac_id: "AC-3", reason: "x" }],
      },
      OPTS,
    );
    expect(r.createsFollowUpTicket).toBeFalsy();
  });
});

describe("dispatchTerminal — stuck", () => {
  test("renders the stuck reason and transitions to Stuck", () => {
    const r = dispatchTerminal(
      { status: "stuck", reason: "subprocess_failed", detail: "exit 137" },
      OPTS,
    );
    expect(r.transition).toBe("Stuck");
    expect(r.body).toContain("subprocess_failed");
    expect(r.body).toContain("exit 137");
    expect(r.exitCode).toBe(0);
  });
});

describe("dispatchTerminal — done", () => {
  test("returns the in_review terminal mapping (PR-open path)", () => {
    const r = dispatchTerminal(
      {
        status: "done",
        spec_path: "docs/dev/PROJ-1/spec.json",
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
      OPTS,
    );
    expect(r.transition).toBe("In Review");
    expect(r.exitCode).toBe(0);
  });
});

describe("dispatchTerminal — secret scrubbing (AC-8 defence-in-depth)", () => {
  test("aborts with kind='scrubbed' if any configured secret value appears in the rendered body", () => {
    const r = dispatchTerminal(
      {
        status: "needs_input",
        questions: [
          { id: "q1", topic: "x", text: "I accidentally pasted my key: sk-ant-secret-VALUE" },
        ],
      },
      { ...OPTS, secrets: ["sk-ant-secret-VALUE", "other-secret"] },
    );
    expect(r.kind).toBe("scrubbed");
    expect(r.body).not.toContain("sk-ant-secret-VALUE");
  });

  test("emits normally when no secret value matches", () => {
    const r = dispatchTerminal(
      {
        status: "needs_input",
        questions: [{ id: "q1", topic: "x", text: "no secrets here" }],
      },
      { ...OPTS, secrets: ["sk-ant-not-present"] },
    );
    expect(r.kind).toBe("comment");
  });
});

describe("dispatchTerminal — state artifact upload on every terminal", () => {
  for (const status of ["needs_input", "blocked", "gaps", "stuck", "done"] as const) {
    test(`uploadStateArtifact = true for status=${status}`, () => {
      const packet: Record<string, unknown> = { status };
      if (status === "needs_input") packet.questions = [{ id: "q1", topic: "x", text: "y" }];
      if (status === "blocked") packet.blockers = [{ reason: "x" }];
      if (status === "gaps") packet.gaps = [{ ac_id: "AC-1", reason: "x" }];
      if (status === "stuck") packet.reason = "x";
      const r = dispatchTerminal(packet as never, OPTS);
      expect(r.uploadStateArtifact).toBe(true);
    });
  }
});
