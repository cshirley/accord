---
type: Architecture
title: Phase and review agents
description: The 20 bundled ACCORD agents, their tiers, config requirements, and review ownership boundaries.
tags: [agents, phase, review, registry, tiers]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: agents-dir
    resource: /packages/accord-assets/agents/accord/
    title: Agent markdown definitions
  - id: registry
    resource: /packages/accord-core/src/agents/registry.ts
    title: Agent metadata registry
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow (phase + review agent tables)
  - id: agents-md
    resource: /AGENTS.md
    title: Review agent scope matrix
---

# Definition model

Each agent is a markdown file at `packages/accord-assets/agents/accord/<name>.md` with
frontmatter (`name`, `description`, `tier`, `tools`, optional `model` / `thinking`) and a
prompt body. The `accord/` directory gives it the path-derived namespace `accord`, letting
`subagent.json` apply per-namespace profile overrides. Three files must agree (enforced by
`bun run validate:assets`):

1. Agent markdown + `packages/accord-assets/manifest.json`
2. `packages/accord-core/src/agents/registry.ts` — `schemas`, `requiresConfig`, `verifyAfter`, `deferConfigGuard`
3. `packages/accord-core/schemas/return-schemas/<name>.json` + `schemas/examples/<name>.json`

Tiers (`reasoning`, `workhorse`, `lightweight`, plus `review` for review agents) map to
backend/model/thinking via `subagent.json` profiles or `harness.tiers`.

# Phase agents

| Agent | Tier | Config req. | Output |
|-------|------|-------------|--------|
| `phase-align` | reasoning | no | `brief.md`; may return `needs_gather` |
| `phase-gather` | workhorse | no | Tracker + enrichment context, `enrichment_cache` |
| `phase-explore` | workhorse | yes | Files, symbols, reuse candidates |
| `phase-spec` | reasoning | yes | `spec.json` (multi-turn) |
| `phase-plan` | reasoning | yes | `plan.json` (multi-turn) |
| `phase-test` | workhorse | yes | Failing tests mapped to `covers_ac`, `stub_files`, `review_responses` |
| `phase-code` | workhorse | yes, `verifyAfter` | Production code; `deviations`; never writes tests |
| `phase-verify-task` | workhorse | yes | Evidence for verify-only plan tasks |
| `phase-verify-acceptance` | workhorse | yes (deferred guard) | `verify.json` per-AC evidence |
| `phase-verify-infra` | workhorse | yes (deferred guard) | IaC validity/preview |
| `phase-hypothesise` | reasoning | no | Hypotheses with evidence + test plans |
| `phase-gaps` | lightweight | no | Gap → suggested action / ticket |

# Review agents

Read-only. Shared packet: `verdict` (`clean` / `issues`) + `findings[]` with `severity`
(`critical` / `warning` / `suggestion`), `file`, `line`, `issue`, `evidence`,
`recommendation`. Findings without `file` + `line` are auto-downgraded to `suggestion`.

| Agent | Tier | Owns | Trigger |
|-------|------|------|---------|
| `review-spec` | workhorse | Spec structure, AC↔TC integrity | After spec draft |
| `review-plan` | reasoning | Plan ordering, task coverage, reuse | After plan draft |
| `review-test` | reasoning | Test adequacy, adversarial gaps | **Pre-impl** after `phase-test`; `/review` post-impl |
| `review-security` | reasoning | OWASP, authz, secrets, supply chain | Security-sensitive paths, after `phase-code` before `review-code` |
| `review-code` | workhorse | Correctness, plan drift, observability | **Post-impl** after `phase-code` |
| `review-design` | workhorse | ADR / design reasoning | `analyse` pattern |
| `review-investigation` | workhorse | Hypothesis quality, anti-anchoring | `investigate` pattern |
| `review-deviation` | workhorse | Accept vs revert a plan deviation | `deviation` event |

`review-code` defers security to `review-security` and test adequacy to `review-test`.
`review-test` and `review-code` run in separate processes at different stages to avoid
cross-anchoring.

# Adding an agent

See [Add an agent](/playbooks/add-an-agent.md).
