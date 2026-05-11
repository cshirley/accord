import { describe, expect, test } from "bun:test";

import {
  checkCostCap,
  type WorkItemForCostCap,
} from "../../scripts/ci/parse-phase-result.js";

const OPTS = {
  ticket: "PROJ-1",
  transitionOnCostExceeded: "Cost Exceeded",
};

function makeWi(perPhaseCost: Record<string, number>, total?: number): WorkItemForCostCap {
  return {
    id: "PROJ-1",
    cost_usd: total ?? Object.values(perPhaseCost).reduce((a, b) => a + b, 0),
    cost_breakdown: perPhaseCost,
  };
}

describe("checkCostCap (AC-7)", () => {
  test("equal to cap → trips (AC-7: cost_usd ≥ inputs.max_cost_usd)", () => {
    const wi = makeWi({ spec: 10, plan: 10 });
    const r = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "code", ...OPTS });
    expect(r.tripped).toBe(true);
  });

  test("strictly below cap → does NOT trip", () => {
    const wi = makeWi({ spec: 9, plan: 9 });
    const r = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "code", ...OPTS });
    expect(r.tripped).toBe(false);
  });

  test("above cap → trips", () => {
    const wi = makeWi({ spec: 12, plan: 11 });
    const r = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "code", ...OPTS });
    expect(r.tripped).toBe(true);
  });
});

describe("checkCostCap — tripped payload (TC-5 cost-summary golden shape)", () => {
  test("body contains per-phase breakdown, cumulative, cap, and would-have-been-next phase", () => {
    const wi = makeWi({ spec: 5, plan: 6, code: 9 });
    const r = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "verify", ...OPTS });
    expect(r.tripped).toBe(true);
    if (r.tripped) {
      expect(r.terminal.body).toContain("spec");
      expect(r.terminal.body).toContain("5");
      expect(r.terminal.body).toContain("plan");
      expect(r.terminal.body).toContain("code");
      expect(r.terminal.body).toContain("20"); // cap
      expect(r.terminal.body).toContain("verify"); // would-have-been-next
      expect(r.terminal.transition).toBe("Cost Exceeded");
      expect(r.terminal.exitCode).toBe(0);
    }
  });
});

describe("checkCostCap — does NOT reset between runs", () => {
  test("re-running with the same state still trips the cap", () => {
    const wi = makeWi({ spec: 25 }, 25);
    const a = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "plan", ...OPTS });
    const b = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "plan", ...OPTS });
    expect(a.tripped).toBe(true);
    expect(b.tripped).toBe(true);
  });
});

describe("checkCostCap — empty breakdown handled gracefully", () => {
  test("no per-phase data but cost_usd above cap → trips with total only", () => {
    const wi: WorkItemForCostCap = { id: "PROJ-1", cost_usd: 25, cost_breakdown: {} };
    const r = checkCostCap(wi, { maxCostUsd: 20, nextPhase: "code", ...OPTS });
    expect(r.tripped).toBe(true);
    if (r.tripped) {
      expect(r.terminal.body).toContain("25");
    }
  });
});
