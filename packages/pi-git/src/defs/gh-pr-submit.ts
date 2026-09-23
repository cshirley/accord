import { defineTool } from "../framework.js";
import { runGhPrSubmit } from "../lib/pr/context.js";

export default defineTool<{ title?: string; body?: string }>({
  name: "gh_pr_submit",
  label: "PR Submit",
  description:
    "Push current branch and optionally create a PR. Omit title/body for push-only (update existing PR). Provide title+body to create a new PR.",
  promptSnippet: "Push branch + optionally create PR",
  params: {
    title: {
      type: "string",
      required: false,
      description: "PR title (creates new PR if provided). Format: [TICKET-ID] summary",
    },
    body: { type: "string", required: false, description: "PR body markdown" },
  },
  async execute(params, { cwd, signal, onUpdate }) {
    return runGhPrSubmit(cwd, params, signal, onUpdate);
  },
});
