---
type: Architecture
title: Lifecycle hooks
description: Structural enforcement layer — host-neutral hook callables in accord-core mapped onto Pi lifecycle events.
tags: [hooks, validation, preflight, enforcement, pi]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: hooks-doc
    resource: /docs/hooks-and-tools.md
    title: Event hooks and tools
  - id: listeners
    resource: /packages/pi-accord/src/pi-hook-listeners.ts
    title: Pi hook listeners
  - id: harness
    resource: /packages/accord-core/src/harness/
    title: Host-neutral hook callables
  - id: validation
    resource: /packages/accord-core/src/artifacts/validation.ts
    title: SCHEMA_MAP and artifact validation
---

# Principle

Hooks catch failures no agent should be asked to catch. Logic lives in
`packages/accord-core/src/harness/` and `subagent/`; `pi-hook-listeners.ts` only maps Pi events
to those callables. Cursor or other hosts can call the same functions from their own hook
scripts. **MCP does not run hooks** — add host hooks or CI steps for parity.

# Hook table

| Hook | Pi event | Behaviour |
|------|----------|-----------|
| Schema validation | `tool_result` write/edit on `.tasks/*.json`, `docs/dev/**/*.json` | Pick schema via `SCHEMA_MAP`; reject malformed writes. Regenerates `spec.md` from `spec.json` |
| Workflow-state write guard | write/edit on orchestrator-owned state | Blocks agent writes to work-item/task/checkpoint JSON (`ACCORD_ALLOW_AGENT_WORKFLOW_WRITES=1` to bypass) |
| Config auto-refresh | write/edit to `AGENTS.md` | Reload cached `devConfig` |
| Config guard + brief inject | `tool_call` `subagent` | Block `requiresConfig` agents without config; set `agentFile`, `systemAppend` (project stack), `response` contract |
| Gather preflight | `tool_call` `phase-gather` | Provider availability + playbook paths ([Providers](/architecture/providers.md)) |
| Verify preflight | `tool_call` `phase-verify-*` | Spec/plan presence + staleness; run `verification_commands`; block if all fail; inject results |
| Subagent result | `tool_result` `subagent` | Usage → `<ID>-usage.jsonl` + `cost_usd`; extract/validate packet; post-code verify for `verifyAfter` agents |
| Pending-decision notify | `agent_settled` | Count pending decisions across work items; notify |
| Session start | `session_start` | Load config, seed cost cache, dynamic tool set, restore status bar, asset bootstrap |
| Asset bootstrap | `session_start` | Link bundled assets if missing/stale (`ACCORD_AUTO_INSTALL_ASSETS=0` opts out) |
| Provider headers | `before_provider_headers` | `X-Accord-Run-Id`, `X-Accord-Session-Tag`, `X-Accord-Work-Item-Id` |
| Status bar | continuous | Language, active work item + phase, pending decisions, cumulative cost |

# Post-code verification

For `phase-code` (`verifyAfter: true`): run `type_check` then `test.command` from Dev Harness.
Type-check failure is a **hard gate** (appended as error); test failure is **advisory**.

# Display-only entries

`registerEntryRenderer` renders `dev-harness-run`, `thrift-output-level`, `worktree-state`
markers (not in LLM context). `read`/`write`/`edit` are re-registered only to highlight
`.tasks/` and `docs/dev/` paths in the TUI.
