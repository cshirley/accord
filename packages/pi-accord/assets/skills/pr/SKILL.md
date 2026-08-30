---
name: pr
description: Push the current branch and open a PR, or update the existing PR if one is already open. Use when the user asks to push, open a PR, update a PR, or ship their changes.
---

# PR

Push current branch and open or update a pull request.

## Process

1. Call `gh_pr_context` — gathers existing PR, branch/ticket, commits, diffstat, spec doc, verify report in one call
2. Review response:
   - **ghAuth** false → tell user to run `gh auth login`, stop
   - **existingPr** exists → **Update flow** (step 3a)
   - **existingPr** null → **Create flow** (step 3b)

### 3a. Update flow
- Call `gh_pr_submit` with no title/body (push-only; sets upstream/tracking with `git push --set-upstream origin HEAD`)
- Report: `Pushed to <branch>. PR #<number> updated: <url>`

### 3b. Create flow
- Draft **title**: `[TICKET-ID] short imperative summary` (≤70 chars)
  - Single commit → use its subject line
  - Multiple commits → summarise
- Draft **body** using sections below, enriched from spec/verify when available
- Call `gh_pr_submit` with title + body (sets upstream/tracking with `git push --set-upstream origin HEAD`)
- Report new PR URL

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
<If verify report: extract verdict, check results, AC table from report content.>
<If no report:>
⚠️ No verification report — run `/dev finish <ID>` before merging.

## Risks / notes
<From spec risks section + verify report gaps. Omit if nothing to note.>

🤖 Generated with pi.dev
```

## Rules

- Never force push
- Never target a branch other than repo default unless user specifies
- Push rejection → stop, tell user to pull/rebase. Do not force push.
