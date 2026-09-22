import type { StandaloneReviewDiff } from "@clive.shirley/accord-core/review/standalone.js";
import { defineTool } from "../framework.js";
import { formatReviewTasks, runGitReviewTasks } from "../lib/review/tasks.js";

type GitReviewTasksParams = {
  diff_path: string;
  source: StandaloneReviewDiff["source"];
  file_list: string[];
  test_output?: string;
};

export default defineTool<GitReviewTasksParams>({
  name: "git_review_tasks",
  label: "Git Review Tasks",
  description:
    "Build parallel subagent briefs for standalone review (review-code, review-security, optional review-test) from git_review_context paths. Do not use accord review CLI.",
  promptSnippet: "Build subagent tasks[] for standalone review agents",
  params: {
    diff_path: { type: "string", description: "Absolute path from git_review_context details.diff_path" },
    source: {
      type: "string",
      description: "Diff ladder source from git_review_context (staged, unstaged, or branch)",
    },
    file_list: {
      type: "string[]",
      description: "Changed paths from git_review_context details.file_list",
    },
    test_output: {
      type: "string",
      required: false,
      description: "Captured test stdout/stderr (last 64 KiB) when has_test_files; omit if tests not run",
    },
  },
  progress: "Building review subagent tasks…",
  async execute(params) {
    const source = params.source;
    if (source !== "staged" && source !== "unstaged" && source !== "branch") {
      return {
        text: `Invalid source: ${String(source)}`,
        isError: true,
      };
    }
    const result = runGitReviewTasks({
      diff_path: params.diff_path,
      source,
      file_list: params.file_list,
      test_output: params.test_output,
    });
    return {
      text: formatReviewTasks(result),
      details: result,
    };
  },
});
