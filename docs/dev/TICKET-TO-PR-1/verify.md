# Verification Report: TICKET-TO-PR-1

- Verdict: **PASS**
- Date: 2026-05-11
- Acceptance criteria: 25 pass, 0 fail, 0 partial, 0 not verified

## Source Artifacts

- Brief: `docs/dev/TICKET-TO-PR-1/brief.md`
- Spec: `docs/dev/TICKET-TO-PR-1/spec.json`
- Plan: `docs/dev/TICKET-TO-PR-1/plan.json`
- Machine-readable verify: `docs/dev/TICKET-TO-PR-1/verify.json`

## Summary

| Status | Count |
| --- | ---: |
| Pass | 25 |
| Fail | 0 |
| Partial | 0 |
| Not verified | 0 |

## Acceptance Criteria

### AC-1 - Pass

Evidence:
- file: Reusable workflow declares workflow_call + repository_dispatch + dispatch validation (.github/workflows/autopipeline.yml:1-60)
- file: Dispatch field validator throws MISSING_REQUIRED_DISPATCH_FIELD (packages/pi-accord-ci/src/dispatch.ts:1-120)
- test: dispatch validation tests (packages/pi-accord-ci/tests/inputs-and-concurrency.test.ts) - 30/30 pass (workflow + dispatch surface)

### AC-2 - Pass

Evidence:
- file: AGENTS.md gate sub-checks (file, section, JSON parse, test.command) (packages/pi-accord-ci/src/gate-agents-md.ts:1-160)
- test: AGENTS.md gate unit tests covering pass/fail paths (packages/pi-accord-ci/tests/agents-md-gate.test.ts) - all sub-checks + adversary paths pass

### AC-3 - Pass

Evidence:
- file: Eight Jira completeness sub-checks return failedChecks array (packages/pi-accord-ci/src/gate-ticket.ts:1-220)
- test: Ticket-gate tests covering each sub-check + multi-fail reporting (packages/pi-accord-ci/tests/gate-ticket.test.ts) - 8 sub-checks + adversary cases pass

### AC-4 - Pass

Evidence:
- file: dispatchTerminal renders questions[] verbatim + transitions to Needs Author Input (packages/pi-accord-ci/src/parse-phase-result.ts:1-260)
- test: needs_input case verifies verbatim payload + transition + artifact upload (packages/pi-accord-ci/tests/parse-phase-result.test.ts) - needs_input path covered

### AC-5 - Pass

Evidence:
- file: Happy-path orchestration (gates -> seed -> bootstrap -> phases -> commit/PR) (.github/workflows/autopipeline.yml:60-260)
- file: Brief seeding with canonical phase-align shape (packages/pi-accord-ci/src/seed-brief.ts:1-200)
- file: Work-item bootstrap via direct devBootstrap/devTransition imports (packages/pi-accord-ci/src/bootstrap-work-item.ts:1-120)
- test: End-to-end happy-path scenario (TC-4) (packages/pi-accord-ci/tests/self-test/complete-happy-path.test.ts) - happy-path PR body + transitions verified

### AC-6 - Pass

Evidence:
- file: runPhase spawns pi -p --mode json /skill:accord <phase> <ticket> (packages/pi-accord-ci/src/run-phase.ts:1-180)
- test: Allow-list regex enforces invocation shape; SDK import ban scans packages/pi-accord-ci/src + .yml (packages/pi-accord-ci/tests/no-extra-pi-spawns.test.ts) - every .ts/.yml under packages/pi-accord-ci/src matches allow-list; no SDK imports

### AC-7 - Pass

Evidence:
- file: checkCostCap strict-less-than threshold + cost summary body (packages/pi-accord-ci/src/parse-phase-result.ts:260-380)
- test: Cost-cap unit tests cover strict <, cumulative, summary content (packages/pi-accord-ci/tests/cost-cap.test.ts) - below/at/above cap + cumulative paths pass

### AC-8 - Pass

Evidence:
- file: renderPrBody includes AC citation + verify report quote + secret-scrub pre-check (packages/pi-accord-ci/src/commit-and-pr.ts:1-260)
- test: PR body shape + scrubSecrets test (packages/pi-accord-ci/tests/commit-and-pr.test.ts) - renderPrBody asserts AC + verify quote; scrubSecrets throws on match

### AC-9 - Pass

Evidence:
- file: PR trailer pi.dev/autopilot: v1 + idempotent autopilot/v1 label creation (packages/pi-accord-ci/src/commit-and-pr.ts:120-220)
- test: Trailer presence + label idempotency tested (packages/pi-accord-ci/tests/commit-and-pr.test.ts) - trailer literal + labelExists short-circuit pass

### AC-10 - Pass

Evidence:
- file: dispatchTerminal renders blockers/gaps verbatim with transitions (packages/pi-accord-ci/src/parse-phase-result.ts:60-180)
- test: Blocked + gaps cases verified verbatim (packages/pi-accord-ci/tests/parse-phase-result.test.ts) - blocked -> Blocked, gaps -> Gaps Reported pass

### AC-11 - Pass

Evidence:
- file: slugify in seed-brief.ts used as branch slug source (packages/pi-accord-ci/src/seed-brief.ts:1-100)
- file: commitAndPr uses force-with-lease and upserts PR for the deterministic branch (packages/pi-accord-ci/src/commit-and-pr.ts:60-180)
- test: Slug edge cases + branch naming + force-with-lease + upsert (packages/pi-accord-ci/tests/commit-and-pr.test.ts) - branch deterministic, push uses force-with-lease, PR idempotent

### AC-12 - Pass

Evidence:
- file: setup-pi composite: actions/cache@v4 with literal key/restore-keys/paths (.github/actions/setup-pi/action.yml:1-90)
- test: Cache surface parsed and verbatim-asserted (packages/pi-accord-ci/tests/setup-pi-cache.test.ts) - key + restore-keys + paths + env vars asserted

### AC-13 - Pass

Evidence:
- file: Cache path excludes auth.json + sessions/**; post-step rm -f auth.json (.github/actions/setup-pi/action.yml:20-80)
- test: Exclusion + scrub post-step asserted (packages/pi-accord-ci/tests/setup-pi-cache.test.ts) - auth.json + sessions/** excluded; if:always() scrub present

### AC-14 - Pass

Evidence:
- file: Every terminal step uploads accord-state-${{ inputs.ticket }} with overwrite + 14d retention (.github/workflows/autopipeline.yml:200-340)
- test: artifact-upload test walks YAML and asserts canonical block per terminal (packages/pi-accord-ci/tests/artifact-upload.test.ts) - every terminal has matching upload-artifact@v4

### AC-15 - Pass

Evidence:
- file: Workflow input surface with declared defaults (.github/workflows/autopipeline.yml:1-60)
- file: Single source of truth for INPUTS (packages/pi-accord-ci/src/lib/inputs.ts:1-120)
- test: Input contract enforced (packages/pi-accord-ci/tests/inputs-and-concurrency.test.ts) - each input + default + type asserted

### AC-16 - Pass

Evidence:
- file: decideResume conjunctive gate: phase + normalised brief hash + strict cost < (packages/pi-accord-ci/src/decide-resume.ts:1-180)
- test: Resume matrix + precedence + cleanupPaths + normaliseBrief invariants (packages/pi-accord-ci/tests/decide-resume.test.ts) - all reasons (no_prior_state, phase_non_resumable, brief_drift, cost_cap_breached) covered

### AC-17 - Pass

Evidence:
- file: Self-test workflow triggers on PR; runs scenario corpus + exit-code policy (.github/workflows/test-autopipeline.yml:1-80)
- test: Ten-scenario corpus drives deterministic handlers (packages/pi-accord-ci/tests/self-test/scenarios.test.ts) - 30/30 self-test pass

### AC-18 - Pass

Evidence:
- file: Terminal branches exit 0; MissingSecretError causes non-zero exit (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: Exit-code policy enforced per terminal category (packages/pi-accord-ci/tests/exit-code.test.ts) - all 7 terminals -> 0; missing secret -> non-zero

### AC-19 - Pass

Evidence:
- file: concurrency: group accord-${{ inputs.ticket }}, cancel-in-progress: false (.github/workflows/autopipeline.yml:40-60)
- test: Concurrency block asserted by parser (packages/pi-accord-ci/tests/inputs-and-concurrency.test.ts) - literal concurrency group + cancel flag asserted

### AC-20 - Pass

Evidence:
- file: ANTHROPIC_API_KEY required by env.ts (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: Missing ANTHROPIC_API_KEY -> MISSING_REQUIRED_SECRET: ANTHROPIC_API_KEY (packages/pi-accord-ci/tests/lib/env.test.ts) - 18/18 env tests pass

### AC-21 - Pass

Evidence:
- file: JIRA_BASE_URL required by env.ts (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: Missing JIRA_BASE_URL -> MISSING_REQUIRED_SECRET: JIRA_BASE_URL (packages/pi-accord-ci/tests/lib/env.test.ts) - literal error message asserted

### AC-22 - Pass

Evidence:
- file: JIRA_USER_EMAIL required by env.ts (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: Missing JIRA_USER_EMAIL -> MISSING_REQUIRED_SECRET: JIRA_USER_EMAIL (packages/pi-accord-ci/tests/lib/env.test.ts) - literal error message asserted

### AC-23 - Pass

Evidence:
- file: JIRA_API_TOKEN required by env.ts (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: Missing JIRA_API_TOKEN -> MISSING_REQUIRED_SECRET: JIRA_API_TOKEN (packages/pi-accord-ci/tests/lib/env.test.ts) - literal error message asserted

### AC-24 - Pass

Evidence:
- file: GITHUB_TOKEN resolution + GH_PAT_PR override in same-repo mode (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: resolveGithubToken same-repo cases (packages/pi-accord-ci/tests/lib/env.test.ts) - GITHUB_TOKEN fallback + GH_PAT_PR override + missing -> MISSING_REQUIRED_SECRET: GITHUB_TOKEN

### AC-25 - Pass

Evidence:
- file: GH_PAT_PR required in cross-repo mode (packages/pi-accord-ci/src/lib/env.ts:1-100)
- test: resolveGithubToken cross-repo cases throw MISSING_REQUIRED_SECRET: GH_PAT_PR (packages/pi-accord-ci/tests/lib/env.test.ts) - cross-repo mode without GH_PAT_PR fails even with GITHUB_TOKEN set

Next: `/commit` then `/pr`.
