# Pre-merge autopipeline smoke

Run this checklist before merging changes that touch `packages/accord-ci/`,
`.github/actions/setup-accord/`, or `.github/workflows/autopipeline*.yml`, or
`.github/workflows/accord-evidence.yml`, or
`.github/workflows/accord-driven.yml`.

## 1 — Unit + contract (local, no secrets)

```bash
bun test packages/accord-ci/tests
```

## 2 — L3 — `act` (optional, Docker required)

Copy `.env.smoke.example` → `.env.smoke` (fake values are fine; setup still
validates secret *presence*).

```bash
bun run smoke:act:self-test          # test-autopipeline.yml, no secrets
bun run smoke:act:autopipeline       # autopipeline-smoke.yml, needs .env.smoke
```

Requires [nektos/act](https://github.com/nektos/act) and a running Docker
daemon. The wrapper in `packages/accord-ci/src/smoke-act.ts` picks a socket
when `DOCKER_HOST` is unset.

## 3 — L4 — GitHub-hosted runner (`dry_run=true`)

Push your branch, then trigger the maintainer smoke workflow so **both** the
consumer repo workflow YAML and the accord checkout under `.accord-ci/` come
from the same ref:

```bash
git push -u origin HEAD
bun run smoke:gh:autopipeline
```

Defaults (override via env):

| Env | Default | Purpose |
|-----|---------|---------|
| `SMOKE_BRANCH` | current git branch | `gh workflow run --ref`, `base_branch`, `accord_ref` |
| `SMOKE_TICKET` | `DEMO-1` | Dummy Jira key |
| `SMOKE_DRY_RUN` | `true` | No Jira POST / git push / PR open |

Watch the run:

```bash
gh run list --workflow=autopipeline-smoke.yml --limit 1
gh run watch
```

**Expect:** job completes; gates and bootstrap run; phase steps may call the
exec harness (Anthropic key must be valid if phases are not short-circuited).
With `dry_run=true`, Jira comments are appended to the run log only.

To smoke against `main` after merge:

```bash
SMOKE_BRANCH=main SMOKE_ACCORD_REF=main bun run smoke:gh:autopipeline
```

## 4 — L5 — wet run (post-release / sandbox only)

Sandbox Jira + real phase execution: `docs/ci/consumer-quickstart.md` and
`dry_run=false` on a throwaway ticket. Not required for every PR.

## accord/evidence — required workflow

`.github/workflows/accord-evidence.yml` is a required workflow. It runs on
`pull_request` to `main` and on `push` to `main`. It checks out full history
(`fetch-depth: 0`), runs `packages/accord-ci/src/evidence-check.ts` over
`base..head`, and posts one commit status with context `accord/evidence` to the
head sha. On a pull request the head is `github.event.pull_request.head.sha`,
not the merge sha. The workflow has `statuses: write` and uses only
`GITHUB_TOKEN`. Mark `accord/evidence` as a required status check on `main`.

The `contract-lock` rule (`packages/accord-ci/src/checks/contract-lock.ts`)
guards `brief.md`, `spec.json`, `plan.json` and `contract.lock.json` of each
work item under `docs/dev/<ID>/` that has a `contract.lock.json`. It checks
only the commits in `base..head` that come after the lock commit. The lock and
amendment records already on the base branch are trusted. A commit that changes
a locked file fails unless it is a contract-amend commit: an `Accord:` trailer
with `outcome=amend` and the same work item id, touching only the locked files,
`spec.md`, `contract.lock.json` and `state/**`, with a lock that matches the
file hashes and a new amendment record. The rule fails when `base` or `head`
cannot be resolved. The `accord/<ID>/contract` tag is informational and is
never required. A repository without `contract.lock.json` passes.

The `leftover-state` rule (`packages/accord-ci/src/checks/leftover-state.ts`)
reads the tree at `head` and the `Accord:` trailers in the history of `head`.
It fails when `docs/dev/<ID>/state/task-<N>` remains after an `evidence(task-<N>)`
commit of the same work item. It also fails when any `docs/dev/<ID>/state/`
remains after closeout. A work item is closed out when
`docs/dev/<ID>/evidence/closeout.json` exists (this survives a squash merge) or
a commit has the trailer `outcome=closeout`. `trace.json` is not a closeout
signal. `state/work-item.json` and in-flight task state pass while the work item
is open.

The `feature-drift` rule (`packages/accord-ci/src/checks/feature-drift.ts`)
runs on every pull request, not only harness pull requests. It reads
`knowledge.drift_check` from the Dev Harness config. It does nothing when
`knowledge.enabled` is not true or when the value is `off`. It compares `head`
with the merge-base of `base` and `head`. A feature drifts when the pull request
changes a file that the feature doc anchors under `anchors.code`, and the
feature doc under `knowledge.root` is not changed in the same pull request. A
commit in `base..head` with the trailer `Feature-Unchanged: <slug>` declares
that the feature is unchanged. In mode `warn` (default) the rule prints a
warning and passes. In mode `block` the rule fails and names the feature and
the files. In mode `block` the rule also fails when `base` cannot be resolved.

```bash
bun test packages/accord-ci/tests/feature-drift-ci.test.ts
bun test packages/accord-ci/tests/evidence-check-runner.test.ts
bun test packages/accord-ci/tests/contract-lock-check.test.ts
bun test packages/accord-ci/tests/evidence-check.test.ts
```

## CI-driven mode push token

CI-driven mode needs the secret `ACCORD_CI_PUSH_TOKEN` (a GitHub App token or
PAT). Commits made with `GITHUB_TOKEN` do not trigger workflows, so the mode
does not accept it. `assertCiDrivenEnv()` in
`packages/accord-ci/src/ci-driven/startup.ts` fails with
`MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN` before any git or gh call.
The secret is server-only: only `packages/accord-ci` reads it, and no log
prints it. Owner: cshirley. Rotate it every 90-day period.

`stack.ci.cost_cap_usd` in `accord.json` sets the spend cap per run. It has no
default.

```bash
bun test packages/accord-ci/tests/ci-driven-startup.test.ts
```

## accord-driven — PR0 workflow

`.github/workflows/accord-driven.yml` runs on `push` to `accord/*/**`. Local
stack branches use `stack/<ID>/pr-<n>` and never trigger it. The checkout does
not keep `GITHUB_TOKEN` and fetches full history. The first run step
(`packages/accord-ci/src/ci-driven/gate.ts`) reads the `## Dev Harness` block
of `AGENTS.md`. It sets the output `run=true` only when `stack.enabled` is
`true` and the branch adds only `docs/dev/<ID>/brief.md` and
`docs/dev/<ID>/spec.json`. Otherwise the job ends green and every later step is
skipped. The next step runs `packages/accord-ci/src/ci-driven/pr0.ts`. It
spawns `phase-plan`, commits `plan.json` and the proposed stack table to the
branch, pushes with `ACCORD_CI_PUSH_TOKEN`, and stops at the human gate. The
token comes only from `${{ secrets.ACCORD_CI_PUSH_TOKEN }}` in the `env` of that
step and no log prints it. Set `ACCORD_CI_DRY_RUN=true` to skip the push.

```bash
bun test packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts
```

## accord-driven — resume workflow

After PR0 merges, the jobs `resume-gate` and `resume` in
`.github/workflows/accord-driven.yml` continue the work item. Two events start
them. The first event is a `push` to `main` that changes
`docs/dev/<ID>/contract.lock.json`. The second event is an `issue_comment`
(created) on a work item PR with the text `/accord approve` or `/accord unblock`
from a user whose association is `OWNER`, `MEMBER` or `COLLABORATOR`. The text
`/accord unblock <task> <reason>` names the blocked task and gives the reason.

The job `resume-gate` runs `packages/accord-ci/src/ci-driven/resume-gate.ts`. It
uses the same entry check as PR0: `stack.enabled` must be `true` and
`docs/dev/<ID>/state/work-item.json` must exist. If a check fails, the job ends
green and the job `resume` does not run. The gate reads pull requests with
`github.token`. It never reads the push token.

The job `resume` has the concurrency group `accord-<ID>` with
`cancel-in-progress` set to `false`, so two runs for the same `<ID>` never
overlap. `packages/accord-ci/src/ci-driven/resume.ts` also holds an on-disk lock
for each `<ID>`. The job restores `.tasks/` from `docs/dev/<ID>/state/`, switches
to the branch `stack/<ID>/pr-<N>` of the next unfinished PR, and reads the last
typed commit. It runs `accord resume`, which can make several typed commits, pushes the
current stack branch once without force with `ACCORD_CI_PUSH_TOKEN`, and repeats. A rerun after an interruption resumes
from the last typed commit pushed to that branch. History is append-only: no
amend and no force push. The gates are read from PR comments and from commits:
`/accord approve`, `/accord unblock`, the `contract.lock.json` file, and a typed
commit with `outcome=closeout`.

When the cost reaches `stack.ci.cost_cap_usd`, or when a gate fails, the run
stops. `packages/accord-ci/src/ci-driven/alert.ts` logs `stack.ci.alert` at
error with `work_item_id` and `condition`. It then posts one PR comment with
`gh` and `ACCORD_CI_PUSH_TOKEN`. The PR is the open PR for the current stack
branch, or else the PR0 PR. If no PR exists, only the log event is written. If
`stack.ci.cost_cap_usd` is not set, there is no cap.

```bash
bun test packages/accord-ci/tests/ci-driven-resume.test.ts
```
