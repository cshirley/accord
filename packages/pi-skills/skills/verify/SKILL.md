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
5. **Record green.** When the **full** harness passes (no `filter`, no `commands` override), run
   `scripts/green.sh mark` from this skill's directory, in the same worktree. This stores a
   fingerprint of the working tree. Do not mark after a filtered or partial run.

## Last-green gate (for commit and PR)

`scripts/green.sh check` compares the current working tree to the last recorded green fingerprint
(tree hash of HEAD plus tracked and untracked, non-ignored files; the real index is untouched).

| Exit | Meaning | Action |
|------|---------|--------|
| 0 | Working tree equals the last verified state | Continue |
| 1 | Edits since last green verify | Run verify (step 3), then `mark` |
| 2 | No green recorded in this worktree | Run verify, then `mark` |
| 3 | Not a git repo | Skip the gate |

- A commit of the verified tree stays green (hash is content-based, not SHA-based).
- The marker is per worktree: `git rev-parse --git-path accord/last-green`.
- `green.sh <mark|check|show> review` uses a separate marker (`last-review`), written by the `review` skill and read by `pr`.
- `commit` and `pr` skills should call `check` before committing or opening a PR.
  Skipping needs an explicit reason from the user.
- Host-neutral: the script needs only `git` and `bash`. Without pi tools, run the
  `verification_commands` from `AGENTS.md ## Dev Harness` yourself, then `mark`.

## Rules

- Prefer `filter` over editing harness commands.
- Monorepo app cwd: resolve worktree first; verify runs at git root of that worktree unless user specifies `cwd`.
- After green verify, suggest `/review` or `/commit` as next step — do not auto-commit.
