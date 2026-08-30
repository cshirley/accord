import { describe, expect, test } from "bun:test";
import type { TasksDashboardRow } from "../src/core/queries/dashboard.js";
import {
  abbreviatePatternLabel,
  formatTasksDashboard,
} from "../src/core/queries/dashboard-format.js";

function row(overrides: Partial<TasksDashboardRow>): TasksDashboardRow {
  return {
    id: "WI-1",
    title: "Example",
    pattern: "implement/standard",
    phase: "implementing",
    tasks_done: 0,
    tasks_total: 0,
    tasks_blocked: 0,
    tasks_in_progress: 0,
    tasks_pending: 0,
    pending_decisions: 0,
    pending_deviations: 0,
    deviations_total: 0,
    has_checkpoint: false,
    missing_artifacts: [],
    action_hint: null,
    cost_usd: 0,
    usage_cost_usd: null,
    display_cost_usd: 0,
    cost_from_usage: false,
    updated: "2026-01-01T00:00:00.000Z",
    updated_relative: "1d ago",
    ...overrides,
  };
}

describe("abbreviatePatternLabel", () => {
  test("shortens pattern and variant", () => {
    expect(abbreviatePatternLabel("implement/standard")).toBe("imp/std");
    expect(abbreviatePatternLabel("quick_fix/express")).toBe("qfx/exp");
    expect(abbreviatePatternLabel("investigate")).toBe("inv");
  });
});

describe("formatTasksDashboard", () => {
  test("empty state", () => {
    expect(
      formatTasksDashboard({
        rows: [],
        total_pending: 0,
        total_pending_deviations: 0,
        total_blocked_tasks: 0,
        finish_ready_count: 0,
        total_cost: 0,
        attention_summary: "No items need review attention.",
      }),
    ).toBe("No work items in `.tasks/`.");
  });

  test("tabular layout with header row and sections", () => {
    const formatted = formatTasksDashboard({
      rows: [
        row({
          id: "A-1",
          title: "Active item",
          tasks_done: 1,
          tasks_total: 3,
          tasks_blocked: 1,
          tasks_in_progress: 1,
          pending_decisions: 1,
          action_hint: "→ review",
          display_cost_usd: 2.5,
        }),
        row({
          id: "D-1",
          title: "Done item",
          completed_at: "2026-01-02T00:00:00.000Z",
          terminal_outcome: "done",
          display_cost_usd: 1,
        }),
      ],
      total_pending: 1,
      total_pending_deviations: 0,
      total_blocked_tasks: 1,
      finish_ready_count: 0,
      total_cost: 3.5,
      attention_summary: "Needs attention: 1 pending decision(s)",
    });

    expect(formatted).toMatch(/ID\s+PAT\s+PHASE/);
    expect(formatted).not.toMatch(/TITLE/);
    expect(formatted).toMatch(/A-1\s+imp\/std/);
    expect(formatted).toMatch(/Active/);
    expect(formatted).toMatch(/A-1/);
    expect(formatted).toMatch(/imp\/std/);
    expect(formatted).toMatch(/1\/3·1b·1↑/);
    expect(formatted).toMatch(/1dec/);
    expect(formatted).toMatch(/review/);
    expect(formatted).toMatch(/Done/);
    expect(formatted).toMatch(/D-1/);
    expect(formatted).toMatch(/\/dev review/);
    expect(formatted).toMatch(/\$3\.50 total/);
  });
});
