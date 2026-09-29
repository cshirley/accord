import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearSearchableToolsForTests,
  SEARCH_ACCORD_TOOLS,
} from "@clive.shirley/accord-core/tools/progressive-discovery.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  applyGitSessionStartActiveSet,
  maybeActivateGitToolCall,
  resetGitToolBundles,
} from "../src/dynamic-tools.js";

function mockPi(initialActive: string[]): { pi: ExtensionAPI; active: string[] } {
  const active = [...initialActive];
  const pi = {
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active.length = 0;
      active.push(...names);
    },
    getAllTools: () => [],
  } as unknown as ExtensionAPI;
  return { pi, active };
}

describe("pi-git dynamic tools", () => {
  const envKeys = ["PI_PROGRESSIVE_TOOLS", "PI_GIT_DYNAMIC_TOOLS"] as const;
  const saved: Record<string, string | undefined> = {};

  // Snapshot, then clear the master switch so a host shell's `PI_PROGRESSIVE_TOOLS=0`
  // cannot override the per-test `PI_GIT_DYNAMIC_TOOLS=1`.
  beforeEach(() => {
    for (const key of envKeys) saved[key] = process.env[key];
    delete process.env.PI_PROGRESSIVE_TOOLS;
  });

  afterEach(() => {
    clearSearchableToolsForTests();
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("session start hides git tools but keeps loader", () => {
    process.env.PI_GIT_DYNAMIC_TOOLS = "1";
    const { pi, active } = mockPi(["read", "bash", "gh_pr_context", "wt_exec"]);
    resetGitToolBundles();
    applyGitSessionStartActiveSet(pi);
    expect(active).toContain("read");
    expect(active).toContain(SEARCH_ACCORD_TOOLS);
    expect(active).not.toContain("gh_pr_context");
  });

  test("tool_call activates bundle on demand", () => {
    process.env.PI_GIT_DYNAMIC_TOOLS = "1";
    const { pi, active } = mockPi(["read", SEARCH_ACCORD_TOOLS]);
    resetGitToolBundles();
    const ok = maybeActivateGitToolCall(pi, "gh_pr_context");
    expect(ok).toBe(true);
    expect(active).toContain("gh_pr_context");
  });
});
