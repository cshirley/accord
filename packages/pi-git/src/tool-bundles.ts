/**
 * Git extension tool bundles — used for on-demand activation via search / tool_call.
 */

export type GitToolBundle = "commit" | "pr" | "review" | "worktree" | "harness";

export const GIT_TOOL_BUNDLES: Record<GitToolBundle, readonly string[]> = {
  commit: ["git_commit_context", "git_commit_execute"],
  pr: ["gh_pr_context", "gh_pr_submit", "gh_ci_context"],
  review: ["git_review_context", "git_review_tasks"],
  worktree: [
    "wt_create",
    "wt_list",
    "wt_status",
    "wt_merge",
    "wt_remove",
    "wt_exec",
    "wt_pr",
    "git_worktree_resolve",
  ],
  harness: ["repo_harness_context", "repo_verify"],
};

export const GIT_MANAGED_TOOL_NAMES: readonly string[] = Object.values(GIT_TOOL_BUNDLES).flat();

const TOOL_TO_BUNDLE = new Map<string, GitToolBundle>();
for (const [bundle, tools] of Object.entries(GIT_TOOL_BUNDLES) as [
  GitToolBundle,
  readonly string[],
][]) {
  for (const tool of tools) {
    if (!TOOL_TO_BUNDLE.has(tool)) TOOL_TO_BUNDLE.set(tool, bundle);
  }
}

export function gitBundleForTool(toolName: string): GitToolBundle | null {
  return TOOL_TO_BUNDLE.get(toolName) ?? null;
}

export function gitToolsForBundles(bundles: ReadonlySet<GitToolBundle>): string[] {
  const names = new Set<string>();
  for (const bundle of bundles) {
    for (const tool of GIT_TOOL_BUNDLES[bundle]) {
      names.add(tool);
    }
  }
  return [...names];
}

export function isGitManagedTool(toolName: string): boolean {
  return TOOL_TO_BUNDLE.has(toolName);
}
