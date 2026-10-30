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

## Pin the worktree (do this before the first edit)

Whenever the user names a ticket, branch or worktree, or the cwd is under `.worktrees/`, pin one root
and state it in your next message:

```
Worktree: <absolute path>   Branch: <branch>   Ticket: <id or none>
```

1. Resolve it: `git_worktree_resolve`, or `scripts/wt-guard.sh find '<ticket>'` (path relative to this `SKILL.md`; call it by absolute path). **Single-quote every value you substitute** (ticket ids, paths) and write an embedded `'` as `'\''`; never use double quotes, where `$(…)` and backticks run.
2. Inspect it: `scripts/wt-guard.sh where '<path>'` — shows `kind=linked-worktree|main-checkout` and all sibling worktrees.
3. **Stop and ask** if any of these hold:
   - `kind=main-checkout` while a worktree matching the named ticket or branch exists.
   - More than one worktree matches the query.
   - The user named a worktree and you are not in it.
4. Before each batch of edits, writes or commands that take paths, check them:
   `scripts/wt-guard.sh inside '<pinned-root>' '<path>'...` — exit 1 lists the offenders. Do not edit
   them. Tell the user, and either switch the pin (with their confirmation) or fix the path.
5. Subagent tasks: pass the pinned path as `cwd` and name it in the brief.
6. Re-state the pin after context compaction or when switching tickets.

The pin is per task. A second ticket gets its own worktree; never reuse one for another ticket.
Host-neutral: the script needs only `git` and `bash`; `git_worktree_resolve` and `wt_*` are optional.

## Rules

- All edits, tests and git commands for a ticket target its pinned worktree. Never fall back to the main checkout without telling the user.
- When `wt_remove` or `work remove` fails, report the exact error and `wt_status` output. Do not retry blindly or delete the directory by hand.
- Do not delete worktrees (`wt_remove`) without user confirmation if dirty.
- `wt_merge` only when user wants land + cleanup.
- For specced multi-phase delivery with `/dev`, install the full ACCORD package separately; this skill does not require it.
