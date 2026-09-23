import { describe, expect, test } from "bun:test";
import gitReviewTasksDef from "../src/defs/git-review-tasks.ts";
import { formatReviewContext } from "../src/lib/review/context.ts";
import { formatReviewTasks, runGitReviewTasks } from "../src/lib/review/tasks.ts";

describe("pi-git standalone review wrappers", () => {
  test("runGitReviewTasks passes local_layers into briefs", () => {
    const { tasks } = runGitReviewTasks({
      diff_path: "/tmp/diff.patch",
      source: "local",
      file_list: ["a.test.ts"],
      local_layers: ["staged", "unstaged"],
      test_output: "ok",
    });
    expect(tasks.some((task) => task.agent === "review-test")).toBe(true);
    expect(tasks[0]?.task).toContain("local_layers: staged+unstaged");
  });

  test("formatReviewTasks mentions two-wave hint when review-test present", () => {
    const text = formatReviewTasks({
      tasks: [
        { agent: "review-code", task: "x" },
        { agent: "review-security", task: "x" },
        { agent: "review-test", task: "x" },
      ],
    });
    expect(text).toContain("review-test");
    expect(text).toContain("after test_output exists");
  });

  test("formatReviewContext warns when unstaged layer included", () => {
    const text = formatReviewContext({
      source: "local",
      normalized_source: "local",
      repo_root: "/repo",
      file_list: ["a.ts"],
      diff_path: "/tmp/diff.patch",
      temp_dir: "/tmp",
      excerpt: "",
      test_command: "bun test",
      has_test_files: true,
      includes_unstaged: true,
    });
    expect(text).toContain("Warning:");
    expect(text).toContain("unstaged");
  });

  test("git_review_tasks accepts staged alias and rejects invalid source", async () => {
    const execute = gitReviewTasksDef.execute;
    if (!execute) {
      throw new Error("git_review_tasks execute missing");
    }
    const okResult = await execute(
      {
        diff_path: "/tmp/diff.patch",
        source: "staged",
        file_list: ["x.test.ts"],
        test_output: "pass",
      },
      { cwd: process.cwd() },
    );
    expect(okResult.isError).not.toBe(true);
    expect(okResult.text).toContain("review-test");

    const bad = await execute(
      {
        diff_path: "/tmp/diff.patch",
        source: "invalid",
        file_list: ["x.ts"],
      },
      { cwd: process.cwd() },
    );
    expect(bad.isError).toBe(true);
  });
});
