/**
 * Resolve any git worktree path (not only pi-git managed wt/* trees).
 */

import { git } from "../git.js";

export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  head: string;
}

export async function listGitWorktrees(root: string, signal?: AbortSignal): Promise<GitWorktreeEntry[]> {
  const raw = await git(["worktree", "list", "--porcelain"], root, signal);
  const entries: GitWorktreeEntry[] = [];
  let current: Partial<GitWorktreeEntry> = {};

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push(current as GitWorktreeEntry);
      current = { path: line.slice("worktree ".length).trim() };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch refs/heads/".length).trim();
    }
  }
  if (current.path) entries.push(current as GitWorktreeEntry);
  return entries;
}

export function resolveWorktreeQuery(
  worktrees: GitWorktreeEntry[],
  query: string,
): GitWorktreeEntry | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const exact = worktrees.find(
    (w) =>
      w.path.toLowerCase().endsWith(`/${q}`) ||
      w.path.toLowerCase().includes(q) ||
      (w.branch?.toLowerCase() === q) ||
      (w.branch?.toLowerCase().includes(q) ?? false),
  );
  return exact ?? null;
}

export function formatWorktreeResolve(
  query: string,
  match: GitWorktreeEntry | null,
  all: GitWorktreeEntry[],
): string {
  if (!match) {
    return `No worktree matched "${query}".\n\nKnown worktrees:\n${all
      .map((w) => `  ${w.path}  (${w.branch ?? "detached"})`)
      .join("\n")}`;
  }
  return `Matched worktree for "${query}":\n  path: ${match.path}\n  branch: ${match.branch ?? "(detached)"}\n  head: ${match.head?.slice(0, 7) ?? "?"}`;
}
