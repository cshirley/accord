import { defineTool } from "../framework.js";
import { formatPrContext, runGhPrContext } from "../lib/pr/context.js";

export default defineTool({
  name: "gh_pr_context",
  label: "PR Context",
  description:
    "Gather PR context in one call: existing PR check, branch/ticket, commits, diffstat, spec doc, verify report. All commands run in parallel.",
  promptSnippet: "Gather PR context (existing PR/commits/diffstat/spec/verify) in one call",
  params: {},
  async execute(_params, { cwd, signal, onUpdate }) {
    const result = await runGhPrContext(cwd, signal, onUpdate);
    return { text: formatPrContext(result), details: result };
  },
});
