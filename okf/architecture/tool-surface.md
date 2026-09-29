---
type: Architecture
title: dev_* tool surface
description: Harness tools registered once in accord-core and exposed through Pi (with dynamic activation) and stdio MCP.
tags: [tools, mcp, dynamic-tools, dev_orchestrate]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: registry
    resource: /packages/accord-core/src/tools/registry.ts
    title: dev_* tool registry
  - id: active-set
    resource: /packages/accord-core/src/tools/active-set.ts
    title: Core set + bundles
  - id: hooks-doc
    resource: /docs/hooks-and-tools.md
    title: Event hooks and tools
  - id: mcp
    resource: /packages/accord-mcp/src/register-tools.ts
    title: MCP registration
---

# Single registry

Add/rename tools only in `packages/accord-core/src/tools/registry.ts`; Pi (`pi-accord`) and MCP
(`accord-mcp`) pick them up automatically. Pi wrappers are thin envelopes around core functions.

# Tools by domain

| Domain | Tools |
|--------|-------|
| Intent + bootstrap | `dev_intent`, `dev_intent_enrich`, `dev_bootstrap`, `dev_quick_fix_brief` |
| State queries | `dev_tasks`, `dev_resume_state`, `dev_work_item_status`, `dev_trace`, `dev_review_queue`, `dev_workflow_cost` |
| Lifecycle | `dev_transition`, `dev_checkpoint`, `dev_promote_events`, `dev_rehydrate`, `dev_finalize`, `dev_unblock` |
| Briefing | `dev_code_brief`, `dev_nonce`, `dev_decision_packet` |
| Verification | `dev_spec_gaps`, `dev_verify_summary` |
| Orchestration | `dev_orchestrate` (`resume` / `finish`, optional `execute`), `dev_subagent_preflight` |
| Init | `dev_init_detect`, `dev_init_write` |
| Meta | `dev_retro` |

# Dynamic activation (Pi)

Default on (`ACCORD_DYNAMIC_TOOLS=0` disables). Core set always active: `dev_intent`,
`dev_intent_enrich`, `dev_bootstrap`, `dev_resume_state`, `dev_work_item_status`, `dev_tasks`,
`dev_trace`, `subagent`. Bundles `spec`, `plan`, `code`, `init`, `meta` activate on `/dev` subcommands,
bootstrap, orchestration dispatch, or when the model calls an inactive `dev_*` tool.

Separate but related: `pi-git` / `pi-integrations` progressive tools (`PI_PROGRESSIVE_TOOLS`,
`PI_GIT_DYNAMIC_TOOLS`, `PI_INTEGRATIONS_DYNAMIC_TOOLS`) loaded via `search_accord_tools`.

# MCP

```bash
ACCORD_CWD=/path/to/repo bun run mcp                      # plan-only dev_orchestrate
ACCORD_MCP_HARNESS=pi ACCORD_CWD=/path/to/repo bun run mcp # dev_orchestrate executes spawns
```

MCP always exposes the full registry, runs no Pi hooks, and has no `runJudgment` — use
`spawn_task_after_template_judgment` from `dev_orchestrate` for the template path.
