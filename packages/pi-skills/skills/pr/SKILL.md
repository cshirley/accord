---
name: pr
description: Push the current branch and open a PR, or update the existing PR if one is already open. Use when the user asks to push, open a PR, update a PR, or ship their changes.
---

# PR

Push current branch and open or update a pull request.

## Invocation

PR flow uses **Pi tools from `pi-git`**, not shell `git push`/`gh pr` and not `accord-mcp` (`dev_*` only).

| Step | Tool name (exact) |
|------|-------------------|
| Gather context | `gh_pr_context` |
| Push + create/update PR | `gh_pr_submit` |

- **Pi TUI:** call those names from the agent tool list.
- **Cursor + pi package:** same names, often bridged as `mcp_pi_gh_pr_context` / `mcp_pi_gh_pr_submit`. Names are not truncated.
- **Do not** run `git push` / `gh pr create` in bash, and do not search MCP/bash to “find” these tools.
- If a tool is **not active**, call `search_accord_tools` first (progressive discovery), then use the exact tool name.
- If they are missing, ask the user to run `bun run install:pi-skills` (harness-free) or `pi install` **pi-git** from this monorepo.

## Process

0. **Gates** (run in the PR's worktree; paths relative to this skill):
   - `../verify/scripts/green.sh check` — exit 1 or 2: run the `verify` skill first.
   - `../verify/scripts/green.sh check review` — exit 1 or 2: run the `review` skill first (it marks on completion).
   - Unfixed **Critical** findings from the last review block the PR unless the user explicitly accepts the risk.
   - Exit 3 (not a git repo): skip.
   - **Skip** a gate only when the user explicitly says so. Record each skip and its reason in the PR body under `## Risks / notes`.
1. Call `gh_pr_context` — gathers existing PR, branch/ticket, commits, diffstat, spec doc, verify report in one call
2. Review response:
   - **ghAuth** false → tell user to run `gh auth login`, stop
   - **existingPr** exists → **Update flow** (step 3a)
   - **existingPr** null → **Create flow** (step 3b)

### 3a. Update flow
- Call `gh_pr_submit` with no title/body (push-only; sets upstream/tracking with `git push --set-upstream origin HEAD`)
- Report: `Pushed to <branch>. PR #<number> updated: <url>`
- Then run the **CI check** (below)

### 3b. Create flow
- Draft **title**: `[TICKET-ID] short imperative summary` (≤70 chars)
  - Single commit → use its subject line
  - Multiple commits → summarise
- Draft **body** using sections below, enriched from spec/verify when available
- Call `gh_pr_submit` with title + body (sets upstream/tracking with `git push --set-upstream origin HEAD`)
- Report new PR URL
- Then run the **CI check** (below)

### CI check (after every submit)

Call `gh_ci_context` once after the push. Report each check as pass, fail or pending, with the failing job names.
- **Fail:** hand off to the `ci-debug` skill. Do not call the PR ready.
- **Pending:** say so. Do not claim CI passed. Offer `pr-babysit` to wait.
- **Passed:** report it.
Never end the turn without reporting the CI state.

## PR Body Structure

```markdown
## Summary
<1-2 sentences: problem + solution. Use spec problem statement if available.>
- <what changed — bullets>

## Acceptance criteria
<If spec has ACs, copy as checklist:>
- [ ] AC-1 [MUST]: <criterion>
<If no spec: omit section>

## Test plan
<Commands to verify. From spec if available.>

## Verification evidence
Verify gate: <green at tree <hash> | skipped — reason>
Review gate: <reviewed at tree <hash>, <n> critical / <n> warning open | skipped — reason>
<If verify report: extract verdict, check results, AC table from report content.>
<If no report:>
⚠️ No verification report — run `/dev finish <ID>` before merging.

## Risks / notes
<From spec risks section + verify report gaps. Omit if nothing to note.>

🤖 Generated with pi.dev
```

## Rules

- Never open or update a PR with a failing verify or review gate without an explicit, recorded skip
- Gate only: no stack, retarget or `Accord:` evidence-section changes here; those belong to ASDLC-1 (`stack-compute`, `trunk-hardening`, `evidence-asset`)
- Never force push
- Never target a branch other than repo default unless user specifies
- Push rejection → stop, tell user to pull/rebase. Do not force push.
