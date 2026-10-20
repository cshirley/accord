---
name: pr-review
description: Review a GitHub pull request (by number or URL) with the standalone review-code, review-security and review-test agents, sharded for large PRs, and leave the findings as a pending (draft) inline review. Use when the user asks to review a PR. For local or pre-commit changes use the `review` skill instead.
---

# PR review

Reviews a **pull request**, not the local tree. Uses the same agents and the same report shape as the `review` skill. It adds three things `review` does not have: an explicit PR base and head, sharding for diffs too big for one reviewer, and a draft inline review on GitHub.

Nothing is posted as a submitted review. The review is left **pending** for the human to read and submit.

## Forbidden

- Never run `accord review` or spawn a nested harness.
- Never submit the review (`event` set) or post comments outside a pending review. The human submits.
- Never inline a diff into a subagent task string. Reviewers read shard files from disk.
- Never run `git reset --hard`, `git clean -fd`, force-push, `git config` or anything else the repo's AGENTS.md forbids. Never use the shared checkout to build in; use a worktree outside the repo.

## Tools

Call `search_accord_tools` first if a tool is not active (`pr_review_context`, `pr_review_report`, `pr_review_post`). Use `subagent` for reviewers and `bash` for `gh` and `git worktree remove`.

## Step 1: Prepare

Call **`pr_review_context`** with `pr` (number or URL). Optional: `max_shards` (default 4), `budget_kb` (default 60), `single_shard_max_files` (default 20), `runs` (1 to 3, default 2), `models` (one per run, up to 3), `lens` (default true), `worktree: false`. A PR is one shard only when it is at most 20 files and 60 KiB; reviewers go less deeply on bigger diffs (a 127 KB PR reviewed whole missed findings that three shards caught), so raise these only for a quick look.

**Runs and models.** Reviewer output varies from run to run, so every task is run twice by default and the results merged by location. On PR 449, one sonnet run found about 49% of the locations that three runs found, and two sonnet runs about 77%. Different models make different mistakes, so a mixed pair does better still: one opus run found more than any sonnet run (30 against about 23 of 62 warning-or-above locations), and opus plus one sonnet run found about 38, against about 33 for two sonnet runs.

- **Default:** `models` is sonnet then opus on `github-copilot` (`claude-sonnet-5.5`, `claude-opus-5.5`) or `anthropic` (`claude-sonnet-5-5`, `claude-opus-5-5`). Model ids are provider-specific. On any other provider the default is the same model twice.
- **Choose:** pass `models` (up to 3, one per run; it sets the run count) or `runs` (the same model repeated). Use a single opus run for a quick look and three runs for a high-stakes PR.
- **Avoid** `gemini-3.8-flash`: it was the slowest and had the lowest yield. `gpt-5.6-sol` finds different things but marks many ordinary bugs critical. The report shows a critical reported by one non-Claude model alone as a warning, and says so.
- **Cost:** opus took about 230 s per task against about 145 s for sonnet, and costs about 1.7 times per token. Each posted comment says how many runs, and which models, reported it, so a finding from one run is visibly lower confidence.

**Lens.** Each brief carries a per-agent lens (STRIDE for `review-security`; doc-versus-code and no finding cap for `review-code`; no-spec checks for `review-test`) and an explicit return shape. `lens: false` gives the bare briefs, for comparison.

It reads the PR from its own base (so a stacked PR is reviewed against its parent), creates a detached head worktree beside the repo, splits the diff per file, skips generated files, groups files by directory with tests beside their source, and writes shard files and a manifest. It fails if the shard partition is not exact (every file in exactly one shard, bytes equal), if the PR is not open, or if the worktree path already exists. It never reuses or forces a path.

State the base branch, shard count and skipped files to the user. Stop if it returns an error.

## Step 2: Run the reviewers

`details.tasks` holds one task per shard and agent, each with `agent`, `task`, `cwd` and `shard`.

Run them as **single-agent `subagent` calls fired concurrently** (for example `Promise.allSettled` in `codemode`), at most 4 at a time, passing `agentFile` (`~/.config/pi/agent/agents/accord/<agent>.md`), `cwd` from the task, `model` from the task when it has one, and the task text unchanged. Do not use `subagent` `tasks[]` parallel mode: it returns only a one-line preview per agent, not the return packet.

The agents' own tier models fail on some providers (on github-copilot with `model_not_supported`; probably because the profile in `subagent.json` uses dashed ids such as `claude-sonnet-5-5` where Copilot lists dotted ones such as `claude-sonnet-5.5`, which has not been tested). So always pass a `model`: the task's, or else the session's own. Pass `thinking: "high"`. If a task's model is not available, say so, run that task with the session's model, and note the substitution in the summary.

Collect `{ shard, run, agent, exitCode, output, stderr }` for every task (copy `shard`, `run` and `agent` from the task), including failures.

## Step 3: Report

Call **`pr_review_report`** with `temp_dir` and `results_json` (the collected array as a JSON string, including each result's `run`). It merges shards and de-duplicates. Findings at the same `file:line` (from different agents or shards) are merged into one entry at the highest severity, listed under **By location** and posted as one comment. It adds a **Coverage** section: assigned files against each agent's `files_reviewed`, failed agents, and tasks that never ran. A missing `files_reviewed` counts as a gap.

Re-run a shard once if its agent failed or missed files. Treat anything still missed as not reviewed, never as clean.

Optionally run one cross-shard `review-code` task with the manifest and the merged findings, asking only for interactions between shards (callers and callees, shared state, invariants spanning files). Add its findings.

Show the report to the user before posting.

## Step 4: Post a pending review

Only after the user has seen the report and agrees (or asked for a draft review up front).

Call **`pr_review_post`** with `temp_dir` and a `summary` (what was read and not read, the verdict you would suggest, and any coverage gaps). Pass cross-shard findings as `extra_findings_json`. Use `dry_run: true` first if the user wants to see the payload.

The tool puts each finding with a `file:line` that is in the diff into an inline comment on the `RIGHT` side, and the rest into the review body. It creates the review with no `event`, so GitHub keeps it **pending**: only its author sees it. It refuses if the PR is no longer open or its head moved since `pr_review_context` (the line numbers would be wrong), and it fails if GitHub does not answer `PENDING`.

Give the user the URL it returns and tell them to open the PR, choose "Finish your review" and pick the verdict. Never choose it for them. If GitHub refuses because the user already has a pending review on that PR, say so and let them decide.

Tone: state what was read and what was not. Do not claim a clean review for files that were skipped or missed.

## Cleanup

When done, success or failure: `git worktree remove <details.worktree>` (read any refusal; never force) and delete `details.temp_dir`.

## Limits

- No spec or plan: reviewers infer intent from the diff, the PR body and the manifest.
- Sharding proves a valid partition and coverage, not that related files were read together. The cross-shard pass reduces that gap; it does not close it.
- Agent failures such as `model_not_supported` look like empty results in parallel mode. Check each result for an error before treating a shard as clean.
- Tests are not run by default. `review-test` then judges the tests by reading them.
