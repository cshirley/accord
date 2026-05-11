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
- file: Dispatch field validator throws MISSING_REQUIRED_DISPATCH_FIELD (scripts/ci/dispatch.ts:1-120)
- test: dispatch validation tests (tests/ci/inputs-and-concurrency.test.ts) - 30/30 pass (workflow + dispatch surface)

### AC-2 - Pass

Evidence:
- file: AGENTS.md gate sub-checks (file, section, JSON parse, test.command) (scripts/ci/gate-agents-md.ts:1-160)
- test: AGENTS.md gate unit tests covering pass/fail paths (tests/ci/agents-md-gate.test.ts) - all sub-checks + adversary paths pass

### AC-3 - Pass

Evidence:
- file: Eight Jira completeness sub-checks return failedChecks array (scripts/ci/gate-ticket.ts:1-220)
- test: Ticket-gate tests covering each sub-check + multi-fail reporting (tests/ci/gate-ticket.test.ts) - 8 sub-checks + adversary cases pass

### AC-4 - Pass

Evidence:
- file: dispatchTerminal renders questions[] verbatim + transitions to Needs Author Input (scripts/ci/parse-phase-result.ts:1-260)
- test: needs_input case verifies verbatim payload + transition + artifact upload (tests/ci/parse-phase-result.test.ts) - needs_input path covered

### AC-5 - Pass

Evidence:
- file: Happy-path orchestration (gates -> seed -> bootstrap -> phases -> commit/PR) (.github/workflows/autopipeline.yml:60-260)
- file: Brief seeding with canonical phase-align shape (scripts/ci/seed-brief.ts:1-200)
- file: Work-item bootstrap via direct devBootstrap/devTransition imports (scripts/ci/bootstrap-work-item.ts:1-120)
- test: End-to-end happy-path scenario (TC-4) (tests/ci/self-test/complete-happy-path.test.ts) - happy-path PR body + transitions verified

### AC-6 - Pass

Evidence:
- file: runPhase spawns pi -p --mode json /skill:accord <phase> <ticket> (scripts/ci/run-phase.ts:1-180)
- test: Allow-list regex enforces invocation shape; SDK import ban scans scripts/ci + .yml (tests/ci/no-extra-pi-spawns.test.ts) - every .ts/.yml under scripts/ci matches allow-list; no SDK imports

### AC-7 - Pass

Evidence:
- file: checkCostCap strict-less-than threshold + cost summary body (scripts/ci/parse-phase-result.ts:260-380)
- test: Cost-cap unit tests cover strict <, cumulative, summary content (tests/ci/cost-cap.test.ts) - below/at/above cap + cumulative paths pass

### AC-8 - Pass

Evidence:
- file: renderPrBody includes AC citation + verify report quote + secret-scrub pre-check (scripts/ci/commit-and-pr.ts:1-260)
- test: PR body shape + scrubSecrets test (tests/ci/commit-and-pr.test.ts) - renderPrBody asserts AC + verify quote; scrubSecrets throws on match

### AC-9 - Pass

Evidence:
- file: PR trailer pi.dev/autopilot: v1 + idempotent autopilot/v1 label creation (scripts/ci/commit-and-pr.ts:120-220)
- test: Trailer presence + label idempotency tested (tests/ci/commit-and-pr.test.ts) - trailer literal + labelExists short-circuit pass

### AC-10 - Pass

Evidence:
- file: dispatchTerminal renders blockers/gaps verbatim with transitions (scripts/ci/parse-phase-result.ts:60-180)
- test: Blocked + gaps cases verified verbatim (tests/ci/parse-phase-result.test.ts) - blocked -> Blocked, gaps -> Gaps Reported pass

### AC-11 - Pass

Evidence:
- file: slugify in seed-brief.ts used as branch slug source (scripts/ci/seed-brief.ts:1-100)
- file: commitAndPr uses force-with-lease and upserts PR for the deterministic branch (scripts/ci/commit-and-pr.ts:60-180)
- test: Slug edge cases + branch naming + force-with-lease + upsert (tests/ci/commit-and-pr.test.ts) - branch deterministic, push uses force-with-lease, PR idempotent

### AC-12 - Pass

Evidence:
- file: setup-pi composite: actions/cache@v4 with literal key/restore-keys/paths (.github/actions/setup-pi/action.yml:1-90)
- test: Cache surface parsed and verbatim-asserted (tests/ci/setup-pi-cache.test.ts) - key + restore-keys + paths + env vars asserted

### AC-13 - Pass

Evidence:
- file: Cache path excludes auth.json + sessions/**; post-step rm -f auth.json (.github/actions/setup-pi/action.yml:20-80)
- test: Exclusion + scrub post-step asserted (tests/ci/setup-pi-cache.test.ts) - auth.json + sessions/** excluded; if:always() scrub present

### AC-14 - Pass

Evidence:
- file: Every terminal step uploads accord-state-${{ inputs.ticket }} with overwrite + 14d retention (.github/workflows/autopipeline.yml:200-340)
- test: artifact-upload test walks YAML and asserts canonical block per terminal (tests/ci/artifact-upload.test.ts) - every terminal has matching upload-artifact@v4

### AC-15 - Pass

Evidence:
- file: Workflow input surface with declared defaults (.github/workflows/autopipeline.yml:1-60)
- file: Single source of truth for INPUTS (scripts/ci/lib/inputs.ts:1-120)
- test: Input contract enforced (tests/ci/inputs-and-concurrency.test.ts) - each input + default + type asserted

### AC-16 - Pass

Evidence:
- file: decideResume conjunctive gate: phase + normalised brief hash + strict cost < (scripts/ci/decide-resume.ts:1-180)
- test: Resume matrix + precedence + cleanupPaths + normaliseBrief invariants (tests/ci/decide-resume.test.ts) - all reasons (no_prior_state, phase_non_resumable, brief_drift, cost_cap_breached) covered

### AC-17 - Pass

Evidence:
- file: Self-test workflow triggers on PR; runs scenario corpus + exit-code policy (.github/workflows/test-autopipeline.yml:1-80)
- test: Ten-scenario corpus drives deterministic handlers (tests/ci/self-test/scenarios.test.ts) - 30/30 self-test pass

### AC-18 - Pass

Evidence:
- file: Terminal branches exit 0; MissingSecretError causes non-zero exit (scripts/ci/lib/env.ts:1-100)
- test: Exit-code policy enforced per terminal category (tests/ci/exit-code.test.ts) - all 7 terminals -> 0; missing secret -> non-zero

### AC-19 - Pass

Evidence:
- file: concurrency: group accord-${{ inputs.ticket }}, cancel-in-progress: false (.github/workflows/autopipeline.yml:40-60)
- test: Concurrency block asserted by parser (tests/ci/inputs-and-concurrency.test.ts) - literal concurrency group + cancel flag asserted

### AC-20 - Pass

Evidence:
- file: ANTHROPIC_API_KEY required by env.ts (scripts/ci/lib/env.ts:1-100)
- test: Missing ANTHROPIC_API_KEY -> MISSING_REQUIRED_SECRET: ANTHROPIC_API_KEY (tests/ci/lib/env.test.ts) - 18/18 env tests pass

### AC-21 - Pass

Evidence:
- file: JIRA_BASE_URL required by env.ts (scripts/ci/lib/env.ts:1-100)
- test: Missing JIRA_BASE_URL -> MISSING_REQUIRED_SECRET: JIRA_BASE_URL (tests/ci/lib/env.test.ts) - literal error message asserted

### AC-22 - Pass

Evidence:
- file: JIRA_USER_EMAIL required by env.ts (scripts/ci/lib/env.ts:1-100)
- test: Missing JIRA_USER_EMAIL -> MISSING_REQUIRED_SECRET: JIRA_USER_EMAIL (tests/ci/lib/env.test.ts) - literal error message asserted

### AC-23 - Pass

Evidence:
- file: JIRA_API_TOKEN required by env.ts (scripts/ci/lib/env.ts:1-100)
- test: Missing JIRA_API_TOKEN -> MISSING_REQUIRED_SECRET: JIRA_API_TOKEN (tests/ci/lib/env.test.ts) - literal error message asserted

### AC-24 - Pass

Evidence:
- file: GITHUB_TOKEN resolution + GH_PAT_PR override in same-repo mode (scripts/ci/lib/env.ts:1-100)
- test: resolveGithubToken same-repo cases (tests/ci/lib/env.test.ts) - GITHUB_TOKEN fallback + GH_PAT_PR override + missing -> MISSING_REQUIRED_SECRET: GITHUB_TOKEN

### AC-25 - Pass

Evidence:
- file: GH_PAT_PR required in cross-repo mode (scripts/ci/lib/env.ts:1-100)
- test: resolveGithubToken cross-repo cases throw MISSING_REQUIRED_SECRET: GH_PAT_PR (tests/ci/lib/env.test.ts) - cross-repo mode without GH_PAT_PR fails even with GITHUB_TOKEN set

Next: `/commit` then `/pr`.
