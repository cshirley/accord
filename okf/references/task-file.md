---
type: Reference
title: Per-task file (v2)
description: Layout of `.tasks/<ID>-task-N.json` — summary, loop control, requirement → findings trace, round log — plus sidecars, finding lifecycle, and recovery.
tags: [tasks, state, findings, adversarial-loop, recovery, unblock]
status: stable
generated: { by: agent:pi, at: 2026-09-29T14:00:00Z }
sources:
  - id: types
    resource: /packages/accord-core/src/tasks/types.ts
    title: Task file v2 types
  - id: model
    resource: /packages/accord-core/src/tasks/model.ts
    title: Pure model (refs, attribution, ledger, refresh)
  - id: record
    resource: /packages/accord-core/src/tasks/record.ts
    title: Recording agent returns + in-flight protocol
  - id: decide
    resource: /packages/accord-core/src/tasks/decide.ts
    title: Loop decisions and caps
  - id: schema
    resource: /packages/accord-core/schemas/task-schema.json
    title: task-schema.json
  - id: example
    resource: /packages/accord-core/schemas/task-file.example.json
    title: Worked example (T1→V2 flow)
  - id: unblock
    resource: /packages/accord-core/src/queries/unblock-task.ts
    title: Per-blocker unblock
  - id: plan
    resource: /docs/plans/task-trace-ledger-plan.md
    title: Design plan
---

The per-task file is orchestrator-owned (agents read it, never write it). Read order = priority:

| Section | Purpose |
|---------|---------|
| header | `work_item`, `task`, `title`, `plan` (`plan.json#/tasks/i`), `spec` |
| `summary` | **Snapshot** recomputed on every write: `headline`, requirement counts, `next {who, why, do[]}` (exact commands), `blockers[]`, `advisories[]` |
| `control` | What the harness needs to resume: `owner_nonce`, `phase`, `status`, `pre_impl_gates`, `round`, `in_flight`, `retries {test_review, code_review, rgr, verify: {used, lifetime}, unblocks}`, `blocked {kind, reason, ref, loop?, lifetime?}`, `test_files`, `stub_files`, `last_test_run`, `quick_fix_contract?` |
| `requirements[]` | One per covered AC (`QF` for quick fixes, `_task` for unattributed): AC `text`, `test_cases`, `status`, `changes[]` (file, kind, `by` runs), `findings[]` (nested, with `history`), `verification` |
| `log[]` | One line per agent run, harness decision, or human action: `ref`, `at`, `result`, `note`, agent `events[]`, `warnings[]` |

Raw return packets and test/verify output live in the sidecar folder `.tasks/<ID>-task-N/`
(`<round>-<agent>.json`, `<round>-<agent>.output.txt`), write-once.

# Rounds and refs

Refs are `<round>/<actor>`: `T<n>` test loop (phase-test ↔ review-test), `C<n>` code loop
(phase-code → review-security → review-code), `V<n>` verify (phase-verify-task). Actors also
include `decision`, `harness` (import-only RED guard), `unblock`, `block`, `commit`. Rounds open at
harness decisions; a re-run in the same round gets a `.2` suffix.

| Loop | Fixer | Reviewers | Retry counter | Exit |
|------|-------|-----------|---------------|------|
| T | phase-test | review-test | `test_review` | no gating → open `C` |
| C | phase-code | review-security (advisory) → review-code | `code_review` | no gating → open `V` (or `done` when `verify_loop.enabled: false`) |
| RGR | phase-test (new `T`) | review-test | `rgr` | back to a new `C` |
| V | phase-verify-task | — (fail → full `C` round) | `verify` | all ACs pass → `done` |

# Findings

- Stable `F-nnn` ids; each lives under one requirement (`also_affects` for others). Reviewers
  set `ac_id` using the `requirement_map` (file → AC from `changes[]`); the harness falls back to
  the same map, then `_task`. A similar re-raise (same AC/file, similar text) keeps the old id.
- `loop` owns resolution; only the raising agent type (or a human) can close a finding.
- Lifecycle: `open` → `addressed` (fixer `fixed`) → `verified` | `reraised`; `disputed` →
  `dispute_upheld` | `reraised`; `wont_fix_proposed` → `wont_fix_accepted` (reviewer or human);
  `waived` (human). A reviewer silently not re-raising an addressed/disputed finding closes it.
- Gating = `open | reraised | disputed | wont_fix_proposed`, non-advisory. Below-gate findings and
  all review-security findings are `advisory` (shown, never block).
- Requirement `status`: `pending → covered → open → implemented → satisfied` (`satisfied` only
  from phase-verify-task `evidence[]`), or `waived`.

# Recovery

`control.in_flight` is set to `spawned` before a task-pipeline spawn and `returned` (with the
raw packet sidecar) when a packet arrives; the post-result handler clears it. On resume,
`returned` re-applies the sidecar packet (handlers are idempotent by log ref); `spawned` respawns
the same ref without consuming a retry.

# Human unblock

`accord unblock <ID> --task N [--note|--fixed|--accept|--waive F-n|AC-n "reason"]… [--force "reason"]`
(interactive per-blocker walk without flags; `/dev unblock`, `dev_unblock` equivalent). Decisions
are recorded in finding history. All blockers accepted/waived → the gate passes without using
unblock budget; otherwise the blocked loop's `used` counter resets, `unblocks += 1`, and a new
round opens. Lifetime caps, `max_unblocks_per_task`, and blind unblocks (no decision, no working
tree change) are refused. See [Unblock a task](/playbooks/unblock-a-task.md).

# v1 files

Not supported. Loading one stops resume with `accord task reseed <ID> [--task n]` (archives the
old file to `.tasks/archive/`, seeds v2 from the plan).
