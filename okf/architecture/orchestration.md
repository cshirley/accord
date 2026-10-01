---
type: Architecture
title: Core orchestration
description: Harness-owned deterministic routing and outer execution loop in accord-core; hosts implement ports only.
tags: [orchestration, routing, resume, finish, state-machine]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: design
    resource: /docs/harness-orchestration.md
    title: Harness orchestration (design)
  - id: host
    resource: /packages/accord-core/src/orchestration/host.ts
    title: Host ports
  - id: runner
    resource: /packages/accord-core/src/orchestration/runner.ts
    title: Orchestration runner
  - id: resolve
    resource: /packages/accord-core/src/orchestration/resolve/
    title: Resolution (resume, finish, forced subcommands)
  - id: post-result
    resource: /packages/accord-core/src/orchestration/post-result/
    title: Per-agent post-result handlers
  - id: policy
    resource: /packages/accord-core/src/orchestration/policy.ts
    title: Loop and retry policy defaults
---

# Summary

Routing lives in **`packages/accord-core/src/orchestration/`**, not in a model or skill. The
previous skill-as-orchestrator design was removed; the main-session model no longer chooses
`subagent({ agent })` names. Inputs are work-item state, checkpoints, pattern/variant, and
validated return packets; output is the next allowed step (spawn a registered agent, run
internal `dev_*` steps, or pause for user input).

`ACCORD_CORE_ORCHESTRATOR` defaults on. Setting `0`/`false`/`off` disables programmatic spawns
and leaves only local handlers and in-session tools — not recommended.

# Components

| Module | Role |
|--------|------|
| `resolve/` | Pure resolution: which agent `/dev resume` / `finish` / forced subcommands (`align`, `spec`, `plan`, `check`) should run, via registry IDs and coarse phase map (`phase-coarse-routing.ts`) |
| `plan.ts` | Resolution → `next_steps` payload; same JSON as `dev_orchestrate` and `accord plan --json` |
| `runner.ts` | Executes steps against an `OrchestrationRuntimeHost`; `runResumeOrchestrationWithReplans` replans after each successful spawn; `runFinishOrchestration` spawns `phase-verify-acceptance`, schema-checks `verify.json`, then `dev_verify_summary` → `dev_finalize` → closeout commit |
| `post-result/` | One handler per agent (`phase-align`, `phase-spec`, `phase-plan`, `phase-test`, `phase-code`, `phase-verify-*`, `review-test`, `review-code`, `review-security`) plus universal `needs-input.ts` and `stuck.ts` |
| `policy.ts` | Retry caps, severity gates, resume chaining limits — see [Orchestration policy](/references/orchestration-policy.md) |
| `pending-decisions-gate.ts` | Blocks implementation agents while `decisions[]` has pending entries |
| `test-red-classification.ts` | Detects import-only RED in `phase-test` output and bounces back without spending a `review-test` spawn |
| `judgment.ts` | Optional bounded LLM supplement (Pi only); validated against `orchestration-judgment-packet.json`, cannot carry routing fields |
| `commit-on-task-done.ts` | Per-task commit for every `done` task (swept after each subagent result by core `processSubagentToolResult`, all hosts) and the closeout commit of `docs/dev/<ID>/` |
| `graph.ts`, `guards.ts`, `interpreter.ts` | Declarative graph + guard registry; reference graph validated in CI |

# Host ports

`host.ts` defines what adapters implement:

- `OrchestrationHost` — `cwd`, `signal`, `notify`, `confirm`, `availableToolNames()` (gather preflight).
- `OrchestrationRuntimeHost` — `notify` + `spawnSubagent({ agent, task })` + optional `runJudgment`.

Implementations: Pi (`packages/pi-accord/src/subagent/runtime-host.ts`), CLI harnesses
(`packages/accord-cli/src/harnesses/as-runtime-host.ts`), MCP (`mcp-orchestrate-host.ts`), and
test fakes. Adapters hold no workflow graph.

# Resume loop

```mermaid
flowchart TD
  R["/dev resume ID"] --> G{"pending decisions<br/>+ impl agent?"}
  G -->|yes, no override| STOP1(["blocked: answer via /dev review"])
  G -->|no| RES["resolve next agent"]
  RES --> CHK{"agent in no_auto_chain_agents<br/>or spawns ≥ max?"}
  CHK -->|yes| STOP2(["return; next /dev resume continues"])
  CHK -->|no| SP["spawn → validate packet → post-result"]
  SP --> ST{"status"}
  ST -->|done| RES
  ST -->|needs_input / stuck| STOP3(["promote to decisions[]"])
  ST -->|blocked| STOP4(["task blocked"])
```

Defaults: stop before `phase-code` (`no_auto_chain_agents: ["phase-code"]`), max 8 spawns per
command. `stuck` is a universal stop — promoted to `decisions[]` and CLI exits with code 2.

# Status routing

Return-packet `status` drives transitions: `done` advances, `needs_input` enters the multi-turn
interview loop (checkpoint + `decisions[]`), `stuck` escalates, `blocked` halts the task. Review
agents use `verdict` (`clean` / `issues`); gated `issues` send work back to the producing agent
until retry caps trip. See [Crucible verification](/architecture/crucible-verification.md).

# Workflow state ownership

Work-item, per-task, and checkpoint JSON under `.tasks/` are **orchestrator-owned**. Agents
return structured data (including `events[]`) in their packet; post-result handlers apply it.
`harness/workflow-state-write-guard.ts` blocks agent writes to those paths unless
`ACCORD_ALLOW_AGENT_WORKFLOW_WRITES=1` (legacy). Task read-modify-write uses `withJsonFileLock`.
