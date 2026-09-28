import { describe, expect, test } from "bun:test";
import {
  PENDING_DECISIONS_GATE_AGENTS,
  pendingDecisionsGateMessage,
} from "@clive.shirley/accord-core/orchestration/pending-decisions-gate.js";
import type { WorkItem } from "@clive.shirley/accord-core/work-items/types.js";

function baseWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    schema_version: "1.0",
    id: "GATE-1",
    title: "t",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    pattern: "implement",
    variant: "standard",
    phase: "implementing",
    task_ids: [],
    decisions: [],
    deviations: [],
    cost_usd: 0,
    ...overrides,
  } as WorkItem;
}

describe("pendingDecisionsGateMessage", () => {
  test("blocks a gated agent when a decision is pending", () => {
    const wi = baseWorkItem({
      decisions: [
        {
          id: "q1",
          source: "plan",
          status: "pending",
          question: "Which approach?",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const msg = pendingDecisionsGateMessage(wi, "phase-code");
    expect(msg).not.toBeNull();
    expect(msg?.level).toBe("warning");
    expect(msg?.text).toContain("q1");
    expect(msg?.text).toContain("Which approach?");
    expect(msg?.text).toContain("--allow-pending-decisions");
  });

  test("allows when allowPendingDecisions is set", () => {
    const wi = baseWorkItem({
      decisions: [
        {
          id: "q1",
          source: "plan",
          status: "pending",
          question: "q",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(pendingDecisionsGateMessage(wi, "phase-code", true)).toBeNull();
  });

  test("does not gate non-implement-pipeline agents (e.g. phase-plan itself)", () => {
    const wi = baseWorkItem({
      decisions: [
        {
          id: "q1",
          source: "plan",
          status: "pending",
          question: "q",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(pendingDecisionsGateMessage(wi, "phase-plan")).toBeNull();
  });

  test("does not gate when there are no pending decisions", () => {
    const wi = baseWorkItem({
      decisions: [
        {
          id: "q1",
          source: "plan",
          status: "resolved",
          question: "q",
          answer: "a",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(pendingDecisionsGateMessage(wi, "phase-test")).toBeNull();
  });

  test("gate covers exactly the task-scoped implement-pipeline agents", () => {
    expect([...PENDING_DECISIONS_GATE_AGENTS].sort()).toEqual(
      ["phase-code", "phase-test", "phase-verify-task", "review-code", "review-test"].sort(),
    );
  });
});
