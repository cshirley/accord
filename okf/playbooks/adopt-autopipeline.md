---
type: Playbook
title: Adopt the ACCORD autopipeline
description: Opt a consumer repo into the reusable GitHub Actions workflow that drives a Jira ticket from spec to PR.
tags: [ci, github-actions, jira, autopipeline]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: quickstart
    resource: /docs/ci/consumer-quickstart.md
    title: Consumer quickstart
  - id: autopipeline
    resource: /docs/ci/autopipeline.md
    title: Autopipeline architecture + contract
  - id: example
    resource: /examples/consumer-repo/
    title: Example consumer repo
  - id: troubleshooting
    resource: /docs/ci/troubleshooting.md
    title: Autopipeline troubleshooting
---

# Trigger

A team wants tickets moved to `Ready for Autopilot` to run spec → plan → code → verify → commit
→ PR unattended.

# Steps

## 1. Wrapper workflow

Copy `examples/consumer-repo/.github/workflows/jira-autopipeline.yml`:

```yaml
jobs:
  autopipeline:
    uses: cshirley/accord/.github/workflows/autopipeline.yml@v1
    with:
      ticket: ${{ inputs.ticket || github.event.client_payload.ticket }}
    secrets: inherit
```

Optional inputs: `harness` (`claude`), `accord_ref` (`v1`), `max_runtime_minutes` (90),
`max_cost_usd` (20), `base_branch`, `branch_prefix` (`accord/`), `dry_run`, `runner`,
`subagent_profile` (`anthropic-direct`).

## 2. Secrets

`ANTHROPIC_API_KEY`, `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN` (required);
`GH_PAT_PR` (optional, cross-repo PRs). Missing → `MISSING_REQUIRED_SECRET: <NAME>` before any
LLM/Jira call.

## 3. AGENTS.md

Copy `examples/consumer-repo/AGENTS.md`; `## Dev Harness` must have non-empty `test.command`.

## 4. Atlassian Automation

Import `examples/consumer-repo/atlassian-automation-rule.json`; set actor, dispatch URL, PAT.
Payload must carry `client_payload.ticket` and `status_at_trigger`. See `docs/ci/atlassian-automation.md`.

## 5. Verify

Move a sample ticket to the trigger status; workflow should start within ~10s.

# Outcomes

| Branch | Jira transition |
|--------|-----------------|
| AGENTS.md / Jira completeness gate fail | `Needs Triage` |
| `needs_input` | `Needs Author Input` |
| `blocked` | `Blocked` |
| `gaps` | `Gaps Reported` |
| cost ≥ `max_cost_usd` | `Cost Exceeded` |
| Complete | `In Review` + PR |

All exit 0; non-zero only for infra failures. Reruns resume only if prior phase is
`speccing`/`planning`/`implementing`, the normalised brief hash is unchanged, and cost < cap.

# Model profiles

Default Anthropic profile from `packages/accord-cli/ci/subagent.json`. Override by committing
`ci/subagent.json`, copying it into `~/.config/pi/agent/subagent.json` in a pre-run step, and
setting `subagent_profile`. Unknown profile fails fast. `reviewProfile` / `agentProfiles` enable
cross-vendor adversarial review.
