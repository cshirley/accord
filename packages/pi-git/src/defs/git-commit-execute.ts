import { defineTool } from "../framework.js";
import { runGitCommitExecute } from "../lib/commit/execute.js";

export default defineTool<{ files: string[]; message: string }>({
  name: "git_commit_execute",
  label: "Git Commit Execute",
  description: "Stage files individually and commit. Returns hash and status.",
  promptSnippet: "Stage files and commit — returns hash and status",
  params: {
    files: { type: "string[]", required: true, description: "Files to stage" },
    message: { type: "string", required: true, description: "Commit message" },
  },
  async execute(params, { cwd, signal, onUpdate }) {
    return runGitCommitExecute(cwd, params.files, params.message, signal, onUpdate);
  },
});
