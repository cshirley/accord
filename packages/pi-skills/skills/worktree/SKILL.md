---
name: worktree
description: Create, list, run commands in, or resolve git worktrees for parallel ticket work. Use when the user mentions worktrees, STEP/CLD branches, or working in .worktrees paths.
---

# Worktree

Two patterns in this environment:

1. **pi-git managed** — `.worktrees/<name>` with branch `wt/<name>` (`wt_*` tools, `/wt` command).
2. **Ticket worktrees** — existing trees under `.worktrees/STEP-*` (or similar) created outside pi-git.

## Tools

- If a tool is **not active**, call `search_accord_tools` first (progressive discovery), then use the exact tool name.

| Goal | Tool |
|------|------|
| Create pi-git worktree | `wt_create` |
| List managed worktrees | `wt_list` |
| Status / merge / remove | `wt_status`, `wt_merge`, `wt_remove` |
| Run command in managed tree | `wt_exec` |
| Push + PR from managed tree | `wt_pr` |
| Find any worktree by ticket/path | `git_worktree_resolve` |
| Run verify in resolved tree | `repo_verify` with `worktree` param |

## Process

**New parallel task (greenfield):**

1. `wt_create` with short name (e.g. `step-12748`).
2. `wt_exec` for install/test, or set subagent `cwd` to the worktree path from `wt_list`.
3. `wt_pr` when ready.

**Existing ticket worktree:**

1. `git_worktree_resolve` with ticket id.
2. Use returned `path` as session cwd, or `wt_exec` / `repo_verify` with `worktree` — **avoid** long `cd` chains in bash.

## Rules

- Do not delete worktrees (`wt_remove`) without user confirmation if dirty.
- `wt_merge` only when user wants land + cleanup.
- For specced multi-phase delivery with `/dev`, install the full ACCORD package separately; this skill does not require it.
