import { describe, expect, test } from "bun:test";
import { classifyTasksDashboardLine } from "../src/adapters/pi/tasks-dashboard-display.js";

describe("classifyTasksDashboardLine", () => {
  test("classifies dashboard sections and rows", () => {
    expect(classifyTasksDashboardLine("Work items (2 active)")).toBe("title");
    expect(classifyTasksDashboardLine("Active")).toBe("section");
    expect(classifyTasksDashboardLine("ID           PAT")).toBe("header");
    expect(classifyTasksDashboardLine("DASH-1       imp/std  align")).toBe("row");
    expect(classifyTasksDashboardLine("Needs attention: 1 pending decision(s)")).toBe("attention");
    expect(classifyTasksDashboardLine("  /dev review — drain pending decisions")).toBe("hint");
    expect(classifyTasksDashboardLine("  tasks: done/total·blocked·in_progress·pending")).toBe("legend");
    expect(classifyTasksDashboardLine("—")).toBe("dash");
    expect(classifyTasksDashboardLine("")).toBe("empty");
  });
});
