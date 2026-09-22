import { describe, expect, test } from "bun:test";
import { formatGhCiContext, type GhCiContextData } from "../src/lib/pr/ci-context.js";
import { resolveWorktreeQuery, type GitWorktreeEntry } from "../src/lib/worktree/resolve.js";

describe("formatGhCiContext", () => {
  test("formats failing checks", () => {
    const data: GhCiContextData = {
      branch: "feat/x",
      ticket: "STEP-1",
      ghAuth: true,
      pr: {
        number: 9,
        url: "https://github.com/o/r/pull/9",
        title: "Test",
        state: "OPEN",
        mergeable: "MERGEABLE",
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
        baseRefName: "main",
        headRefName: "feat/x",
        checks: [
          { name: "unit", state: "FAILURE", bucket: "FAILURE" },
          { name: "lint", state: "SUCCESS", bucket: "SUCCESS" },
        ],
      },
      failedRuns: [],
    };
    const text = formatGhCiContext(data);
    expect(text).toContain("STEP-1");
    expect(text).toContain("unit");
    expect(text).toContain("FAILURE");
  });
});

describe("resolveWorktreeQuery", () => {
  const trees: GitWorktreeEntry[] = [
    {
      path: "/repo/.worktrees/STEP-99-apps-service",
      branch: "STEP-99",
      head: "abc1234",
    },
  ];

  test("matches ticket in path", () => {
    expect(resolveWorktreeQuery(trees, "STEP-99")?.path).toContain("STEP-99");
  });

  test("returns null when no match", () => {
    expect(resolveWorktreeQuery(trees, "CLD-404")).toBeNull();
  });
});
