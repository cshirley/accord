import { defineTool } from "../framework.js";
import { gitRoot } from "../lib/git.js";
import {
  formatWorktreeResolve,
  listGitWorktrees,
  resolveWorktreeQuery,
} from "../lib/worktree/resolve.js";

type GitWorktreeResolveParams = { query: string };

export default defineTool<GitWorktreeResolveParams>({
  name: "git_worktree_resolve",
  label: "Git Worktree Resolve",
  description:
    "Find a git worktree path by ticket id, branch name, or path fragment. Use before repo_verify or wt_exec when cwd is the monorepo root.",
  promptSnippet: "Resolve .worktrees path for a ticket or branch name",
  params: {
    query: {
      type: "string",
      required: true,
      description: "Ticket (STEP-123), branch name, or path fragment",
    },
  },
  async execute(params, { cwd, signal }) {
    const root = await gitRoot(cwd, signal);
    const worktrees = await listGitWorktrees(root, signal);
    const match = resolveWorktreeQuery(worktrees, params.query);
    return {
      text: formatWorktreeResolve(params.query, match, worktrees),
      details: { query: params.query, match, worktrees },
      isError: !match,
    };
  },
});
