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
| `verify.json` | `phase-verify-acceptance` | Per-AC `criteria[]` + `summary` |
| `verify.md` | `dev_verify_summary` | PR-friendly summary |
| `workflow-cost.json` / `.md` | `dev_finalize` | Token/USD rollup from usage log; regenerate, don't edit |

Artifacts are immutable after their phase returns `done`; changes go through
`/dev amend-spec` or a replan.

# Transient — `.tasks/` (gitignored)

| File | Content |
|------|---------|
| `<ID>.json` | **Authoritative** work-item state: `pattern`, `variant`, `phase`, `decisions[]`, `deviations[]`, `cost_usd`, `gather_attempts` |
| `<ID>-checkpoint.json` | Multi-turn draft + `answered`/`pending` (derived cache of `decisions[]`); atomic tmp+rename writes |
| `<ID>-task-N.json` | Per-task `phase`, `status` (`pending`/`in_progress`/`done`/`blocked`), `owner_nonce`, append-only `events[]`, `last_review_feedback`, loop counters |
| `<ID>-enrichments/` | Gather cache payloads |
| `<ID>-usage.jsonl` | Per-spawn token/cost lines |
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
