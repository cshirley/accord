---
name: review
description: Run a standalone code review on the current diff using review-code and review-test in parallel. Works without a spec or plan — for quick fixes, ad-hoc changes, or pre-commit sanity checks.
---

# Review

Runs code review and test review in parallel, then synthesises the output.

## Step 1 — Gather the diff

```bash
git diff --staged
git diff --staged --name-only
```

If nothing staged, fall back to unstaged:

```bash
git diff
git diff --name-only
```

If still empty, diff against the default branch:

```bash
git diff origin/HEAD...HEAD
git diff --name-only origin/HEAD...HEAD
```

If all empty, tell the user there is nothing to review. Stop.

## Step 2 — Launch both agents in parallel

Spawn simultaneously. Both receive the diff and changed file list; neither has spec or plan context so skip Drift and TC completeness checks.

### Agent 1 — review-code

Brief: "Review the following diff. There is no spec or plan — skip the Drift section entirely. Changed files: `{file_list}`. Diff: `{diff}`"

### Agent 2 — review-test

Only launch if the changed file list includes any test files. Match against these patterns (covering common stacks):
- `*.test.*`, `*.spec.*`, `*_test.go`, `*_test.rs`, `test_*.py`, `*_spec.rb`, `*Test.java`, `*Tests.cs`
- Paths containing `/test/`, `/__tests__/`, `/tests/`, `/spec/`

If no test files changed, skip this agent.

Brief: "Review test quality in the following diff. `mode: post-impl`. There is no spec — skip completeness (Check 1) and AC traceability (Check 3). Review assertion specificity, scenario fidelity, and execution behaviour only. Changed files: `{file_list}`. Diff: `{diff}`. Test output: `{test_output}`."

## Step 3 — Synthesise

Once both complete, produce a single report:

```
## Review

### Critical
<must-fix findings from either agent>

### Warnings
<should-fix findings>

### Suggestions
<nice-to-have>

### Test Quality
<review-test findings, or "No test files changed.">

---
Simplification opportunities: N
Quality issues: N
Test quality issues: N
```

If only one agent ran, omit the other's section.
