# Problem Brief: <work_item_id> — <short title>

Date: <YYYY-MM-DD from `date +%F`>

## Core Problem
<1–2 paragraphs: what is broken or missing, who is affected, why it matters, cost of inaction.>

## Stakeholders
<End users and their expectations. Business sponsor, driver, success metrics. Who signs off.>

## Current State
<How it works today, with `file:line` references, data flows, deployment and security posture. Add one mermaid diagram when several systems interact.>

## Desired Outcome
<What success looks like for users and for the business.>

## Done means (observable)
<Commands, queries, screenshots or logs that show the work is finished. Each item is something a person can run or see.>

## Non-goals
<What this change will not do, and what must not be touched.>

## Appetite
<Size cap: how much effort is worth spending. Rule: if the work exceeds it, split it and write the rest down as a future plan instead of growing the change.>

## Security & Data
<Auth model, trust boundaries, data sensitivity (PII, PHI, payment), compliance, secrets, encryption, access control. `n/a` with a reason if irrelevant. Link the risk register if the `risk-checklist` skill was run.>

## Infrastructure & Deployment
<Environments, deployment strategy, migration path, feature flags, rollback, external dependencies. `n/a` with a reason if irrelevant.>

## Scale & Performance
<Load, latency budget, concurrency, data volume, caching. `n/a` with a reason if irrelevant.>

## Failure behaviour
<For each dependency: what happens when it is down or slow (timeout, retry, circuit breaker, fallback)? Does an optional dependency block the main path?>

## Constraints
<Timeline, budget, compatibility, fixed technology choices, team capacity, regulatory dates.>

## Existing patterns to reuse
<Output of the `reuse-scout` skill: candidates with `file:line` and fit (use as-is, extend, compose with, partial match), plus what was searched. State the reason for any new pattern.>

## Repo and environment facts
<Package manager and test commands, runtime constraints, worktree path and branch, models or tools the work depends on. Only facts that would otherwise be discovered by trial and error.>

## Approach Direction
<The direction agreed during alignment: build, buy or extend; phasing; key technical decisions. A direction, not a design.>

## Telemetry & Observability
<What must be observable in production, who consumes it, existing stack, alerting. `n/a` with a reason if irrelevant.>

## Decision and assumption ledger
| ID | Decision or assumption | Alternatives | Decided by | Status |
|----|------------------------|--------------|------------|--------|
| D-1 | <choice> | <what else was considered> | user / agent | confirmed / UNCONFIRMED |

Status `UNCONFIRMED` means the agent chose and the user has not agreed. None may remain when the brief is final.

## Open Questions
<Anything contested or unaddressed. Bullets. The spec phase resolves them.>

## Alignment Markers
| ID | Claim | Status | Dimension |
|----|-------|--------|-----------|
| am-1 | <specific factual claim> | confirmed | problem |

## Gathered Context
<External context (tickets, documents) that informed the brief. Omit when none.>
