---
name: review
description: Standalone code review on the current git diff — reuses review-code, review-security, and review-test outside the ACCORD implement pipeline. No spec, plan, or work item required. For quick fixes, ad-hoc changes, or pre-commit sanity checks in any repo.
---

# Review

General-purpose diff review. Reuses the same `review-*` agents as the ACCORD harness, but **outside** the `/dev` workflow — no work item, no spec, no plan, no orchestrator. Point it at whatever is on disk and get a merged findings report.

## When to use

| Use `/review` (this skill) | Use `/dev resume` (ACCORD harness) |
| --- | --- |
| Ad-hoc or pre-commit review of local changes | Implementing a specced task through the full pipeline |
| No `docs/dev/<ID>/` artifacts | Spec, plan, and task files drive drift checks |
| Infer intent from the diff alone | AC coverage, plan steps, and guidance are enforced |

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

## Step 1b — Gather test output (when test files changed)

If the changed file list includes any test files (patterns below), run the **current repo's** test command once and capture stdout/stderr as `{test_output}` (truncate to the last 64 KiB if larger). If tests cannot be run, use `test_output: "(not run)"` and note that in synthesis.

Test file patterns:
- `*.test.*`, `*.spec.*`, `*_test.go`, `*_test.rs`, `test_*.py`, `*_spec.rb`, `*Test.java`, `*Tests.cs`
- Paths containing `/test/`, `/__tests__/`, `/tests/`, `/spec/`

## Step 2 — Launch agents in parallel

Call the **`subagent` tool once** in parallel mode. Do **not** use the Cursor `Task` tool, and do **not** make separate sequential `subagent` calls — independence requires a single `tasks` array so all reviewers start together.

All briefs are **standalone**: no spec, no plan, no drift checks. Agents infer intent from the diff only.

Build `tasks` dynamically:

| Agent | Include when |
| --- | --- |
| `review-code` | always |
| `review-security` | always |
| `review-test` | test files in the changed list (Step 1b patterns) |

Example (include the `review-test` entry only when test files changed):

```
subagent({
  tasks: [
    {
      agent: "review-code",
      task: "Review the following diff. There is no spec or plan — skip the Drift section entirely. Changed files: `{file_list}`. Diff: `{diff}`"
    },
    {
      agent: "review-security",
      task: "Review the following diff for security issues (OWASP A01–A10). There is no spec or plan — infer intent from the diff only. Flag only security-relevant issues; general correctness belongs to review-code. Changed files: `{file_list}`. Diff: `{diff}`"
    },
    {
      agent: "review-test",
      task: "Review test quality in the following diff. `mode: post-impl`. There is no spec — skip Check 1 (per-AC adversarial analysis against spec ACs), Check 3/3b (AC negation and inventory), and Check 7 (spec contract). Run Checks 1b, 2, 4, 5, and 6 on changed tests. Changed files: `{file_list}`. Diff: `{diff}`. Test output: `{test_output}`"
    }
  ]
})
```

Resolve agents by name (`review-code`, `review-security`, `review-test`). They must be installed in the Pi agent directory (e.g. via `bun run install:assets` in an ACCORD checkout, or equivalent copies under `~/.config/pi/agent/agents/`).

## Step 3 — Synthesise

Parse each agent's return packet (last fenced `json` block in its output). Merge `findings[]` by severity across agents. Produce a single report:

```
## Review

### Critical
<must-fix findings from any agent>

### Warnings
<should-fix findings>

### Suggestions
<nice-to-have>

### Security
<review-security findings, or "No security issues found.">

### Test Quality
<review-test findings, or "No test files changed.">

---
Simplification opportunities: N
Quality issues: N
Security issues: N
Test quality issues: N
```

If `review-test` did not run, omit the Test Quality section and set test quality issues to 0.

If any subagent failed (`exitCode !== 0` or `isError`), report which agent failed and include partial findings from the others.
