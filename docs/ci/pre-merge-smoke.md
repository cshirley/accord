# Pre-merge autopipeline smoke

Run this checklist before merging changes that touch `packages/accord-ci/`,
`.github/actions/setup-accord/`, or `.github/workflows/autopipeline*.yml`, or
`.github/workflows/accord-evidence.yml`.

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

```bash
bun test packages/accord-ci/tests/evidence-check-runner.test.ts
bun test packages/accord-ci/tests/contract-lock-check.test.ts
bun test packages/accord-ci/tests/evidence-check.test.ts
```
