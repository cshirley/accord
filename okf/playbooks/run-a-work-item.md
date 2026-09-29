---
type: Playbook
title: Run a work item
description: Take a ticket or free-text request through ACCORD from contract to PR, interactively in Pi or headlessly via the accord CLI.
tags: [workflow, dev, resume, finish, pr]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow
  - id: help
    resource: /packages/accord-core/src/commands/help.ts
    title: /dev help
  - id: cli-doc
    resource: /docs/accord-cli.md
    title: Standalone accord CLI
---

# Prerequisites

- Target repo has AGENTS.md with a `## Dev Harness` block (`/dev init` or `accord init --write`).
- Tracker access for the configured `tracker.type` (MCP tool, CLI fallback, or env token).

# Steps (Pi)

## 1. Start

```
/dev PROJ-1234 add OAuth2 refresh token support
```

Intent is classified ([Patterns](/references/patterns.md)), a work item bootstrapped in
`.tasks/PROJ-1234.json`, and align → gather → spec begin.

## 2. Agree the contract

`phase-spec` and `phase-plan` are multi-turn. Answer questions via `/dev review` (batched) then
`/dev resume PROJ-1234`. Check spec quality with `/dev spec-gaps PROJ-1234`. Approve
`docs/dev/PROJ-1234/spec.json` and `plan.json` — first synchronous gate.

## 3. Implement

```
/dev resume PROJ-1234
```

Runs the per-task Crucible loop ([Crucible](/architecture/crucible-verification.md)). By default
the loop stops before each `phase-code`; re-run `/dev resume` or set
`orchestration.resume.no_auto_chain_agents: []`. Tasks auto-commit on done unless
`orchestration.commit.on_task_done: false`. Review deviations with `/dev deviations PROJ-1234`.

## 4. Finish

```
/dev finish PROJ-1234
```

| Packet | Next |
|--------|------|
| COMPLETE | `/commit` → `/pr` |
| GAPS | `/dev gaps PROJ-1234` — fix, then `/dev check PROJ-1234` |
| NEEDS_DECISION | `/dev review` |
| BLOCKED | Fix cause → `/dev resume PROJ-1234` |

# Headless

```bash
accord run "PROJ-1234 add OAuth2 refresh token support" -y --finish
# or step-wise
accord resume PROJ-1234 --harness pi -y
accord drive PROJ-1234 --finish --max-rounds 10
accord finish PROJ-1234
```

Exit code 2 = stuck; see [Answer decisions](/playbooks/answer-decisions.md).

# Recovery

- Lost `.tasks/`: `/dev rehydrate PROJ-1234`.
- Safe to `/clear` or start a new session between rounds; all state is on disk.
- Cost: `/dev tasks`; rollup written to `workflow-cost.json` at finish.
