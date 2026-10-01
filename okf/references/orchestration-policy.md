---
type: Reference
title: Orchestration policy
description: The `orchestration.*` configuration keys that govern retry loops, resume chaining, auto-commit, gather attempts, and bounded judgment.
tags: [orchestration, policy, retries, review-loop, judgment]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: policy
    resource: /packages/accord-core/src/orchestration/policy.ts
    title: Policy defaults
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (orchestration)
  - id: config-doc
    resource: /docs/configuration.md
    title: Project configuration
  - id: decide
    resource: /packages/accord-core/src/tasks/decide.ts
    title: Loop decisions from the findings ledger
---

All keys live under `orchestration` in the Dev Harness block (project) or global
`accord.json`. Defaults come from `policy.ts`.

# review_loop (implement; quick-fix review-code)

| Key | Default | Meaning |
|-----|---------|---------|
| `max_critical_retries` | `3` | Retries per loop when gated findings fire |
| `severity_gate` | `"block"` | `block` = critical only; `warn` = warning+critical; `none` = any finding |
| `max_unblocks_per_task` | `1` | `/dev unblock` resets allowed per task, ever |
| `max_lifetime_retries` | retries × (unblocks + 1) | Hard ceiling `/dev unblock` never resets |
| `max_rgr_respawns` | `3` | `phase-code` → `phase-test` respawns (test_issue / touched tests) before block |
| `review_test`, `review_code` | — | Per-loop overrides (`severity_gate`, `max_retries`, `max_lifetime_retries`) |

Findings persist under `requirements[].findings` on the task file ([Per-task file](/references/task-file.md)); counters are `control.retries.*`.

# quick_fix_loop

| Key | Default | Meaning |
|-----|---------|---------|
| `max_test_review_loops` | `5` | test↔review retries (`control.retries.test_review`) before task `blocked` |
| `severity_gate` | `"warn"` | Same semantics as above |

# verify_loop

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `true` | Run **phase-verify-task** after a clean review-code; `false` = review-code clean marks the task done |
| `max_retries` | `3` | Verify-fail → phase-code bounces (each a full code round) before the task blocks for a human |
| `max_lifetime_retries` | retries × (unblocks + 1) | Never reset by unblock |

review-security findings are always advisory (recorded, briefed, never gate).

# resume

| Key | Default | Meaning |
|-----|---------|---------|
| `no_auto_chain_agents` | `["phase-code"]` | Stop the loop before spawning these; `[]` auto-chains through implementation |
| `max_sequential_spawns` | `8` | Spawn cap per `/dev resume` |

# commit

| Key | Default | Meaning |
|-----|---------|---------|
| `on_task_done` | `true` | Every task that reaches `done` gets a commit: refresh `docs/dev/<ID>/trace.*`, stage task-scoped paths (`plan.tasks[].files[].path`, test files, changed files, `docs/dev/<ID>/`) ∩ `git status --untracked-files=all`, commit (empty commit when nothing remains); logs a `<round>/commit` entry. Done tasks without one are swept after every subagent result (core `processSubagentToolResult`, all hosts), so unblocked or failed-commit tasks are retried |
| `on_finalize` | `true` | At closeout (`/dev finish`, `dev_finalize`): sweep uncommitted done tasks, refresh `trace.*` + `verify.md`, then commit `docs/dev/<ID>/` (`[<ID>] Closeout: …`) |

# Other

| Key | Default | Meaning |
|-----|---------|---------|
| `max_gather_attempts` | `3` | align `needs_gather` → gather spawns before escalation to `decisions[]` |
| `implement_loop.*` | — | Legacy; ignored for routing (review-code always follows phase-code) |
| `review.parallel_prefer_sequential_on_timeout` | `true` | Messaging hint only |

# judgment (Pi only)

Bounded LLM supplement before certain resume spawns. Requires `enabled: true` **and**
`ACCORD_ORCHESTRATION_JUDGMENT=1`. Output validated against
`orchestration-judgment-packet.json`; invalid → template appendix. Cannot carry routing fields.

| Key | Meaning |
|-----|---------|
| `enabled` | Opt in |
| `agents` | Allowlist; default `review-test`, `phase-test` |
| `model`, `thinking` | Judgment model; fallback: lightweight tier → last scoped model → chat model (warns) |
| `max_tokens` | 256–8192, default 1536 |

# Example

```json
"orchestration": {
  "review_loop": { "severity_gate": "block", "review_test": { "severity_gate": "warn", "max_retries": 5 } },
  "resume": { "no_auto_chain_agents": [], "max_sequential_spawns": 32 },
  "commit": { "on_task_done": false }
}
```
