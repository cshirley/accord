import { defineTool } from "../framework.js";
import { formatCommitContext, runGitCommitContext } from "../lib/commit/context.js";

export default defineTool({
  name: "git_commit_context",
  label: "Git Commit Context",
  description:
    "Gather status, diff, diffstat, log, branch, secrets, and artifacts in one parallel call for commit drafting.",
  promptSnippet: "Gather git context (status/diff/log/branch/secrets/artifacts) in one call",
  params: {},
  async execute(_params, { cwd, signal, onUpdate }) {
    const result = await runGitCommitContext(cwd, signal, onUpdate);
    return { text: formatCommitContext(result), details: result };
  },
});
