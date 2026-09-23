/**
 * AC-18 (TC-14): enforce exit-code policy.
 *
 *   - Every terminal-state branch produced by parse-phase-result returns
 *     exitCode === 0. Non-zero exit is reserved for infrastructure failures.
 *   - The infrastructure-failure path (missing secret) propagates a
 *     non-zero exit via `MissingSecretError` from `requireEnv` (AC-15).
 */

import { describe, expect, test } from "bun:test";
import { MissingSecretError, requireEnv } from "../src/lib/env.js";
import { checkCostCap, dispatchTerminal, type TerminalOpts } from "../src/parse-phase-result.js";

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

describe("AC-18 — every terminal state exits 0", () => {
  for (const status of ["done", "needs_input", "blocked", "gaps", "stuck"] as const) {
    test(`status=${status} → exitCode === 0`, () => {
      const packet: Record<string, unknown> = { status };
      if (status === "needs_input") packet.questions = [{ id: "q1", topic: "x", text: "y" }];
      if (status === "blocked") packet.blockers = [{ reason: "x" }];
      if (status === "gaps") packet.gaps = [{ ac_id: "AC-1", reason: "x" }];
      if (status === "stuck") packet.reason = "x";
      const r = dispatchTerminal(packet as never, OPTS);
      expect(r.exitCode).toBe(0);
    });
  }

  test("cost_exceeded terminal → exitCode === 0", () => {
    const r = checkCostCap(
      { id: "PROJ-1", cost_usd: 30, cost_breakdown: { spec: 30 } },
      {
        maxCostUsd: 20,
        nextPhase: "plan",
        ticket: "PROJ-1",
        transitionOnCostExceeded: "Cost Exceeded",
      },
    );
    expect(r.tripped).toBe(true);
    if (r.tripped) expect(r.terminal.exitCode).toBe(0);
  });
});

describe("AC-18 — infra failure paths use NON-zero exit (via thrown error)", () => {
  test("missing required secret throws MissingSecretError (caller exits non-zero)", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      let thrown: unknown;
      try {
        requireEnv("ANTHROPIC_API_KEY");
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(MissingSecretError);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
