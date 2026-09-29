---
type: Reference
title: /dev command
description: Subcommands of the Pi /dev (alias /accord) entry point and how each is routed.
tags: [dev, command, pi, routing]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: help
    resource: /packages/accord-core/src/commands/help.ts
    title: /dev help text
  - id: routing
    resource: /packages/accord-core/src/commands/subcommand-routing.ts
    title: Subcommand routing
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow (Commands)
---

# Routing

| Route | Subcommands |
|-------|-------------|
| Local (in extension, deterministic) | `help`, `tasks`, `retro`, `tag`, `rehydrate`, `init`, `spec-gaps`, `review`, `gaps`, `deviations`, `block`, `unblock` |
| Core orchestrator (delegated to `accord-cli`) | `resume`, `finish`, `align`, `spec`, `plan`, `check`, `amend-spec` |
| Conditional spawns | `gaps --tickets` → `phase-gaps`; `deviations review` → `review-deviation` |
| Free text | `dev_intent` rules → optional bootstrap → resume if an ID is present, else in-session follow-up with `dev_*` tools |

# Subcommands

| Command | Effect |
|---------|--------|
| `/dev` | List active work or show help |
| `/dev init` | Detect stack, write `## Dev Harness` block to AGENTS.md |
| `/dev <ID>` / `/dev <ID> <text>` / `/dev <text>` | Classify, bootstrap work item, dispatch |
| `/dev align\|spec\|plan <ID>` | Force phase (`phase-align` / `phase-spec` / `phase-plan`) |
| `/dev resume <ID> [--allow-pending-decisions]` | Continue from current phase + checkpoint; replans in one command |
| `/dev finish <ID>` | verify-acceptance → `dev_verify_summary` → `dev_finalize` |
| `/dev check <ID>` | Rerun lower-level acceptance checks |
| `/dev amend-spec <ID>` | Controlled spec amendment |
| `/dev gaps <ID> [--tickets]` | List verify gaps; optionally draft follow-up tickets |
| `/dev deviations <ID>` | List / accept / revert / review plan deviations |
| `/dev review [<ID>]` | Decision queue — answer pending questions in one pass |
| `/dev tasks` | Dashboard: status, phase, cost per work item |
| `/dev spec-gaps <ID>` | 10-point spec checklist |
| `/dev rehydrate <ID>` | Rebuild `.tasks/` state from `docs/dev/<ID>/` |
| `/dev block <ID> <task> <reason>` | Force a task to `blocked` |
| `/dev unblock <ID> [task_id]` | Clear review-loop retry-cap block (bounded by lifetime ceiling) |
| `/dev retro` | Analyse sessions for shift-left improvements |
| `/dev tag [<label>]` | Label session for usage analytics |

# Happy path

```
/dev init → /dev PROJ-1 <text> → approve spec/plan (/dev review) → /dev resume PROJ-1 → /dev finish PROJ-1
  COMPLETE → /commit → /pr   GAPS → /dev gaps   NEEDS_DECISION → /dev review   BLOCKED → /dev resume
```

Safe to `/clear` between rounds; state is on disk. See [Run a work item](/playbooks/run-a-work-item.md).
