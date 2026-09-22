import { defineTool } from "../framework.js";
import { formatRepoVerify, runRepoVerify } from "../lib/harness/verify.js";

export default defineTool({
  name: "repo_verify",
  label: "Repo Verify",
  description:
    "Run Dev Harness verification_commands in the repo or a matched git worktree. Optional filter substring or explicit command list.",
  promptSnippet: "Run project verification_commands (optionally in a worktree)",
  params: {
    worktree: {
      type: "string",
      required: false,
      description: "Ticket id or path fragment to resolve via git worktree list (e.g. STEP-12283)",
    },
    filter: {
      type: "string",
      required: false,
      description: "Run only commands whose text contains this substring (e.g. jest, biome)",
    },
    commands: {
      type: "string[]",
      required: false,
      description: "Override harness commands (shell strings, run in order)",
    },
    cwd: {
      type: "string",
      required: false,
      description: "Working directory (default: git root of session cwd)",
    },
  },
  async execute(params, { cwd, signal }) {
    const result = await runRepoVerify(cwd, params, signal);
    return {
      text: formatRepoVerify(result),
      details: result,
      isError: !result.allPass,
    };
  },
});
