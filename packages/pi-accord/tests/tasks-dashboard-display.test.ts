import { describe, expect, test } from "bun:test";
import { classifyDevQueryLine } from "../src/adapters/pi/dev-formatted-display.js";
import { classifyTasksDashboardLine } from "../src/adapters/pi/tasks-dashboard-display.js";

describe("classifyTasksDashboardLine", () => {
  test("classifies dashboard sections and rows", () => {
    expect(classifyTasksDashboardLine("Work items (2 active)")).toBe("title");
    expect(classifyTasksDashboardLine("Active")).toBe("section");
    expect(classifyTasksDashboardLine("ID           PAT")).toBe("header");
    expect(classifyTasksDashboardLine("DASH-1       imp/std  align")).toBe("row");
    expect(classifyTasksDashboardLine("Needs attention: 1 pending decision(s)")).toBe("attention");
    expect(classifyTasksDashboardLine("  /dev review — drain pending decisions")).toBe("hint");
    expect(classifyTasksDashboardLine("  tasks: done/total·blocked·in_progress·pending")).toBe(
      "legend",
    );
    expect(classifyTasksDashboardLine("—")).toBe("dash");
    expect(classifyTasksDashboardLine("")).toBe("empty");
  });
});

describe("classifyDevQueryLine", () => {
  test("classifies gaps and deviations output", () => {
    expect(classifyDevQueryLine("GAP-1 — verification gaps")).toBe("title");
    expect(classifyDevQueryLine("Verdict: gaps")).toBe("kv");
    expect(classifyDevQueryLine("  AC-1: missing test")).toBe("item");
    expect(classifyDevQueryLine("  /dev gaps GAP-1 --tickets")).toBe("hint");
    expect(classifyDevQueryLine("2 gap(s) listed above.")).toBe("attention");
    expect(classifyDevQueryLine("GAP-1 — deviations")).toBe("title");
    expect(classifyDevQueryLine("  task-2  at=2026-05-28")).toBe("item");
    expect(classifyDevQueryLine("No deviations recorded on this work item.")).toBe("muted");
  });

  test("classifies retro output", () => {
    expect(classifyDevQueryLine("ACCORD Retrospective")).toBe("title");
    expect(classifyDevQueryLine("insights_dir: /tmp/insights")).toBe("kv");
    expect(classifyDevQueryLine("Outcomes:")).toBe("section");
    expect(classifyDevQueryLine("- done: 3")).toBe("item");
    expect(classifyDevQueryLine("  friction: rework")).toBe("item");
    expect(classifyDevQueryLine("Shift-left opportunities:")).toBe("section");
  });
});
