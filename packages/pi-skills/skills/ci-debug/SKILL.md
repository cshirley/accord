---
name: ci-debug
description: Triage failing PR CI — merge state, checks, and GitHub Actions log excerpts. Use when CI is red, checks fail, or pr-babysit needs root cause before fixes.
---

# CI Debug

Fast triage for **current branch PR** CI. Pairs with **`pr-babysit`** (merge-ready loop); this skill is **diagnose**, not babysit.

## Invocation

| Step | Tool |
|------|------|
| PR + branch context | `gh_pr_context` (optional) |
| CI state + failed logs | `gh_ci_context` |
| Local reproduce | `/verify` skill → `repo_verify` with `filter` matching failed job |

- **Do not** scrape `gh api` ad hoc when `gh_ci_context` is available.
- **Do not** paste full workflow logs into chat — summarize from tool excerpts.

## Process

1. `gh_ci_context` — note `mergeStateStatus`, failing checks, log excerpts.
2. Map failure to local command (unit test, lint, build). Call `repo_harness_context` if unsure.
3. `repo_verify` with `filter` (e.g. `jest`, `test:ci`) or fix config and re-run.
4. After fix, `/verify` then push; hand off to **pr-babysit** or `/pr` for merge-ready.

## Rules

- External checks (third-party) may have no workflow log — report and ask user.
- If no PR on branch, use `/pr` first or specify branch in user message.
