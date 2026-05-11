/**
 * Git worktree primitives — pure async functions wrapping git commands.
 *
 * Every function takes an `exec` callback so callers wire in pi.exec()
 * and tests can substitute a stub. No pi imports here.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type Exec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
}

export interface WorktreeStatus {
  clean: boolean;
  files: string[];
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  message: string;
}

// ── Helpers ────────────────────────────────────────────────

function assertOk(result: ExecResult, context: string): void {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${context}: ${detail || `exit code ${result.code}`}`);
  }
}

// ── Repo introspection ─────────────────────────────────────

/**
 * Return the git repo root, or null if cwd is not inside a git repo.
 */
export async function gitRoot(exec: Exec, cwd?: string): Promise<string | null> {
  const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * True if the cwd is inside a git working tree (not bare).
 */
export async function isInsideWorkTree(exec: Exec, cwd?: string): Promise<boolean> {
  const r = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return r.code === 0 && r.stdout.trim() === "true";
}

/**
 * Return the current branch name, or null if HEAD is detached.
 */
export async function currentBranch(exec: Exec, cwd?: string): Promise<string | null> {
  const r = await exec("git", ["branch", "--show-current"], { cwd });
  if (r.code !== 0) return null;
  const name = r.stdout.trim();
  return name || null;
}

// ── Worktree CRUD ──────────────────────────────────────────

/**
 * Parse `git worktree list --porcelain` output into structured data.
 */
function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Partial<Worktree> = {};

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current as Worktree);
      current = { path: line.slice("worktree ".length), bare: false, branch: null, head: "" };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // refs/heads/wt/my-feature → wt/my-feature
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.branch = null;
    }
  }
  if (current.path) worktrees.push(current as Worktree);
  return worktrees;
}

/**
 * List all worktrees in the repo.
 */
export async function listWorktrees(exec: Exec, cwd?: string): Promise<Worktree[]> {
  const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd });
  assertOk(r, "git worktree list");
  return parseWorktreeList(r.stdout);
}

/**
 * Create a new worktree with a new branch.
 *
 * @param wtPath   Absolute or repo-relative path for the worktree directory
 * @param branch   Branch name to create (e.g. "wt/my-feature")
 * @param base     Base ref to branch from (default: HEAD)
 */
export async function addWorktree(
  exec: Exec,
  wtPath: string,
  branch: string,
  base?: string,
  cwd?: string,
): Promise<{ path: string; branch: string }> {
  const args = ["worktree", "add", "-b", branch, wtPath];
  if (base) args.push(base);
  const r = await exec("git", args, { cwd });
  assertOk(r, `git worktree add (branch: ${branch}, path: ${wtPath})`);
  return { path: wtPath, branch };
}

/**
 * Remove a worktree directory. Pass force=true to remove even with
 * uncommitted changes or if the directory is missing.
 */
export async function removeWorktree(
  exec: Exec,
  wtPath: string,
  force = false,
  cwd?: string,
): Promise<void> {
  const args = ["worktree", "remove", wtPath];
  if (force) args.splice(2, 0, "--force");
  const r = await exec("git", args, { cwd });
  assertOk(r, `git worktree remove ${wtPath}`);
}

/**
 * Prune stale worktree metadata.
 */
export async function pruneWorktrees(exec: Exec, cwd?: string): Promise<void> {
  const r = await exec("git", ["worktree", "prune"], { cwd });
  assertOk(r, "git worktree prune");
}

// ── Worktree status ────────────────────────────────────────

/**
 * Check working tree status inside a worktree.
 */
export async function worktreeStatus(
  exec: Exec,
  wtPath: string,
): Promise<WorktreeStatus> {
  const r = await exec("git", ["status", "--porcelain"], { cwd: wtPath });
  assertOk(r, `git status in ${wtPath}`);
  const files = r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { clean: files.length === 0, files };
}

/**
 * Get short diffstat for a worktree (uncommitted changes).
 */
export async function worktreeDiffStat(
  exec: Exec,
  wtPath: string,
): Promise<string> {
  const r = await exec("git", ["diff", "--stat"], { cwd: wtPath });
  return r.stdout.trim();
}

/**
 * Get ahead/behind counts between a branch and its upstream (or a given ref).
 */
export async function aheadBehind(
  exec: Exec,
  branch: string,
  upstream?: string,
  cwd?: string,
): Promise<{ ahead: number; behind: number }> {
  const ref = upstream ? `${upstream}...${branch}` : `${branch}@{upstream}...${branch}`;
  const r = await exec("git", ["rev-list", "--left-right", "--count", ref], { cwd });
  if (r.code !== 0) return { ahead: 0, behind: 0 };
  const [behind, ahead] = r.stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

// ── Branch operations ──────────────────────────────────────

/**
 * Check whether a local branch name already exists.
 */
export async function branchExists(
  exec: Exec,
  branch: string,
  cwd?: string,
): Promise<boolean> {
  const r = await exec("git", ["rev-parse", "--verify", `refs/heads/${branch}`], { cwd });
  return r.code === 0;
}

/**
 * Merge a source branch into the current branch with --no-ff.
 * Returns success/conflict info.
 */
export async function mergeBranch(
  exec: Exec,
  source: string,
  message?: string,
  cwd?: string,
): Promise<MergeResult> {
  const args = ["merge", "--no-ff", source];
  if (message) args.push("-m", message);
  const r = await exec("git", args, { cwd });

  if (r.code === 0) {
    return { success: true, message: r.stdout.trim() || "Merge successful" };
  }

  // Check for merge conflicts
  const conflictCheck = await exec("git", ["diff", "--name-only", "--diff-filter=U"], { cwd });
  if (conflictCheck.stdout.trim()) {
    const conflicts = conflictCheck.stdout.trim().split("\n").filter(Boolean);
    return {
      success: false,
      conflicts,
      message: `Merge conflict in ${conflicts.length} file(s): ${conflicts.join(", ")}`,
    };
  }

  return { success: false, message: (r.stderr || r.stdout).trim() };
}

/**
 * Abort an in-progress merge.
 */
export async function abortMerge(exec: Exec, cwd?: string): Promise<void> {
  await exec("git", ["merge", "--abort"], { cwd });
}

/**
 * Checkout a branch in the given worktree (or main working tree).
 */
export async function checkoutBranch(
  exec: Exec,
  branch: string,
  cwd?: string,
): Promise<void> {
  const r = await exec("git", ["checkout", branch], { cwd });
  assertOk(r, `git checkout ${branch}`);
}

/**
 * Delete a local branch. Use force=true for -D (even if not fully merged).
 */
export async function deleteBranch(
  exec: Exec,
  branch: string,
  force = false,
  cwd?: string,
): Promise<void> {
  const flag = force ? "-D" : "-d";
  const r = await exec("git", ["branch", flag, branch], { cwd });
  assertOk(r, `git branch ${flag} ${branch}`);
}

/**
 * Push a branch to a remote.
 */
export async function pushBranch(
  exec: Exec,
  branch: string,
  remote = "origin",
  cwd?: string,
): Promise<void> {
  const r = await exec("git", ["push", remote, branch], { cwd });
  assertOk(r, `git push ${remote} ${branch}`);
}

/**
 * Get the short log between two refs.
 */
export async function logOneline(
  exec: Exec,
  from: string,
  to: string,
  cwd?: string,
): Promise<string> {
  const r = await exec("git", ["log", "--oneline", `${from}..${to}`], { cwd });
  return r.code === 0 ? r.stdout.trim() : "";
}

// ── .gitignore management ──────────────────────────────────

/**
 * Ensure `.worktrees/` is in the repo's .gitignore.
 * Creates .gitignore if it doesn't exist.
 */
export async function ensureGitignore(repoRoot: string): Promise<boolean> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  const entry = ".worktrees/";
  let content = "";

  try {
    content = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    // File doesn't exist — we'll create it
  }

  // Check if already present (exact line match)
  const lines = content.split("\n");
  if (lines.some((l) => l.trim() === entry)) return false;

  // Append with a blank line separator if file has content
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  const addition = content.length > 0 ? `${separator}\n# Git worktrees (managed by pi)\n${entry}\n` : `# Git worktrees (managed by pi)\n${entry}\n`;
  fs.writeFileSync(gitignorePath, content + addition, "utf8");
  return true;
}

// ── Name validation ────────────────────────────────────────

const VALID_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Validate a worktree name. Returns null if valid, error message if not.
 */
export function validateName(name: string): string | null {
  if (!name) return "Name cannot be empty";
  if (name.length > 100) return "Name too long (max 100 characters)";
  if (!VALID_NAME_RE.test(name)) {
    return "Name must start with alphanumeric and contain only letters, digits, hyphens, dots, and underscores";
  }
  if (name === "." || name === "..") return "Name cannot be . or ..";
  return null;
}
