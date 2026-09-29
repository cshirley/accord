---
type: Architecture
title: Crucible verification
description: How ACCORD turns acceptance criteria into evidence — test-first loop, adversarial test review, post-code gates, and acceptance verification.
tags: [crucible, verification, tdd, review-test, evidence]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow
  - id: verification
    resource: /packages/accord-core/src/verification/
    title: Crucible command runner + staleness
  - id: red-class
    resource: /packages/accord-core/src/orchestration/test-red-classification.ts
    title: Import-only RED classifier
  - id: head-commit
    resource: https://github.com/cshirley/accord/commit/46b8fa3
    title: Converge phase-test/review-test loop
---

# Per-task loop

```mermaid
flowchart LR
  T["phase-test<br/>failing tests + stubs"] --> RED{"import-only RED?"}
  RED -->|yes| T
  RED -->|no| RT["review-test<br/>(pre-impl, adversarial)"]
  RT -->|issues ≥ gate| T
  RT -->|clean| C["phase-code"]
  C --> PV["post-code verify<br/>type_check hard · tests advisory"]
  PV --> SEC{"security-sensitive?"}
  SEC -->|yes| RS["review-security"]
  SEC -->|no| RC["review-code"]
  RS --> RC
  RC -->|issues ≥ gate| C
  RC -->|clean| DONE(["task done → optional auto-commit"])
```

Rules:

- `phase-test` writes tests (and declares unimplemented `stub_files`); `phase-code` **never writes tests** and must replace stubs. A violation respawns `phase-test`.
- Import/resolution-only RED (`Cannot find module`, `ModuleNotFoundError`, …) is detected deterministically and bounced back as a synthetic critical `import_only_red` finding; it consumes a review-test retry slot so caps still trip.
- Retry briefs carry `prior_round` (test files, stubs, output); `phase-test` must answer each finding in `review_responses`. Feedback is injected only from the active task.
- Retry caps and severity gates come from [Orchestration policy](/references/orchestration-policy.md). On cap, task goes `blocked`; see [Unblock a task](/playbooks/unblock-a-task.md).

# Acceptance verification

`/dev finish <ID>` → verify preflight (staleness + `verification_commands`) →
`phase-verify-acceptance` → `dev_verify_summary` (writes `verify.md`) → `dev_finalize` (terminal
outcome, `workflow-cost.json`).

| AC type | Verified by |
|---------|-------------|
| `scenario` (Given/When/Then) | Test mapped to AC ID |
| `constraint` | Runtime assertion / perf test |
| `architectural` | Lint/enforcement rule |
| `property` | Property-based test (future) |

`verify.json` verdict is `pass` or `gaps`; gaps are derived from failing `criteria[]` at render
time (no separate array). `/dev gaps <ID>` lists them; `--tickets` spawns `phase-gaps`.
