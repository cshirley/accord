---
name: review
description: Standalone code review on the current git diff via review-code, review-security, and review-test. No /dev harness, spec, plan, or work item. For quick fixes, ad-hoc changes, or pre-commit checks in any repo.
---

# Review

General-purpose diff review using `review-*` subagents. No `/dev` workflow — point at local changes and get a merged findings report.

**Contract:** Behaviour matches `@clive.shirley/accord-core/review/standalone.js` (`prepareStandaloneReviewContext`, `buildStandaloneReviewTasks`, `synthesizeStandaloneReviewReport`). When changing this skill, update that module (and `accord review`) so Pi and CLI stay aligned.

| Surface | Execution |
| --- | --- |
| `/review` (this skill) | `git_review_context` → `git_review_tasks` → one `subagent` `tasks[]` |
| `accord review` (CLI only) | For terminals/CI — **not** this skill; do not spawn from Pi/Cursor review |

## Forbidden (Pi / Cursor `/review`)

- **Never** run `accord review`, `bun run accord review`, or `bun packages/accord-cli/... review` — that is a separate CLI entry, not the skill.
- **Never** use `accord review --harness pi` as a shortcut; it nests another harness instead of calling `subagent` once.
- **Never** inline the full diff in task strings or shell one-liners that import `accord-core` to spawn agents; use `git_review_tasks` + `subagent`.

## Invocation

Standalone review uses **`pi-git`** for diff + task briefs and **`pi-subagent`** for reviewers — not shell `git diff`, not `accord-mcp` (`dev_*` only), not **`accord review`**.

| Step | Tool name (exact) |
|------|-------------------|
| Diff ladder + temp file | `git_review_context` |
| Build `tasks[]` for reviewers | `git_review_tasks` |
| Run review agents in parallel | `subagent` (single call, pass `details.tasks`) |

- **Pi TUI:** call those names from the agent tool list.
- **Cursor + pi package:** bridged names are often `mcp_pi_git_review_context`, `mcp_pi_git_review_tasks`, `mcp_pi_subagent` (or similar). Names are not truncated.
- **Do not** paste the full diff into subagent briefs; reviewers read `details.diff_path` from `git_review_context`.
- **Do not** search MCP/bash to “find” these tools. If missing, ask the user to run `bash scripts/install-pi-skills.sh` from the accord monorepo (or `pi install` **pi-git** + **pi-subagent** + **pi-skills**).

## When to use

| Use `/review` | Use full ACCORD `/dev` (optional separate install) |
| --- | --- |
| Ad-hoc or pre-commit review of local changes | Specced implement pipeline with work items |
| Infer intent from the diff alone | Spec, plan, AC, and orchestrator enforcement |

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

## Step 2 — Build tasks, then launch agents in parallel

Call **`git_review_tasks`** with:

- `diff_path`, `source`, `file_list` from `git_review_context` `details`
- `test_output` when Step 1b ran (omit otherwise)

Then call **`subagent` once** with `{ tasks: details.tasks }` from that tool. Do **not** use the Cursor `Task` tool; do **not** make separate sequential `subagent` calls.

| Agent | Include when |
| --- | --- |
| `review-code` | always |
| `review-security` | always |
| `review-test` | `has_test_files` |

Briefs are standalone (no spec/plan). Reviewers read `diff_path` on disk — never paste the diff into the task string.

Agents resolve by name (`review-code`, `review-security`, `review-test`) under `~/.config/pi/agent/agents/accord/`. Install without the harness: `bun packages/pi-skills/scripts/install-review-agents.ts --force` (or `bash scripts/install-pi-skills.sh`).

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
