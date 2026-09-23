import { afterEach, describe, expect, test } from "bun:test";
import {
  buildLoaderActiveSet,
  clearSearchableToolsForTests,
  isProgressiveToolsEnabled,
  registerSearchableTools,
  scoreToolCatalog,
  SEARCH_ACCORD_TOOLS,
} from "../src/tools/progressive-discovery.js";

describe("isProgressiveToolsEnabled", () => {
  const keys = ["PI_PROGRESSIVE_TOOLS", "PI_GIT_DYNAMIC_TOOLS"] as const;
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  test("master env disables all", () => {
    for (const key of keys) saved[key] = process.env[key];
    process.env.PI_PROGRESSIVE_TOOLS = "0";
    expect(isProgressiveToolsEnabled("PI_GIT_DYNAMIC_TOOLS")).toBe(false);
  });

  test("package env can disable when master unset", () => {
    for (const key of keys) saved[key] = process.env[key];
    delete process.env.PI_PROGRESSIVE_TOOLS;
    process.env.PI_GIT_DYNAMIC_TOOLS = "0";
    expect(isProgressiveToolsEnabled("PI_GIT_DYNAMIC_TOOLS")).toBe(false);
  });
});

describe("scoreToolCatalog", () => {
  afterEach(() => clearSearchableToolsForTests());

  test("matches git pr tools", () => {
    registerSearchableTools(["gh_pr_context", "wt_exec"]);
    const searchable = new Set(["gh_pr_context", "wt_exec"]);
    const hits = scoreToolCatalog(
      [
        { name: "gh_pr_context", description: "Gather PR context" },
        { name: "wt_exec", description: "Run command in worktree" },
      ],
      searchable,
      "pr context",
      3,
    );
    expect(hits).toContain("gh_pr_context");
  });
});

describe("buildLoaderActiveSet", () => {
  test("hides managed tools but keeps loader", () => {
    const managed = new Set(["gh_pr_context", "wt_exec"]);
    const active = buildLoaderActiveSet(
      ["read", "bash", "gh_pr_context", "wt_exec"],
      managed,
    );
    expect(active).toContain("read");
    expect(active).toContain(SEARCH_ACCORD_TOOLS);
    expect(active).not.toContain("gh_pr_context");
  });
});
