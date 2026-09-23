import { defineTool } from "../framework.js";
import { formatGhCiContext, runGhCiContext } from "../lib/pr/ci-context.js";

export default defineTool({
  name: "gh_ci_context",
  label: "CI Context",
  description:
    "Gather PR CI context in one call: merge state, required checks rollup, and excerpts from failed GitHub Actions logs on the current branch.",
  promptSnippet: "Gather PR CI/checks state and failed workflow log excerpts",
  params: {},
  async execute(_params, { cwd, signal, onUpdate }) {
    const result = await runGhCiContext(cwd, signal, onUpdate);
    return { text: formatGhCiContext(result), details: result };
  },
});
