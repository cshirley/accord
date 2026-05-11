/**
 * Git Worktree Extension — manage worktrees for concurrent work.
 *
 * Tools:  wt_create, wt_list, wt_status, wt_merge, wt_remove, wt_exec, wt_pr
 * Command: /wt <subcommand>
 * Hooks:  session_start (state restore + status bar), before_agent_start (context injection)
 */

import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
  type Exec,
  type Worktree,
  gitRoot,
  isInsideWorkTree,
  currentBranch,
  listWorktrees,
  addWorktree,
  removeWorktree,
  pruneWorktrees,
  worktreeStatus,
  worktreeDiffStat,
  aheadBehind,
  branchExists,
  mergeBranch,
  abortMerge,
  checkoutBranch,
  deleteBranch,
  pushBranch,
  logOneline,
  ensureGitignore,
  validateName,
} from "./git.js";

// ── Constants ──────────────────────────────────────────────

const WORKTREE_DIR = ".worktrees";
const BRANCH_PREFIX = "wt/";
const STATE_TYPE = "worktree-state";

// ── State ──────────────────────────────────────────────────

interface WorktreeEntry {
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
}

interface WorktreeState {
  worktrees: Record<string, WorktreeEntry>;
}

// ── Helpers ────────────────────────────────────────────────

function makeExec(pi: ExtensionAPI): Exec {
  return async (cmd, args, opts) => {
    const r = await pi.exec(cmd, args, opts);
    return { stdout: r.stdout, stderr: r.stderr, code: r.code };
  };
}

function worktreePath(root: string, name: string): string {
  return path.join(root, WORKTREE_DIR, name);
}

function branchName(name: string): string {
  return `${BRANCH_PREFIX}${name}`;
}

/** Filter worktrees to only those managed by this extension. */
function managedWorktrees(all: Worktree[], root: string): Worktree[] {
  const prefix = path.join(root, WORKTREE_DIR);
  return all.filter((w) => w.path.startsWith(prefix));
}

function formatWorktreeTable(
  worktrees: Worktree[],
  state: WorktreeState,
  theme: ExtensionContext["ui"]["theme"],
): string {
  if (worktrees.length === 0) return "No active worktrees.";

  const lines: string[] = [];
  for (const wt of worktrees) {
    const name = path.basename(wt.path);
    const entry = state.worktrees[name];
    const branch = wt.branch || "(detached)";
    const base = entry?.baseBranch || "?";
    const sha = wt.head.slice(0, 7);
    lines.push(
      `  ${theme.fg("accent", name)}  ${theme.fg("dim", branch)}  ${theme.fg("muted", sha)}  base: ${theme.fg("dim", base)}`,
    );
  }
  return lines.join("\n");
}

// ── Extension entry point ──────────────────────────────────

export default function (pi: ExtensionAPI) {
  const exec = makeExec(pi);
  const state: WorktreeState = { worktrees: {} };

  // ── State persistence ──────────────────────────────────

  function persistState(): void {
    pi.appendEntry(STATE_TYPE, { ...state });
  }

  async function reconcileState(): Promise<void> {
    const root = await gitRoot(exec);
    if (!root) return;
    const all = await listWorktrees(exec);
    const managed = managedWorktrees(all, root);
    const onDisk = new Set(managed.map((w) => path.basename(w.path)));

    // Remove entries for worktrees that no longer exist
    for (const name of Object.keys(state.worktrees)) {
      if (!onDisk.has(name)) delete state.worktrees[name];
    }

    // Add entries for worktrees found on disk but missing from state
    for (const wt of managed) {
      const name = path.basename(wt.path);
      if (!state.worktrees[name]) {
        state.worktrees[name] = {
          path: wt.path,
          branch: wt.branch || branchName(name),
          baseBranch: "unknown",
          createdAt: "unknown",
        };
      }
    }
  }

  // ── Shared validation ──────────────────────────────────

  async function requireGitRepo(): Promise<string> {
    const root = await gitRoot(exec);
    if (!root) throw new Error("Not inside a git repository.");
    if (!(await isInsideWorkTree(exec))) throw new Error("Inside a bare git repository — worktrees require a working tree.");
    return root;
  }

  async function resolveWorktree(name: string): Promise<{ root: string; wtPath: string; entry: WorktreeEntry }> {
    const root = await requireGitRepo();
    const entry = state.worktrees[name];
    if (!entry) throw new Error(`No worktree named "${name}". Run wt_list to see active worktrees.`);
    return { root, wtPath: entry.path, entry };
  }

  // ── Tools ──────────────────────────────────────────────

  pi.registerTool({
    name: "wt_create",
    label: "Worktree Create",
    description: "Create a git worktree with its own branch for isolated parallel work.",
    promptSnippet: "Create a git worktree — each gets its own branch and working directory for concurrent work",
    parameters: Type.Object({
      name: Type.String({ description: "Worktree name (alphanumeric, hyphens, dots, underscores)" }),
      base_branch: Type.Optional(Type.String({ description: "Branch to base off (default: current branch)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const nameErr = validateName(params.name);
      if (nameErr) return { content: [{ type: "text", text: `Invalid name: ${nameErr}` }], details: undefined, isError: true };

      const root = await requireGitRepo();
      const branch = branchName(params.name);
      const wtPath = worktreePath(root, params.name);

      // Safety checks
      if (state.worktrees[params.name]) {
        return { content: [{ type: "text", text: `Worktree "${params.name}" already exists at ${wtPath}` }], details: undefined, isError: true };
      }
      if (await branchExists(exec, branch)) {
        return { content: [{ type: "text", text: `Branch "${branch}" already exists. Pick a different name or delete the branch first.` }], details: undefined, isError: true };
      }

      const base = params.base_branch || (await currentBranch(exec)) || "HEAD";

      // Ensure .worktrees/ is gitignored
      const added = await ensureGitignore(root);

      // Create the worktree
      await addWorktree(exec, wtPath, branch, base);

      // Track in state
      state.worktrees[params.name] = {
        path: wtPath,
        branch,
        baseBranch: base,
        createdAt: new Date().toISOString(),
      };
      persistState();
      updateStatusBar(ctx);

      const lines = [
        `Created worktree "${params.name}"`,
        `  path:   ${wtPath}`,
        `  branch: ${branch}`,
        `  base:   ${base}`,
      ];
      if (added) lines.push("  (.worktrees/ added to .gitignore)");
      lines.push("", `Use the subagent tool with cwd: "${wtPath}" to work in this worktree.`);

      return { content: [{ type: "text", text: lines.join("\n") }], details: { name: params.name, path: wtPath, branch, base } };
    },
  });

  pi.registerTool({
    name: "wt_list",
    label: "Worktree List",
    description: "List all active git worktrees with branch, path, and status.",
    promptSnippet: "List all git worktrees with their branch, path, and clean/dirty status",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const root = await requireGitRepo();
      const all = await listWorktrees(exec);
      const managed = managedWorktrees(all, root);

      if (managed.length === 0) {
        return { content: [{ type: "text", text: "No active worktrees. Use wt_create to create one." }], details: undefined };
      }

      const lines: string[] = [`${managed.length} worktree(s):\n`];
      for (const wt of managed) {
        const name = path.basename(wt.path);
        const entry = state.worktrees[name];
        const status = await worktreeStatus(exec, wt.path);
        const statusIcon = status.clean ? "✓ clean" : `✗ ${status.files.length} changed`;

        lines.push(`${name}`);
        lines.push(`  branch: ${wt.branch || "(detached)"}`);
        lines.push(`  base:   ${entry?.baseBranch || "unknown"}`);
        lines.push(`  path:   ${wt.path}`);
        lines.push(`  status: ${statusIcon}`);
        lines.push(`  sha:    ${wt.head.slice(0, 7)}`);
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n").trimEnd() }],
        details: { count: managed.length, worktrees: managed },
      };
    },
  });

  pi.registerTool({
    name: "wt_status",
    label: "Worktree Status",
    description: "Show detailed status for a specific worktree or all worktrees.",
    promptSnippet: "Check a worktree for uncommitted changes, ahead/behind, and diff stats",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Worktree name (omit for all)" })),
    }),
    async execute(_id, params): Promise<{ content: { type: "text"; text: string }[]; details: unknown }> {
      const root = await requireGitRepo();

      if (params.name) {
        const { wtPath, entry } = await resolveWorktree(params.name);
        const status = await worktreeStatus(exec, wtPath);
        const diff = status.clean ? "" : await worktreeDiffStat(exec, wtPath);
        const ab = await aheadBehind(exec, entry.branch, entry.baseBranch);

        const lines = [`Worktree: ${params.name}`, `  branch: ${entry.branch}`, `  base:   ${entry.baseBranch}`];
        lines.push(`  ahead:  ${ab.ahead} commit(s)  behind: ${ab.behind} commit(s)`);
        if (status.clean) {
          lines.push("  working tree: clean");
        } else {
          lines.push(`  working tree: ${status.files.length} changed file(s)`);
          for (const f of status.files) lines.push(`    ${f}`);
          if (diff) { lines.push(""); lines.push(diff); }
        }

        return { content: [{ type: "text", text: lines.join("\n") }], details: { name: params.name, clean: status.clean, ahead: ab.ahead, behind: ab.behind } };
      }

      // All worktrees
      const all = await listWorktrees(exec);
      const managed = managedWorktrees(all, root);
      if (managed.length === 0) return { content: [{ type: "text", text: "No active worktrees." }], details: undefined };

      const lines: string[] = [];
      for (const wt of managed) {
        const name = path.basename(wt.path);
        const entry = state.worktrees[name];
        const status = await worktreeStatus(exec, wt.path);
        const ab = entry ? await aheadBehind(exec, entry.branch, entry.baseBranch) : { ahead: 0, behind: 0 };
        const statusStr = status.clean ? "✓ clean" : `✗ ${status.files.length} changed`;
        lines.push(`${name}  ${statusStr}  ↑${ab.ahead} ↓${ab.behind}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }], details: { count: managed.length } };
    },
  });

  pi.registerTool({
    name: "wt_merge",
    label: "Worktree Merge",
    description: "Merge a worktree's branch back to its base branch and optionally clean up.",
    promptSnippet: "Merge a worktree's branch back into its base and clean up the worktree",
    parameters: Type.Object({
      name: Type.String({ description: "Worktree name to merge" }),
      into: Type.Optional(Type.String({ description: "Target branch (default: the base branch from creation)" })),
      cleanup: Type.Optional(Type.Boolean({ description: "Remove worktree and delete branch after merge (default: true)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { wtPath, entry } = await resolveWorktree(params.name);
      const target = params.into || entry.baseBranch;
      const cleanup = params.cleanup !== false;

      // Check for uncommitted changes in the worktree
      const status = await worktreeStatus(exec, wtPath);
      if (!status.clean) {
        return {
          content: [{
            type: "text",
            text: `Worktree "${params.name}" has uncommitted changes:\n${status.files.map((f) => `  ${f}`).join("\n")}\n\nCommit or stash changes before merging.`,
          }],
          details: undefined,
          isError: true,
        };
      }

      // Switch main worktree to the target branch
      const mainBranch = await currentBranch(exec);
      if (mainBranch !== target) {
        await checkoutBranch(exec, target);
      }

      // Merge
      const result = await mergeBranch(exec, entry.branch, `Merge ${entry.branch} into ${target}`);

      if (!result.success) {
        // Abort the failed merge so the repo is clean
        await abortMerge(exec);
        // Restore original branch if we switched
        if (mainBranch && mainBranch !== target) {
          await checkoutBranch(exec, mainBranch);
        }

        const lines = [`Merge of "${params.name}" (${entry.branch}) into ${target} failed.`];
        if (result.conflicts) {
          lines.push(`\nConflicting files (${result.conflicts.length}):`);
          for (const f of result.conflicts) lines.push(`  ${f}`);
          lines.push("\nThe merge has been aborted. Resolve conflicts manually or use wt_exec to work in the worktree.");
        } else {
          lines.push(`\n${result.message}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }], isError: true, details: { conflicts: result.conflicts } };
      }

      const lines = [`Merged "${params.name}" (${entry.branch}) into ${target}.`];

      // Cleanup
      if (cleanup) {
        await removeWorktree(exec, wtPath, true);
        await deleteBranch(exec, entry.branch, true);
        delete state.worktrees[params.name];
        persistState();
        lines.push(`Worktree removed and branch ${entry.branch} deleted.`);
      }

      updateStatusBar(ctx);
      return { content: [{ type: "text", text: lines.join("\n") }], details: { merged: true, target, cleaned: cleanup } };
    },
  });

  pi.registerTool({
    name: "wt_remove",
    label: "Worktree Remove",
    description: "Remove a worktree without merging. Warns if there are uncommitted changes.",
    promptSnippet: "Remove a git worktree and optionally delete its branch (does not merge)",
    parameters: Type.Object({
      name: Type.String({ description: "Worktree name to remove" }),
      force: Type.Optional(Type.Boolean({ description: "Force removal even with uncommitted changes (default: false)" })),
      delete_branch: Type.Optional(Type.Boolean({ description: "Also delete the branch (default: false)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { wtPath, entry } = await resolveWorktree(params.name);

      // Check for uncommitted changes unless force
      if (!params.force) {
        const status = await worktreeStatus(exec, wtPath);
        if (!status.clean) {
          return {
            content: [{
              type: "text",
              text: `Worktree "${params.name}" has uncommitted changes:\n${status.files.map((f) => `  ${f}`).join("\n")}\n\nUse force: true to remove anyway, or commit/stash first.`,
            }],
            details: undefined,
            isError: true,
          };
        }
      }

      await removeWorktree(exec, wtPath, params.force || false);

      const lines = [`Removed worktree "${params.name}" at ${wtPath}.`];
      if (params.delete_branch) {
        await deleteBranch(exec, entry.branch, true);
        lines.push(`Deleted branch ${entry.branch}.`);
      }

      delete state.worktrees[params.name];
      persistState();
      updateStatusBar(ctx);

      return { content: [{ type: "text", text: lines.join("\n") }], details: { removed: params.name } };
    },
  });

  pi.registerTool({
    name: "wt_exec",
    label: "Worktree Exec",
    description: "Run a shell command inside a specific worktree's directory.",
    promptSnippet: "Execute a shell command inside a worktree's working directory",
    parameters: Type.Object({
      name: Type.String({ description: "Worktree name" }),
      command: Type.String({ description: "Shell command to run" }),
    }),
    async execute(_id, params) {
      const { wtPath } = await resolveWorktree(params.name);
      const r = await exec("bash", ["-c", params.command], { cwd: wtPath });
      const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).trim() || "(no output)";
      return {
        content: [{ type: "text", text: output }],
        details: { exitCode: r.code, cwd: wtPath },
        isError: r.code !== 0,
      };
    },
  });

  pi.registerTool({
    name: "wt_pr",
    label: "Worktree PR",
    description: "Push a worktree's branch and open or update a pull request.",
    promptSnippet: "Push a worktree's branch and open/update a PR via gh CLI",
    parameters: Type.Object({
      name: Type.String({ description: "Worktree name" }),
      title: Type.Optional(Type.String({ description: "PR title (required for new PRs)" })),
      body: Type.Optional(Type.String({ description: "PR body (auto-generated from commits if omitted)" })),
      base: Type.Optional(Type.String({ description: "Base branch for the PR (default: worktree's base branch)" })),
      draft: Type.Optional(Type.Boolean({ description: "Open as draft PR (default: false)" })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { wtPath, entry } = await resolveWorktree(params.name);
      const base = params.base || entry.baseBranch;

      // Check for uncommitted changes — warn but don't block
      const status = await worktreeStatus(exec, wtPath);
      let warning = "";
      if (!status.clean) {
        warning = `⚠ Worktree has ${status.files.length} uncommitted file(s). Only committed changes will be in the PR.\n\n`;
      }

      // Check gh is available
      const ghCheck = await exec("gh", ["auth", "status"], { cwd: wtPath });
      if (ghCheck.code !== 0) {
        return { content: [{ type: "text", text: "gh CLI is not authenticated. Run `gh auth login` first." }], details: undefined, isError: true };
      }

      // Push the branch
      await pushBranch(exec, entry.branch, "origin", wtPath);

      // Check for existing PR
      const prView = await exec("gh", ["pr", "view", "--json", "number,url,title,state"], { cwd: wtPath });

      if (prView.code === 0) {
        // PR exists — just report the update
        let pr: { number: number; url: string; title: string; state: string };
        try {
          pr = JSON.parse(prView.stdout);
        } catch {
          return { content: [{ type: "text", text: "Pushed branch but could not parse existing PR info." }], details: undefined };
        }
        return {
          content: [{ type: "text", text: `${warning}Pushed ${entry.branch}.\nPR #${pr.number} updated: ${pr.url}` }],
          details: { action: "updated", number: pr.number, url: pr.url, branch: entry.branch },
        };
      }

      // No existing PR — create one
      if (!params.title) {
        // Auto-generate title from branch name
        const slug = params.name.replace(/[-_]/g, " ");
        params.title = slug.charAt(0).toUpperCase() + slug.slice(1);
      }

      // Auto-generate body from commit log if not provided
      let body = params.body || "";
      if (!body) {
        const log = await logOneline(exec, base, entry.branch, wtPath);
        body = log
          ? `## Changes\n\n${log.split("\n").map((l) => `- ${l}`).join("\n")}`
          : "_(no commits yet)_";
      }

      const createArgs = ["pr", "create", "--title", params.title, "--body", body, "--base", base];
      if (params.draft) createArgs.push("--draft");

      const createResult = await exec("gh", createArgs, { cwd: wtPath });
      if (createResult.code !== 0) {
        return {
          content: [{ type: "text", text: `Pushed branch but PR creation failed:\n${createResult.stderr}` }],
          details: undefined,
          isError: true,
        };
      }

      const url = createResult.stdout.trim();
      return {
        content: [{ type: "text", text: `${warning}Pushed ${entry.branch}.\nPR created: ${url}` }],
        details: { action: "created", url, branch: entry.branch, draft: params.draft || false },
      };
    },
  });

  // ── /wt command ────────────────────────────────────────

  pi.registerCommand("wt", {
    description: "Git worktree manager — /wt help for usage",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() || "";

      try {
        switch (sub) {
          case "help":
          case "": {
            if (sub === "") {
              // Default: list worktrees if any exist, else help
              const root = await gitRoot(exec);
              if (root) {
                const all = await listWorktrees(exec);
                const managed = managedWorktrees(all, root);
                if (managed.length > 0) {
                  await reconcileState();
                  ctx.ui.notify(formatWorktreeTable(managed, state, ctx.ui.theme), "info");
                  return;
                }
              }
            }
            ctx.ui.notify(HELP_TEXT, "info");
            return;
          }

          case "create": {
            const name = parts[1];
            if (!name) { ctx.ui.notify("Usage: /wt create <name> [base-branch]", "error"); return; }
            const nameErr = validateName(name);
            if (nameErr) { ctx.ui.notify(`Invalid name: ${nameErr}`, "error"); return; }

            const root = await requireGitRepo();
            const branch = branchName(name);
            const wtPath = worktreePath(root, name);
            const base = parts[2] || (await currentBranch(exec)) || "HEAD";

            if (state.worktrees[name]) { ctx.ui.notify(`Worktree "${name}" already exists.`, "error"); return; }
            if (await branchExists(exec, branch)) { ctx.ui.notify(`Branch "${branch}" already exists.`, "error"); return; }

            await ensureGitignore(root);
            await addWorktree(exec, wtPath, branch, base);

            state.worktrees[name] = { path: wtPath, branch, baseBranch: base, createdAt: new Date().toISOString() };
            persistState();
            updateStatusBar(ctx);

            ctx.ui.notify(`Created worktree "${name}" (${branch} from ${base})`, "info");
            return;
          }

          case "list": {
            const root = await requireGitRepo();
            const all = await listWorktrees(exec);
            const managed = managedWorktrees(all, root);
            await reconcileState();
            ctx.ui.notify(
              managed.length > 0
                ? formatWorktreeTable(managed, state, ctx.ui.theme)
                : "No active worktrees. Use /wt create <name> to create one.",
              "info",
            );
            return;
          }

          case "status": {
            const name = parts[1];
            if (!name) {
              // All worktrees status summary
              const root = await requireGitRepo();
              const all = await listWorktrees(exec);
              const managed = managedWorktrees(all, root);
              if (managed.length === 0) { ctx.ui.notify("No active worktrees.", "info"); return; }

              const lines: string[] = [];
              for (const wt of managed) {
                const n = path.basename(wt.path);
                const s = await worktreeStatus(exec, wt.path);
                lines.push(`${n}  ${s.clean ? "✓ clean" : `✗ ${s.files.length} changed`}`);
              }
              ctx.ui.notify(lines.join("\n"), "info");
              return;
            }

            const { wtPath, entry } = await resolveWorktree(name);
            const status = await worktreeStatus(exec, wtPath);
            const ab = await aheadBehind(exec, entry.branch, entry.baseBranch);
            const lines = [
              `${name}  branch: ${entry.branch}  base: ${entry.baseBranch}`,
              `  ↑${ab.ahead} ahead  ↓${ab.behind} behind`,
              `  ${status.clean ? "✓ clean" : `✗ ${status.files.length} changed file(s)`}`,
            ];
            if (!status.clean) for (const f of status.files) lines.push(`    ${f}`);
            ctx.ui.notify(lines.join("\n"), "info");
            return;
          }

          case "merge": {
            const name = parts[1];
            if (!name) { ctx.ui.notify("Usage: /wt merge <name> [into-branch]", "error"); return; }

            const { wtPath, entry } = await resolveWorktree(name);
            const target = parts[2] || entry.baseBranch;

            const status = await worktreeStatus(exec, wtPath);
            if (!status.clean) {
              ctx.ui.notify(`Worktree "${name}" has uncommitted changes — commit or stash first.`, "error");
              return;
            }

            const mainBranch = await currentBranch(exec);
            if (mainBranch !== target) await checkoutBranch(exec, target);

            const result = await mergeBranch(exec, entry.branch, `Merge ${entry.branch} into ${target}`);
            if (!result.success) {
              await abortMerge(exec);
              if (mainBranch && mainBranch !== target) await checkoutBranch(exec, mainBranch);
              ctx.ui.notify(`Merge failed: ${result.message}`, "error");
              return;
            }

            await removeWorktree(exec, wtPath, true);
            await deleteBranch(exec, entry.branch, true);
            delete state.worktrees[name];
            persistState();
            updateStatusBar(ctx);

            ctx.ui.notify(`Merged "${name}" into ${target} and cleaned up.`, "info");
            return;
          }

          case "remove":
          case "rm": {
            const name = parts[1];
            if (!name) { ctx.ui.notify("Usage: /wt remove <name>", "error"); return; }

            const { wtPath, entry } = await resolveWorktree(name);
            const status = await worktreeStatus(exec, wtPath);

            if (!status.clean && ctx.hasUI) {
              const ok = await ctx.ui.confirm(
                "Uncommitted changes",
                `Worktree "${name}" has ${status.files.length} changed file(s). Remove anyway?`,
              );
              if (!ok) { ctx.ui.notify("Cancelled.", "info"); return; }
            }

            await removeWorktree(exec, wtPath, true);
            await deleteBranch(exec, entry.branch, true);
            delete state.worktrees[name];
            persistState();
            updateStatusBar(ctx);

            ctx.ui.notify(`Removed worktree "${name}" and branch ${entry.branch}.`, "info");
            return;
          }

          case "pr": {
            const name = parts[1];
            if (!name) { ctx.ui.notify("Usage: /wt pr <name> [--draft]", "error"); return; }

            const { wtPath, entry } = await resolveWorktree(name);
            const draft = parts.includes("--draft");
            const base = entry.baseBranch;

            // Push
            await pushBranch(exec, entry.branch, "origin", wtPath);

            // Check for existing PR
            const prView = await exec("gh", ["pr", "view", "--json", "number,url"], { cwd: wtPath });
            if (prView.code === 0) {
              const pr = JSON.parse(prView.stdout);
              ctx.ui.notify(`Pushed. PR #${pr.number} updated: ${pr.url}`, "info");
              return;
            }

            // Prompt for title
            let title: string | undefined;
            if (ctx.hasUI) {
              title = await ctx.ui.input("PR title", name.replace(/[-_]/g, " "));
            }
            if (!title) title = name.replace(/[-_]/g, " ");

            const log = await logOneline(exec, base, entry.branch, wtPath);
            const body = log
              ? `## Changes\n\n${log.split("\n").map((l) => `- ${l}`).join("\n")}`
              : "";

            const createArgs = ["pr", "create", "--title", title, "--body", body, "--base", base];
            if (draft) createArgs.push("--draft");

            const r = await exec("gh", createArgs, { cwd: wtPath });
            if (r.code !== 0) { ctx.ui.notify(`PR creation failed: ${r.stderr}`, "error"); return; }
            ctx.ui.notify(`PR created: ${r.stdout.trim()}`, "info");
            return;
          }

          case "cleanup": {
            const root = await requireGitRepo();
            const all = await listWorktrees(exec);
            const managed = managedWorktrees(all, root);

            if (managed.length === 0) { ctx.ui.notify("No worktrees to clean up.", "info"); return; }

            if (ctx.hasUI) {
              const names = managed.map((w) => path.basename(w.path)).join(", ");
              const ok = await ctx.ui.confirm(
                "Remove all worktrees?",
                `This will remove ${managed.length} worktree(s): ${names}\n\nBranches will also be deleted.`,
              );
              if (!ok) { ctx.ui.notify("Cancelled.", "info"); return; }
            }

            for (const wt of managed) {
              const name = path.basename(wt.path);
              await removeWorktree(exec, wt.path, true);
              if (wt.branch) await deleteBranch(exec, wt.branch, true).catch(() => {});
              delete state.worktrees[name];
            }
            await pruneWorktrees(exec);
            persistState();
            updateStatusBar(ctx);

            ctx.ui.notify(`Removed ${managed.length} worktree(s).`, "info");
            return;
          }

          default:
            ctx.ui.notify(`Unknown subcommand: "${sub}"\n\n${HELP_TEXT}`, "error");
        }
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });

  // ── Hooks ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Restore state from session entries
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === STATE_TYPE && entry.data) {
        const data = entry.data as WorktreeState;
        if (data.worktrees) state.worktrees = data.worktrees;
      }
    }
    // Reconcile with actual git state
    try {
      await reconcileState();
    } catch {
      // Not a git repo or other issue — that's fine
    }
    updateStatusBar(ctx);
  });

  pi.on("before_agent_start", async (event) => {
    const names = Object.keys(state.worktrees);
    if (names.length === 0) return;

    const lines = names.map((name) => {
      const wt = state.worktrees[name];
      return `  - **${name}**: branch=\`${wt.branch}\`, path=\`${wt.path}\`, base=\`${wt.baseBranch}\``;
    });

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n## Active Git Worktrees\n" +
        lines.join("\n") +
        "\n\nUse `wt_exec` to run commands in a worktree. " +
        "Use the `subagent` tool with `cwd` set to a worktree path to delegate isolated work.",
    };
  });

  // ── Prompt guidelines ──────────────────────────────────

  // These are set on wt_create since it's the primary entry point
  // and guidelines are system-prompt level.

  // ── Status bar ─────────────────────────────────────────

  function updateStatusBar(ctx: ExtensionContext): void {
    const count = Object.keys(state.worktrees).length;
    if (count > 0) {
      ctx.ui.setStatus("worktree", `🌳 ${count} worktree${count !== 1 ? "s" : ""}`);
    } else {
      ctx.ui.setStatus("worktree", undefined);
    }
  }
}

// ── Help text ──────────────────────────────────────────────

const HELP_TEXT = `/wt — Git worktree manager

Subcommands:
  create <name> [base]    Create a worktree with a new branch (wt/<name>)
  list                    List active worktrees
  status [name]           Show worktree status (all or specific)
  merge <name> [into]     Merge worktree branch and clean up
  remove <name>           Remove a worktree (prompts if dirty)
  pr <name> [--draft]     Push branch and open/update a PR
  cleanup                 Remove all worktrees and prune

Examples:
  /wt create auth-refactor          Create from current branch
  /wt create fix-bug main           Create from main branch
  /wt status auth-refactor          Check for changes
  /wt merge auth-refactor           Merge into base and clean up
  /wt pr auth-refactor --draft      Push and open a draft PR
  /wt cleanup                       Remove all worktrees

Worktrees are created under .worktrees/ (auto-gitignored).
Each gets a branch prefixed with wt/ (e.g. wt/auth-refactor).`;
