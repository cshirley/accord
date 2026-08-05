import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  HARNESS_RUN_ENTRY_TYPE,
  registerHarnessRunEntryRenderer,
  renderHarnessRunEntry,
} from "../src/adapters/pi/custom-entry-renderers.js";
import {
  OUTPUT_LEVEL_ENTRY_TYPE,
  registerOutputLevelEntryRenderer,
  renderOutputLevelEntry,
} from "../packages/pi-thrift/src/entry-render.js";
import {
  registerWorktreeStateEntryRenderer,
  renderWorktreeStateEntry,
  WORKTREE_STATE_ENTRY_TYPE,
} from "../packages/pi-worktree/src/entry-render.js";

function mockTheme(): Theme {
  return {
    fg: (_role: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
}

function renderLines(component: { render: (width: number) => string[] }): string {
  return component.render(120).join("\n");
}

describe("custom entry renderers", () => {
  test("registerHarnessRunEntryRenderer calls registerEntryRenderer", () => {
    const types: string[] = [];
    const pi = {
      registerEntryRenderer: (customType: string) => types.push(customType),
    } as unknown as ExtensionAPI;
    registerHarnessRunEntryRenderer(pi);
    expect(types).toEqual([HARNESS_RUN_ENTRY_TYPE]);
  });

  test("renderHarnessRunEntry shows tag, run_id, work items, auto-provisioned", () => {
    const text = renderLines(
      renderHarnessRunEntry(
        {
          harness_session_tag: "WI-TEST",
          harness_run_id: "run-1",
          work_item_ids: ["WI-TEST", "WI-OTHER"],
          auto_provisioned: true,
        },
        mockTheme(),
      ),
    );
    expect(text).toContain("ACCORD harness run");
    expect(text).toContain("tag: WI-TEST");
    expect(text).toContain("run_id: run-1");
    expect(text).toContain("WI-TEST, WI-OTHER");
    expect(text).toContain("auto-provisioned: yes");
  });

  test("registerOutputLevelEntryRenderer registers current and legacy types", () => {
    const types: string[] = [];
    const pi = {
      registerEntryRenderer: (customType: string) => types.push(customType),
    } as unknown as ExtensionAPI;
    registerOutputLevelEntryRenderer(pi);
    expect(types).toContain(OUTPUT_LEVEL_ENTRY_TYPE);
    expect(types).toContain("tp-output-level");
  });

  test("renderOutputLevelEntry shows compression level", () => {
    const text = renderLines(renderOutputLevelEntry({ level: "full" }, mockTheme()));
    expect(text).toContain("thrift output");
    expect(text).toContain("level: full");
  });

  test("registerWorktreeStateEntryRenderer calls registerEntryRenderer", () => {
    const types: string[] = [];
    const pi = {
      registerEntryRenderer: (customType: string) => types.push(customType),
    } as unknown as ExtensionAPI;
    registerWorktreeStateEntryRenderer(pi);
    expect(types).toEqual([WORKTREE_STATE_ENTRY_TYPE]);
  });

  test("renderWorktreeStateEntry shows branch and path summary", () => {
    const text = renderLines(
      renderWorktreeStateEntry(
        {
          worktrees: {
            feat: {
              path: "/repo/.worktrees/feat",
              branch: "wt/feat",
              baseBranch: "main",
              createdAt: "2026-01-01",
            },
          },
        },
        mockTheme(),
      ),
    );
    expect(text).toContain("worktrees (1)");
    expect(text).toContain("feat: wt/feat @ /repo/.worktrees/feat");
    expect(text).toContain("base: main");
  });
});
