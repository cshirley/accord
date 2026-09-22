import { defineTool } from "../framework.js";
import { formatRepoHarnessContext, runRepoHarnessContext } from "../lib/harness/context.js";

export default defineTool({
  name: "repo_harness_context",
  label: "Repo Harness Context",
  description:
    "Load Dev Harness config from AGENTS.md: language, test/lint/type_check, and verification_commands for this repo.",
  promptSnippet: "Load Dev Harness verification commands and test config from AGENTS.md",
  params: {},
  async execute(_params, { cwd }) {
    const result = runRepoHarnessContext(cwd);
    return { text: formatRepoHarnessContext(result), details: result };
  },
});
