---
name: verify
description: Run the project's Dev Harness verification commands in the correct directory (main repo or ticket worktree). Use when the user asks to run tests, lint, typecheck, check, or verify before commit/PR.
---

# Verify

Run **`verification_commands`** from `AGENTS.md` without hand-rolled `cd` + `yarn jest` loops.

## Invocation

| Step | Tool |
|------|------|
| Load harness | `repo_harness_context` |
| Resolve ticket worktree (optional) | `git_worktree_resolve` |
| Execute | `repo_verify` |

- **Do not** guess test commands when a Dev Harness block exists — call `repo_harness_context` first.
- **Do not** `cd` into `.worktrees/...` in bash when `git_worktree_resolve` + `repo_verify` worktree param works.
- **Pi TUI / Cursor:** bridged names may be `mcp_pi_repo_verify`, etc.

## Process

1. If user gave a ticket (`STEP-*`, `CLD-*`) or worktree hint → `git_worktree_resolve` with that query.
2. `repo_harness_context` — note `verification_commands` and language.
3. `repo_verify`:
   - `worktree`: ticket or path fragment when not already in the worktree cwd
   - `filter`: narrow scope (`jest`, `biome`, `check:types`) when user asked for one kind of check
   - `commands`: only when harness is missing and user supplied explicit cmds
4. Report pass/fail from tool output. On failure, fix or hand off — do not re-run full suite in a loop without changing code.

## Rules

- Prefer `filter` over editing harness commands.
- Monorepo app cwd: resolve worktree first; verify runs at git root of that worktree unless user specifies `cwd`.
- After green verify, suggest `/review` or `/commit` as next step — do not auto-commit.
