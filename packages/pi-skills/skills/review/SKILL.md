---
name: review
description: Standalone code review on the current git diff via review-code, review-security, and review-test. No /dev harness, spec, plan, or work item. For quick fixes, ad-hoc changes, or pre-commit checks in any repo.
---

# Review

General-purpose diff review using `review-*` subagents. No `/dev` workflow — point at local changes and get a merged findings report.

**Contract:** Task briefs and synthesis match `@clive.shirley/accord-core/review/standalone.js` (`buildStandaloneReviewTasks`, `synthesizeStandaloneReviewReport`). Pi may **overlap** test execution with `review-code` / `review-security` (two `subagent` waves when `has_test_files`); `accord review` CLI still runs tests before all agents in one parallel batch.

| Surface | Execution |
| --- | --- |
| `/review` (this skill) | `git_review_context` → (optional) tests ∥ code+security `subagent` → `review-test` `subagent` → synthesise |
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
| Run reviewers | `subagent` — one call when no test files; **two** calls when `has_test_files` (see Step 2) |

- **Pi TUI:** call those names from the agent tool list.
- **Cursor + pi package:** bridged names are often `mcp_pi_git_review_context`, `mcp_pi_git_review_tasks`, `mcp_pi_subagent` (or similar). Names are not truncated.
- **Do not** paste the full diff into subagent briefs; reviewers read `details.diff_path` from `git_review_context`.
- **Do not** search MCP/bash to “find” these tools. If missing, ask the user to run `bash scripts/install-pi-skills.sh` from the accord monorepo (or `pi install` **pi-git** + **pi-subagent** + **pi-skills**).

## When to use

| Use `/review` | Use full ACCORD `/dev` (optional separate install) |
| --- | --- |
| Ad-hoc or pre-commit review of local changes | Specced implement pipeline with work items |
| Infer intent from the diff alone | Spec, plan, AC, and orchestrator enforcement |

## Repo root and worktrees

`git_review_context` resolves **`git rev-parse --show-toplevel`** from the session `cwd` (subdirectory of a repo is fine). Diff, `test_command`, and harness lookup use that path — returned as **`details.repo_root`**.

| Situation | What to do |
| --- | --- |
| Ticket / `.worktrees/...` tree | `git_worktree_resolve` (same as **verify**) → use returned **`path`** as session **`cwd`** before `git_review_context`, **or** `cd` there once so Pi’s `cwd` matches the worktree |
| pi-git managed tree | `wt_list` / `wt_exec` for shell; for `/review`, set session **`cwd`** to the worktree path (see **worktree** skill) |
| Wrong tree reviewed | User edited files in worktree A but agent `cwd` is main checkout → ladder reflects **wrong** repo state. Fix `cwd`, re-run Step 1 |

## Step 1 — Gather review context

Call **`git_review_context`** (no parameters) from the intended checkout **`cwd`** (see above). It runs the same ladder as `gatherStandaloneReviewDiff`:

1. **Local** — merged `git diff --cached` + `git diff` (staged **and** unstaged vs `HEAD`)
2. **Else branch** — `git diff origin/HEAD...HEAD` (commits on current branch not on `origin/HEAD`)

**First non-empty step wins** — only **one** source per run.

| `details.source` | What was reviewed | Common user intent |
| --- | --- | --- |
| `local` | All uncommitted changes (staged + unstaged) | Pre-commit / “everything I’m editing now” |
| `branch` | Clean index and working tree; branch-only diff | “Everything on my branch vs upstream” |

**Ladder traps (tell the user in synthesis):**

- **Uncommitted changes exist** → **`local`** wins; committed-only branch delta is **not** included until index and working tree are clean (then re-run for `branch`).
- **“Review my last commit”** → with a clean tree, `branch` may include that commit among others since `origin/HEAD`. For one commit only, user should say so or provide a explicit rev range (not built into the ladder).
- **Empty ladder** → tool error or `details.empty`; nothing to review. Suggest `git status` and which layer they want.
- **`origin/HEAD` missing** → branch step fails; fix remote/HEAD or make local changes to review via `local`.

Always state **`Source: <local|branch>`** (from tool text or `details.source`) at the top of the synthesized report.

If git errors or every step is empty, report the tool error and stop.

The tool **always** writes the **full** raw diff to an absolute temp path (`details.diff_path` under `details.temp_dir`). Reviewers read that file — never inline the full diff in subagent briefs.

From `details`:

- `repo_root`, `source`, `source_alias`, `local_layers`, `file_list`, `diff_path`, `temp_dir`, `excerpt` (orchestrator display only)
- `has_test_files`, `test_command` when tests may apply

**Tests (wave 1A):** run `test_command` with **`cwd` = `details.repo_root`**.

**Subagent:** spawn with **`cwd` = `details.repo_root`**.

When the review finishes (success or failure), delete `details.temp_dir` (e.g. `rm -rf`).

## Step 2 — Launch reviewers

Briefs are standalone (no spec/plan). Reviewers read `diff_path` on disk — never paste the diff into the task string.

Do **not** use the Cursor `Task` tool. Filter `git_review_tasks` output by `agent` name — never spawn `review-test` before test output exists.

### When `has_test_files` is false

1. Call **`git_review_tasks`** with `diff_path`, `source`, `file_list` (omit `test_output`).
2. Call **`subagent` once** with `{ tasks: details.tasks }` (`review-code`, `review-security` only).

### When `has_test_files` is true — wave 1 (parallel)

Run **both** branches; await **both** before wave 2.

**A — Tests (parent shell, `cwd` = `details.repo_root`)**

1. Use `details.test_command` when set (from `AGENTS.md` `test.command` or `package.json` `scripts.test`).
2. If missing, set `{test_output}` to `"(not run)"` and note in synthesis (still run wave 2 so `review-test` can flag the gap).
3. Else run the command; capture stdout/stderr; truncate to the last **64 KiB** if larger (same cap as `truncateStandaloneTestOutput` in accord-core).

**B — Code + security (subagent, `cwd` = `details.repo_root`)**

1. Call **`git_review_tasks`** with `diff_path`, `source`, `file_list` — **omit** `test_output`.
2. Call **`subagent` once** with `{ tasks }` where each task’s `agent` is `review-code` or `review-security` only (drop `review-test` from the tool response).

### When `has_test_files` is true — wave 2

1. Call **`git_review_tasks`** again with the same paths plus `{test_output}` from branch **A**.
2. Call **`subagent` once** with only the task whose `agent` is `review-test`.

Collect return packets from **all** subagent calls for Step 3.

| Agent | Wave |
| --- | --- |
| `review-code` | 1 (or only wave when no test files) |
| `review-security` | 1 (or only wave when no test files) |
| `review-test` | 2 only when `has_test_files` |

Agents resolve by name (`review-code`, `review-security`, `review-test`) under `~/.config/pi/agent/agents/accord/`. Install without the harness: `bun packages/pi-skills/scripts/install-review-agents.ts --force` (or `bash scripts/install-pi-skills.sh`).

## Step 3 — Synthesise

Parse each agent's return packet: last fenced `json` block in subagent output (same shape as `parseStandaloneReviewAgentResult` in accord-core). On CLI, `parsedReturn` may already be structured. Map each `findings[]` entry to:

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

## After the report — actions and limits

### Severity → what to do

| Severity | Default action |
| --- | --- |
| **Critical** | Block merge/commit until fixed or user explicitly accepts risk; re-run `/review` on the same diff layer after fixes |
| **Warning** | Should fix; user decides before ship |
| **Suggestion** | Optional polish |

Address **Critical** first, then warnings. Agent `findings[]` order is advisory; merged report groups by severity.

**Agent failures** (`exitCode !== 0`, parse errors): treat that agent as incomplete; do not assume “clean” for that dimension. Re-spawn failed agent or narrow scope if user asks.

### Suggested next steps (do not auto-run)

1. Fix findings → stage if pre-commit → `/review` again (confirm `source` still matches intent).
2. Broader confidence → **verify** skill (`repo_verify` / full `verification_commands`) — `/review` only runs `test_command` when the diff touches test-like paths (`has_test_files`).
3. Ship → **commit** / **pr** skills when user asks.

### What standalone `/review` does **not** cover

No work item, spec, plan, or AC — reviewers infer intent from the diff and briefs from `buildStandaloneReviewTasks` only.

| Missing vs full `/dev` pipeline | Effect |
| --- | --- |
| Spec / plan drift, `reuse_candidates`, deployment compliance | `review-code` harness-only dimensions skipped or reduced |
| `review-test` checks 1/3/7 (AC adversarial, spec test cases) | Not run; standalone `review-test` uses diff + optional test output only |
| `review-spec`, `review-plan`, `review-design`, … | Not spawned — three agents only |

**`review-code` existing-pattern grep** (standalone) is **advisory** — targeted consistency, not a repo-wide audit.

Set expectations in synthesis when the user wanted harness-grade gates: offer **`/dev`** or a scoped re-review after they add spec/plan context.
