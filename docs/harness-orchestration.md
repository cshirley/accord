# Harness orchestration (design)

This document captures the **target architecture** for ACCORD workflow control: deterministic routing, an in-code workflow graph, validation boundaries, and the shrinking role of the Pi adapter. It reflects design decisions agreed in harness planning (not necessarily the full current implementation).

For today's runtime behaviour and diagrams, see [`pipeline.md`](pipeline.md). For directory layout, see [`file-structure.md`](file-structure.md).

---

## Problem statement

Today much of the **orchestration playbook** lives in the bundled **accord skill** (`assets/skills/accord/SKILL.md`). The main-session model is instructed to parse `/dev` subcommands, classify free text, and call the `subagent` tool with explicit `agent` names.

That couples **infrastructure** (which isolated phase agent runs next) to **model behaviour**. When the host or provider changes (e.g. Anthropic ↔ Cursor), the model may mis-route, omit agents, or diverge from the playbook — even though subagents are a **harness concern**, not a provider capability the model must know about.

**Goal:** Move **routing and the outer execution loop** into **`src/core/`**, keep the graph as **maintainable in-code configuration**, and leave **`src/adapters/pi`** as a **thin Pi façade** (commands, hooks, tools, UI — no workflow graph).

---

## Design pillars

### 1. Deterministic dispatch (closed world)

Replace open-ended “orchestrator picks `subagent({ agent })`” with harness-owned decisions:

- **Inputs:** work item state, checkpoints, pattern/variant, validated return packets from the previous step, and the parsed `/dev` invocation.
- **Outputs:** the **next** allowed action: spawn a specific registered agent, run internal `dev_*` steps only, stop for user input, or optionally invoke a **narrow** judgment step with a **fixed output schema**.

Agent identifiers come from the existing **agent registry** (`src/core/agents/registry.ts`) and schemas — not from free-form model choice.

### 2. Harness-owned outer loop (state machine)

A **core interpreter** walks the workflow until a terminal pause:

- **Spawn** phase/review agents via a **host port** (Pi implements `spawnSubagent`; tests use a fake).
- **Chain** deterministic steps (e.g. tool-only finish steps, gated verify) without involving the main-session model.
- **Pause** at explicit `needs_user` / checkpoint boundaries (same semantics as today's multi-turn phases).

Hooks (gather/verify preflight, artifact validation, post-code verification) remain **cross-cutting** and stay host-neutral under `src/core/harness/`; they do not encode the full **phase graph**.

### 3. LLM judgment without LLM routing

Fuzzy decisions (e.g. how to phrase adversary feedback for the next test pass) can still use an LLM **only where useful**, without giving it the **catalog of subagents** or the right to invent transitions:

- **Routing:** deterministic policy from structured fields (`verdict`, severities, retry counters).
- **Judgment (optional, Phase 5):** a bounded `completeSimple` completion on Pi (`runJudgment` on the runtime host) produces **schema-validated** brief fragments (`schemas/orchestration-judgment-packet.json`); the harness **stitches** them into the next outbound task, or a **template** appendix when JSON is invalid — **no** model choice of `agent`.

Example: `review-test` → parse packet → policy says “respawn `phase-test` if critical and retries remain” → optional LLM composes “address these findings” text → harness builds the next `phase-test` task string and spawns — **no** model choice of `agent`.

---

## Graph and state machine (in-code configuration)

Represent the workflow as **data + a small interpreter**, not a giant central `switch`:

- **Declarative graph:** nodes (steps), edges keyed by **events** or **named guards** (e.g. `SubagentCompleted`, `CheckpointCleared`), metadata such as `agentId`, outbound brief builder id, and policy keys (retry caps).
- **Named guard registry:** pure predicates `(context) => ...` referenced by name from the graph so the config stays readable and diff-friendly.
- **Startup validation:** graph is checked once (reachable nodes, no orphan handlers, every `agentId` exists in the registry, every transition has a handler).

Use TypeScript **`as const` + `satisfies`** (or equivalent) so edits stay **type-safe** at compile time where possible.

Suggested layout (implementation target; **D1** = hand-rolled in this tree, no external FSM package):

```
src/core/orchestration/        (or similarly named)
  graph.ts                     Declarative nodes/edges + types
  guards.ts                    Named predicates
  interpreter.ts               Walk graph, produce NextStep / StopReason
  runner.ts                    Outer loop: plan resume → NextStep → runUntilStop (tests / future hosts)
  policy.ts                    Caps + severity gates (Phase 3 expands)
  host.ts                      OrchestrationHost port types
```

---

## Validation boundaries (orchestrator vs components)

| Layer | Owner | Responsibility |
|--------|--------|------------------|
| **Orchestrator (boundary)** | Core runner / FSM driver | **Wire + routing validity:** allowed transition from current state; inbound/outbound payloads match the **contract** for this step (e.g. JSON Schema return packets); ordering and gates (e.g. verify preflight already enforced by hooks); single writer of canonical phase / work item transitions. |
| **Components** | Phase agents, command handlers, briefing helpers | **Domain validity:** semantic checks on specs, plans, tests, AC coverage, etc.; structured `issues` / `verdict` the orchestrator routes on using **enums and policy**, not by re-judging domain content. |

**Flow pattern:** validate (boundary) → route → delegate → component validates deeply → orchestrator validates **response shape** again → apply transition / enqueue next.

---

## Architectural patterns (summary)

- **Declarative graph + interpreter** — editable workflow; small runtime; graph validated at startup.
- **Command / step per tick** — each orchestration step: build payload → boundary validate → execute (via host or internal tools) → validate result → mutate state.
- **Policy vs mechanism** — graph structure + **policy module** (thresholds, severity routing, max respawns); **registry** for agents and schemas.
- **Ports and adapters** — `OrchestrationHost` in core (`spawnSubagent`, `notify`, `confirm`, optional `runJudgment`); Pi/MCP implement ports without owning the graph.
- **MCP / `dev_orchestrate`** — headless clients get the same `resolution` + `next_steps` as the Pi tool; `programmatic_spawn_supported` stays false on stdio. When resume judgment is configured in Dev Harness, the payload adds `judgment_configured_for_spawn` and `spawn_task_after_template_judgment` (template-only merge — parity with Pi when the judgment LLM is off or fails).
- **Explicit FSM events** — transitions driven by validated events (e.g. completed subagent + parsed packet), not loose prose.
- **Single transition writer** — only the orchestrator (or a dedicated applier it calls) advances canonical work item state after successful validation.

---

## Implementation roadmap

The executable phased plan (spikes, deliverables per phase, acceptance criteria, feature flags, MCP options, architecture decisions **D1–D3**) lives in [`harness-orchestration-implementation-plan.md`](harness-orchestration-implementation-plan.md). The high-level sequence is: spikes → core skeleton → `resume` pilot → deterministic subgraphs → full subcommand coverage → optional judgment hook → MCP contract → cleanup.

---

## Role of `src/adapters/pi` (before vs after)

### Before (current direction)

- Registers `/dev` / `/accord`, tools, hooks, autocomplete, status bar.
- Handles a **subset** of subcommands locally; on **free-text** `/dev` input the extension runs the same deterministic **`dev_intent`** rules in core (`classifyPreflight`, optional ticket **`dev_bootstrap`**) and then forwards to `/skill:accord`. **`resume` / `finish`** can be handled by the core orchestrator when `ACCORD_CORE_ORCHESTRATOR=1` (see the implementation plan).
- Maps Pi lifecycle events to **`src/core/harness/`** (preflight, validation, usage, subagent prep/results).

### After (target)

- **Unchanged:** registration surfaces and Pi event → core harness mapping.
- **Shrinks:** **no** phase graph in the adapter; **no** “launch skill to orchestrate” for flows owned by core.
- **Grows slightly in one place:** explicit **implementation of `OrchestrationHost.spawnSubagent`** (and related UI), so the core runner can drive subagents without the main model choosing agent names.

**One-line summary:** `adapters/pi` remains **“ACCORD on Pi”** — wiring and host I/O only; **orchestration is a core product**.

---

## Success criteria

- Workflow graph and transition policy live in **`src/core/`**, validated by tests.
- `assets/skills/accord/SKILL.md` no longer contradicts core (ideally minimal orchestration prose).
- `src/adapters/pi/extension.ts` stays a thin: **parse → core runner → map outcome to Pi UI / host calls**.
- Cross-provider behaviour depends on **code + schemas**, not on whether the chat model recalled the playbook.
- **`/dev retro`** keeps correlating Pi insights sessions with harness work via the `dev-harness-run` transcript marker (regression: `tests/dev-retro-harness-marker.test.ts`).

---

## Related documentation

- [`harness-orchestration-implementation-plan.md`](harness-orchestration-implementation-plan.md) — phased implementation plan, spikes, acceptance criteria.
- [`concepts.md`](concepts.md) — core vs adapters overview.
- [`pipeline.md`](pipeline.md) — current command and phase flow diagrams.
- [`file-structure.md`](file-structure.md) — where code lives today and navigation hints.
- [`hooks-and-tools.md`](hooks-and-tools.md) — hook and tool surfaces.
