# Pre-merge autopipeline smoke

Run this checklist before merging changes that touch `packages/accord-ci/`,
`.github/actions/setup-accord/`, or `.github/workflows/autopipeline*.yml`.

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
