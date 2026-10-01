---
type: Reference
title: Artifacts and state
description: Committed contract artifacts under docs/dev/<ID>/, transient runtime state under .tasks/, work-item ID format, and decisions[].
tags: [artifacts, state, work-item, tasks, checkpoint, decisions]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: artifacts-doc
    resource: /docs/artifacts.md
    title: Artifacts and work item IDs
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow (Artifacts, Recovery)
  - id: tasks-dir
    resource: /packages/accord-core/src/work-items/tasks-dir.ts
    title: .tasks/ resolution
  - id: trace
    resource: /packages/accord-core/src/artifacts/trace-artifact.ts
    title: Implementation trace artifact
  - id: verify-summary
    resource: /packages/accord-core/src/queries/verify-summary.ts
    title: verify.md rendering + discrepancies
  - id: rehydrate
    resource: /packages/accord-core/src/work-items/rehydrate.ts
    title: Rehydrate from artifacts
---

# Committed — `docs/dev/<ID>/`

| File | Written by | Notes |
|------|------------|-------|
| `brief.md` | `phase-align` | Human-language problem framing |
| `spec.json` | `phase-spec` | Contract; edit this, never `spec.md` |
| `spec.md` | harness | Regenerated whenever `spec.json` validates (incl. `diagrams[]` Mermaid) |
| `plan.json` | `phase-plan` | Tasks with `covers_ac`, `files`, `test_files`, steps, `challenge` |
| `verify.json` | `phase-verify-acceptance` | Per-AC `criteria[]` + `summary`; schema-validated by the harness on return and before finalize (invalid → not applied / not finalized) |
| `verify.md` | `dev_verify_summary` | **The single review document**: per-AC verdict + evidence merged with the trace (tasks, files, verified tests), task commits, accepted risks, decisions/deviations, verify-vs-trace discrepancies |
| `trace.json` / `.md` | harness (task done, verify summary, finalize) | Committed projection of `.tasks/`: per-AC implementation + verification, accepted/unresolved findings, decisions, deviations, task commits, RED + final-verify output excerpts; regenerate, don't edit |
| `workflow-cost.json` / `.md` | `dev_finalize` | Token/USD rollup from usage log; regenerate, don't edit |

Each `done` task gets a harness commit (task files + `trace.*`); closeout commits the rest of
`docs/dev/<ID>/` — see `orchestration.commit` in [Orchestration policy](/references/orchestration-policy.md).

Artifacts are immutable after their phase returns `done`; changes go through
`/dev amend-spec` or a replan.

# Transient — `.tasks/` (gitignored)

| File | Content |
|------|---------|
| `<ID>.json` | **Authoritative** work-item state: `pattern`, `variant`, `phase`, `decisions[]`, `deviations[]`, `cost_usd`, `gather_attempts` |
| `<ID>-checkpoint.json` | Multi-turn draft + `answered`/`pending` (derived cache of `decisions[]`); atomic tmp+rename writes |
| `<ID>-task-N.json` | Per-task v2 file: `summary` (headline, next action, blockers), `control` (phase, status, round, retries, in-flight run), `requirements[]` (AC → changes → findings → history → verification), `log[]` — see [Per-task file](/references/task-file.md) |
| `<ID>-task-N/` | Write-once sidecars: raw return packets and test/verify output per run |
| `archive/` | v1 task files replaced by `accord task reseed` |
| `<ID>-enrichments/` | Gather cache payloads |
| `<ID>-usage.jsonl` | One line per subagent spawn (every retry/re-run, incl. failures, timeouts, and spawns without host usage → `usage_missing`, or packet `usage` → `usage_self_reported`), orchestrator turn, and judgment call (`source: judgment`). Rebuilt `.tasks/` seeds `carried_forward` lines from the committed `workflow-cost.json` |
| `<ID>-investigation.json` | Investigate-pattern log |
| `.exec-spawn/` | Staged task files for exec harness |

`.tasks/` is found by walking up to the git root, then scanning nested monorepo package dirs
(`apps/`, `packages/`, `libs/`, `services/`, `modules/`). If lost, `/dev rehydrate <ID>` rebuilds
it from `docs/dev/<ID>/` (needs at least `brief.md` or `spec.json`).

# Work-item IDs

Pattern `^[A-Z]+(-[A-Z]+)*-\d+$`. Ticket-based (`ACCORD-1234`, `BUG-42`) or keyword slug for
no-ticket work (`AUTH-REFRESH-1`).

# decisions[]

Entry: `{ id, source, status: "pending"|"resolved", question, answer?, asked_at, resolved_at? }`.
Sources: `needs_input` questions, `stuck` escalations, promoted task `escalation` events, gather
exhaustion. Pending decisions block implementation agents on resume (gate). See
[Answer decisions](/playbooks/answer-decisions.md).
