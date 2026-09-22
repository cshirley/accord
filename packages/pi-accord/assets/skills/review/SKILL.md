---
name: review
description: Standalone code review on the current git diff — reuses review-code, review-security, and review-test outside the ACCORD implement pipeline. No spec, plan, or work item required. For quick fixes, ad-hoc changes, or pre-commit sanity checks in any repo.
---

# Review

General-purpose diff review. Reuses the same `review-*` agents as the ACCORD harness, but **outside** the `/dev` workflow — no work item, no spec, no plan, no orchestrator. Point it at whatever is on disk and get a merged findings report.

**Contract:** Behaviour matches `@clive.shirley/accord-core/review/standalone.js` (`prepareStandaloneReviewContext`, `buildStandaloneReviewTasks`, `synthesizeStandaloneReviewReport`). When changing this skill, update that module (and `accord review`) so Pi and CLI stay aligned.

| Surface | Execution |
| --- | --- |
| `/review` (this skill) | `git_review_context` → parallel `subagent` `tasks[]` in Pi |
| `accord review` | Same helpers; harness spawns reviewers **in parallel** (`--harness pi` / exec) |

## Invocation

Standalone review uses **`pi-git-tools`** for the diff ladder and **`pi-subagent`** for reviewers — not shell `git diff` and not `accord-mcp` (`dev_*` only).

| Step | Tool name (exact) |
|------|-------------------|
| Diff ladder + temp file | `git_review_context` |
| Run review agents in parallel | `subagent` (single call, `tasks[]`) |

- **Pi TUI:** call those names from the agent tool list.
- **Cursor + pi package:** `git_review_context` is often bridged as `mcp_pi_git_review_context`; `subagent` may appear as `mcp_pi_subagent` or similar. Names are not truncated.
- **Do not** paste the full diff into subagent briefs; reviewers read `details.diff_path` from `git_review_context`.
- **Do not** search MCP/bash to “find” these tools. If missing, ask the user to `pi install` this repo and confirm `pi-git-tools` and `pi-subagent` are under `pi.extensions` in root `package.json`.

## When to use

| Use `/review` (this skill) | Use `/dev resume` (ACCORD harness) |
| --- | --- |
| Ad-hoc or pre-commit review of local changes | Implementing a specced task through the full pipeline |
| No `docs/dev/<ID>/` artifacts | Spec, plan, and task files drive drift checks |
| Infer intent from the diff alone | AC coverage, plan steps, and guidance are enforced |

## Step 1 — Gather review context

Call **`git_review_context`** (no parameters). It runs the same ladder as `gatherStandaloneReviewDiff`:

1. Staged diff (`git diff --staged`)
2. Else unstaged (`git diff`)
3. Else branch (`git diff origin/HEAD...HEAD`)

If git errors (e.g. missing `origin/HEAD`) or every step is empty, report the tool error and stop.

The tool **always** writes the **full** raw diff to an absolute temp path (`details.diff_path` under `details.temp_dir`). Reviewers read that file — never inline the full diff in subagent briefs.

From `details`:

- `source`, `file_list`, `diff_path`, `temp_dir`, `excerpt` (orchestrator display only)
- `has_test_files`, `test_command` when tests may apply

When the review finishes (success or failure), delete `details.temp_dir` (e.g. `rm -rf`).

## Step 1b — Gather test output (when test files changed)

When `details.has_test_files` is true, run tests once:

1. Use `details.test_command` when set (from `AGENTS.md` `test.command` or `package.json` `scripts.test`).
2. Else use `test_output: "(not run)"` and note in synthesis.

Capture stdout/stderr as `{test_output}`; truncate to the last **64 KiB** if larger (`truncateStandaloneTestOutput`).

## Step 2 — Launch agents in parallel

Call the **`subagent` tool once** in parallel mode. Do **not** use the Cursor `Task` tool, and do **not** make separate sequential `subagent` calls — independence requires a single `tasks` array so all reviewers start together.

All briefs are **standalone**: no spec, no plan, no drift checks. Agents infer intent from the diff file only.

Build `tasks` with `buildStandaloneReviewTasks`:

```ts
buildStandaloneReviewTasks({
  diff_path: details.diff_path,
  source: details.source,
  file_list: details.file_list,
  test_output, // when Step 1b ran
})
```

| Agent | Include when |
| --- | --- |
| `review-code` | always |
| `review-security` | always |
| `review-test` | `has_test_files` |

Each task tells reviewers to read `diff_path` (absolute path, `source` in text). Do not paste the diff into the task string.

Resolve agents by name (`review-code`, `review-security`, `review-test`). They must be installed in the Pi agent directory (e.g. via `bun run install:assets` in an ACCORD checkout, or equivalent copies under `~/.config/pi/agent/agents/`).

## Step 3 — Synthesise

Parse each agent's return packet (last fenced `json` block in its output, or `parsedReturn` when using CLI). Map each `findings[]` entry to:

- **message** ← `message`, else `issue`, else `summary`
- **file** / **line** when present

Merge by severity across agents. **Security** and **Test Quality** sections repeat findings from those agents for visibility; they are not deduped out of Critical/Warnings/Suggestions.

Mirror `synthesizeStandaloneReviewReport`:

```
## Review

### Critical
<must-fix findings from any agent — bullet: **agent** (severity) `file:line`: message>

### Warnings
<should-fix>

### Suggestions
<nice-to-have>

### Security
<review-security findings, or "No security issues found.">

### Test Quality
<only when review-test ran — findings or "No test issues found.">

### Agent failures
<when any subagent exitCode !== 0 or isError — agent name and error; keep partial findings from others>

---
Simplification opportunities: N
Quality issues: N
Security issues: N
Test quality issues: N
```

- If `review-test` did not run, **omit** the Test Quality section and set test quality issues to **0**.
- Empty severity sections: `(none)`.
- Footer counts: suggestions → simplification; critical + warning → quality; security/test counts exclude suggestion-severity items from those agents.
- Delete `details.temp_dir` after synthesis.
