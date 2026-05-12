# ACCORD autopipeline — architecture + contract (v1)

This document is the operator-facing reference for the reusable
`cshirley/accord/.github/workflows/autopipeline.yml@v1` workflow.

The autopipeline takes a Jira ticket from `Ready for Autopilot` through
`spec → plan → code → verify → commit → PR` without human intervention,
and falls back to a structured Jira comment on every terminal branch.

## Contract surface (AC-15)

The reusable workflow declares the following surface — see
`scripts/ci/lib/inputs.ts` for the source of truth.

### Inputs

| Name | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `ticket` | string | yes | — | Jira ticket key. |
| `pi_version` | string | no | `latest` | npm tag / version of `@mariozechner/pi-coding-agent`. |
| `accord_ref` | string | no | `v1` | Tag / branch of `pi-accord` asset bundle. |
| `max_runtime_minutes` | number | no | `90` | Hard cap on job runtime. |
| `max_cost_usd` | number | no | `20` | Hard cap on accumulated subagent USD. |
| `base_branch` | string | no | `main` | Branch the workflow branches from. |
| `branch_prefix` | string | no | `accord/` | Prefix for the working branch. |
| `dry_run` | boolean | no | `false` | Skip git push / PR open / Jira write. |
| `runner` | string | no | `ubuntu-latest` | GH-hosted runner label or self-hosted group. |
| `subagent_profile` | string | no | `anthropic-direct` | Name of the profile to mark as `activeProfile` inside the runner's `subagent.json` before any phase runs. See [Runtime configs and profiles](#runtime-configs-and-profiles) below. |

### Secrets

| Name | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Anthropic subagent calls. |
| `JIRA_BASE_URL` | yes | Jira REST root (`https://<your>.atlassian.net`). |
| `JIRA_USER_EMAIL` | yes | Email of the Jira automation user. |
| `JIRA_API_TOKEN` | yes | API token for that user. |
| `GH_PAT_PR` | no | PAT with `repo` scope for cross-repo PRs; if unset the runner's `GITHUB_TOKEN` is used. |

A missing required secret fails startup with a literal stderr line
`MISSING_REQUIRED_SECRET: <NAME>` and a non-zero exit, BEFORE any LLM or
Jira call (AC-20..AC-25).

### Triggers

The workflow accepts two triggers:

- `workflow_call`: invoked from a consumer wrapper workflow.
- `repository_dispatch` (`accord-autopipeline`): invoked by an Atlassian
  Automation rule on the configured trigger status. The dispatch payload
  must include both `client_payload.ticket` and
  `client_payload.status_at_trigger` — missing fields fail with
  `MISSING_REQUIRED_DISPATCH_FIELD: <field>` (AC-1).

## Behaviour matrix

| Branch | Phase entry / cause | Jira transition (default) | Exit | Artifact upload |
|---|---|---|---|---|
| Gate fail — AGENTS.md | AC-2 sub-check fails | `Needs Triage` | 0 | yes |
| Gate fail — Jira completeness | AC-3 sub-check fails | `Needs Triage` | 0 | yes |
| `needs_input` | Any phase returns `status: needs_input` | `Needs Author Input` | 0 | yes |
| `blocked` | Any phase returns `status: blocked` | `Blocked` | 0 | yes |
| `gaps` | `phase-verify` returns `status: gaps` | `Gaps Reported` | 0 | yes |
| `cost_exceeded` | Cumulative cost ≥ `max_cost_usd` (AC-7) | `Cost Exceeded` | 0 | yes |
| Complete | Happy path through verify | `In Review` + PR opened | 0 | yes |

Non-zero exit is reserved for infrastructure failures (AC-18): missing
secret, checkout failure, `setup-pi` install failure, runner-level
timeout.

## Resume eligibility (AC-16)

Between runs against the same ticket, `decide-resume.ts` resumes only
when ALL THREE conditions hold simultaneously:

1. The prior `phase` is one of `speccing`, `planning`, `implementing`.
2. `sha256(normalise(prior_brief)) === sha256(normalise(fresh_brief))`,
   where `normalise` strips the `Generated at` timestamp line, collapses
   whitespace runs, and trims trailing whitespace.
3. Cumulative `cost_usd` is **strictly less than** `max_cost_usd`.

Otherwise the workflow cleans `.tasks/<ticket>*` and starts fresh, with
the reason (`no_prior_state` / `phase_non_resumable` / `brief_drift` /
`cost_cap_breached`) written verbatim into the run-opening Jira comment.

## Runtime configs and profiles

Two pi-extension configs are normally written to `~/.config/pi/agent/` on
a developer's laptop but **do not exist on a fresh GitHub runner**:

| File | Reader | Effect when missing |
|---|---|---|
| `subagent.json` | `packages/pi-subagent/src/agents.ts` | Falls back to an in-code default profile (works but logs a warning, can't be tuned per-phase). |
| `thrift.json` | `packages/pi-thrift/src/config.ts` | Loads in-code defaults (`output.level: "full"`, `showStatus: true`). |

The `setup-pi` composite (`.github/actions/setup-pi/action.yml`) seeds
both files from `assets/ci/*.json` after `pi install pi-accord` has run.
It uses `cp -n` so a cache-restored version always wins over the
template. It also creates a `~/.pi → ~/.config/pi` symlink because
`pi-thrift` hard-codes `homedir()/.pi/agent` whereas `pi-coding-agent`
uses `~/.config/pi/agent` on Linux.

### Selecting a profile per-call

The bundled CI template ships a single profile named `anthropic-direct`
(the only provider keyed in CI by default). The workflow's
`subagent_profile` input is applied **after** the seed copy step via
`jq`, mutating only `activeProfile` (not `defaultProfile`, which would
change cache semantics across runs). If the named profile is absent
from the resulting JSON the step fails with an `::error::` line listing
the available profile names — better than letting `pi-subagent` silently
fall back to in-code defaults.

### Consumer override pattern

Consumers who want a richer profile set (e.g. an `openai-direct` tier
ladder or a `cursor-claude` mirror of their laptop config) commit a
custom `subagent.json` into their repo and copy it over the
seeded template in their wrapper workflow, **after** the `setup-pi`
action:

```yaml
- name: Override CI subagent profile
  shell: bash
  run: cp ci/subagent.json ~/.config/pi/agent/subagent.json

- name: phase-spec
  uses: cshirley/accord/.github/actions/run-accord-phase@v1
  with:
    phase: spec
    ticket: ${{ inputs.ticket }}
```

The custom file is then mutated by `subagent_profile` exactly the same
way the bundled template is — so the workflow input `subagent_profile:
openai-direct` will pick the consumer's `openai-direct` profile out of
their file. (Don't forget to plumb the required API key as a secret on
top of the four standard ones — see the secrets table.)

The seeded `thrift.json` is rarely worth overriding — its defaults are
already tuned for non-interactive runs.

## Architectural constraints (AC-6)

Phase orchestration is exclusively via the CLI:

```
pi -p --mode json /skill:accord <phase> <ticket>
```

There is **no SDK import** — `tests/ci/no-extra-pi-spawns.test.ts` walks
every script and asserts every invocation matches the allow-list regex
above and that no file under `scripts/ci/` imports
`@mariozechner/pi-coding-agent`. ACCORD's own `dev_*` tools
(`devBootstrap`, `devTransition`, `devFinalize`) are called by
`bootstrap-work-item.ts` via direct TypeScript imports from
`@clive.shirley/pi-accord/src/core/...`.

## Local testing

The autopipeline is designed to be exercised at four progressively-larger
levels of fidelity before a wet run hits real Jira:

| Level | What it covers | How to run |
|---|---|---|
| L1 — unit | All deterministic logic: gates, brief seed, bootstrap, resume gate, terminal dispatch, cost cap, commit/PR shape. | `bun test tests/ci` |
| L2 — scenarios | Ten-scenario self-test (AC-17) + exit-code policy (AC-18). | `bun test tests/ci/self-test tests/ci/exit-code.test.ts` |
| L3 — workflow YAML | Runs the workflow YAML in a local Docker container via [`act`](https://github.com/nektos/act). Closest to a real runner without GitHub Actions. | `bun run smoke:act:self-test` (no secrets) or `bun run smoke:act:autopipeline` (needs `.env.smoke` — see `.env.smoke.example`) |
| L4 — real runner | Real GitHub-hosted runner, `dry_run=true` so no Jira/PR side effects. | `bun run smoke:gh:autopipeline` (`gh` CLI required, branch must be pushed) |
| L5 — wet run | End-to-end: sandbox Jira → Automation rule → real `pi` subprocess → PR. | See `docs/ci/consumer-quickstart.md`. |

L3 and L4 both default to `dry_run=true`: `commit-and-pr.ts` skips
`git push` / PR open, and `jira-comment.ts` logs each would-be comment
to a JSONL file instead of POSTing. Cost stays bounded by
`max_cost_usd` (default `1` for the smoke wrapper).

The L3 wrapper (`scripts/ci/smoke-act.ts`) auto-detects a Docker
socket — Docker Desktop, Rancher Desktop, Colima, OrbStack, or rootless
Linux Docker — and surfaces a clear error if no runtime is reachable.
An explicit `DOCKER_HOST` is honoured if set.

## Where to look

| Concern | File |
|---|---|
| Workflow entrypoint | `.github/workflows/autopipeline.yml` |
| Composite — install pi + cache | `.github/actions/setup-pi/action.yml` |
| Composite — invoke a phase | `.github/actions/run-accord-phase/action.yml` |
| Gate — AGENTS.md (AC-2) | `scripts/ci/gate-agents-md.ts` |
| Gate — Jira ticket (AC-3) | `scripts/ci/gate-ticket.ts` |
| Brief seeding (AC-5) | `scripts/ci/seed-brief.ts` |
| Work item bootstrap (AC-5, AC-6) | `scripts/ci/bootstrap-work-item.ts` |
| Resume gate (AC-16) | `scripts/ci/decide-resume.ts` |
| Phase subprocess + parsing | `scripts/ci/run-phase.ts` |
| Terminal dispatch + cost cap | `scripts/ci/parse-phase-result.ts` |
| Jira REST helper | `scripts/ci/jira-comment.ts` |
| Commit + PR open (AC-8, AC-9, AC-11) | `scripts/ci/commit-and-pr.ts` |
| Self-test harness (AC-17) | `tests/ci/self-test/` |
