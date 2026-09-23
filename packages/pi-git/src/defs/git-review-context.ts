import { defineTool } from "../framework.js";
import { runGitReviewContext } from "../lib/review/context.js";

export default defineTool({
  name: "git_review_context",
  label: "Git Review Context",
  description:
    "Gather standalone review diff (local staged+unstaged vs HEAD, else origin/HEAD...HEAD), write full diff to a temp file, and return paths plus file list for parallel review agents.",
  promptSnippet: "Gather review diff ladder and write full diff to a temp file",
  params: {},
  progress: "Gathering review diff…",
  async execute(_params, { cwd, onUpdate }) {
    onUpdate?.({
      content: [{ type: "text", text: "Gathering review diff…" }],
      details: { progress: 20 },
    });
    return runGitReviewContext(cwd);
  },
});
