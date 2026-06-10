# Autopipeline troubleshooting

Operator-facing failure modes, recurring review items, and recovery flows.

## Recurring review items (per release)

### 1. `dawidd6/action-download-artifact` SHA pin

The cross-run resume step uses `dawidd6/action-download-artifact` pinned
by 40-character SHA in `.github/workflows/autopipeline.yml`:

```
uses: dawidd6/action-download-artifact@bf251b5aa9c2f7eeb574a96ee720e24f801b7c11
```

That SHA corresponds to `v6` of the action. On every accord release:

- Check the action's latest release for security advisories.
- If a newer SHA is wanted, update both `autopipeline.yml` AND this doc.
- `packages/pi-accord-ci/tests/artifact-upload.test.ts` enforces that every reference uses a
  40-char SHA (no `@v*` tag refs).

## Documented limitations

### Cost-cap overshoot

The cost cap (AC-7) is checked **between phases**, not mid-phase. If a
single phase costs $5 and the cap is $20 with $19 already spent, the
workflow lets the phase run to completion (total $24 = $4 overshoot),
THEN trips the cost-exceeded terminal on the next inter-phase check.

This is by design: aborting mid-phase would leak partial state.
Consumers worried about overshoot should set `max_cost_usd` to
`<intended-cap> - <largest-single-phase>` (rule of thumb: subtract $5).

### Cache poisoning

The `setup-pi` composite caches `~/.config/pi/agent`. AC-13 excludes
`auth.json` and `sessions/**` from the cache and runs `rm -f auth.json`
before save. If a cache becomes corrupted, manually trigger a re-run
with `pi_version` bumped to invalidate the key.

## Recovery flows

### Truncated stream — phase status `stuck`

If `runPhase` cannot find a return packet in the event stream, it
synthesises `{status: "stuck", reason: "no_return_packet"}`. This
transitions the ticket to `Stuck` and uploads the
`accord-state-<ticket>` artifact.

To recover: download the artifact, inspect `.tasks/<ticket>.json` for
the phase that hung, and either re-trigger the workflow (resume) or
clear state and start fresh.

### Cumulative cost preserved across runs

Resume runs continue against the same budget. If you intend to give the
work item a fresh budget, transition the ticket out of the trigger
status, delete the `accord-state-<ticket>` artifact, and re-fire.

### Missing required secret

A literal stderr line `MISSING_REQUIRED_SECRET: <NAME>` + non-zero exit
indicates a secret is unset or empty (AC-20..AC-25). Fix the repository
secrets and re-run. The `setup-pi` composite step fails BEFORE any LLM
or Jira call, so no cost is incurred.

### Dispatch payload missing fields

`MISSING_REQUIRED_DISPATCH_FIELD: <field>` indicates the Atlassian
Automation rule's webhook body is malformed (typically missing
`status_at_trigger`). Fix the rule (see
`docs/ci/atlassian-automation.md`) and re-fire.

## Reusable workflow event-name (real-runner contract)

Inside a reusable workflow invoked via `workflow_call`,
`github.event_name` reflects the **outer event** that initiated the run
(e.g. `workflow_dispatch` from `gh workflow run`, or
`repository_dispatch` from Atlassian Automation) — **not**
`workflow_call`. This is documented GitHub Actions behaviour for
reusable workflows, and is the same behaviour `act` reproduces locally
(`nektos/act#1462`).

The naive workaround — overriding `GITHUB_EVENT_NAME` via step `env:` —
does **not** work on real GitHub. `GITHUB_*` environment variables are
runner-reserved: the runner re-applies the actual outer event name
after step `env:` is processed, so a step-level override is silently
ignored. (`act` does honour the override, which made the
misconfiguration look correct under L3 local smoke but fail under L4
real-runner smoke.)

The correct mechanism is to pass an explicit, non-reserved companion
env var that `dispatch.ts` prefers over `GITHUB_EVENT_NAME`:

```yaml
env:
  ACCORD_DISPATCH_KIND: ${{ github.event_name == 'repository_dispatch' && 'repository_dispatch' || 'workflow_call' }}
  GITHUB_EVENT_PATH: ${{ github.event_path }}
```

The reusable workflow's `on:` block only declares two genuine triggers
(`workflow_call`, `repository_dispatch`), so anything that is not a
real `repository_dispatch` MUST have arrived via `workflow_call`.
`packages/pi-accord-ci/src/dispatch.ts` reads `ACCORD_DISPATCH_KIND` first and falls
back to `GITHUB_EVENT_NAME` so direct callers (consumers that invoke
the validator outside the reusable workflow) still work.

Regression coverage:

- `packages/pi-accord-ci/tests/inputs-and-concurrency.test.ts → "AC-1: dispatch event-name
  canonicalisation"` pins the YAML expression and the absence of any
  attempted `GITHUB_EVENT_NAME` step override.
- `packages/pi-accord-ci/tests/dispatch-validation.test.ts → "dispatch.ts CLI env-var
  precedence (real-runner contract)"` pins the env-var precedence
  inside `dispatch.ts main()`.

## `act`-specific cosmetic quirks (L3 local smoke)

The L3 smoke (`bun run smoke:act:autopipeline`) runs the workflow YAML
inside Docker via `act`. A few cosmetic behaviours differ from a real
GitHub runner — none of them affect production:

- **Multi-line YAML `path:` blocks**: act collapses them with a
  URL-encoded newline (`%0A`), producing warnings like
  `No files were found with the provided path: docs/dev/<ticket>/%0A.tasks/<ticket>*`.
  Real GitHub treats each line as a separate glob. The workflow is
  correct; the parser difference is verified by
  `packages/pi-accord-ci/tests/artifact-upload.test.ts`.
- **Unrendered job-name templates**: act prints raw `${{ inputs.ticket }}`
  in some error messages. Cosmetic only; real GitHub interpolates these
  in logs and the UI.
- **Pre-release `accord_ref`**: the autopipeline defaults to
  `accord_ref: v1`. Until that tag exists on origin, the `setup-pi`
  checkout step fails with a 73-second backoff. For pre-release smoke
  tests, override `accord_ref` to the feature branch name via the smoke
  wrapper's `accord_ref` input (`bun run smoke:act:autopipeline`
  already does this).
