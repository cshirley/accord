# Concepts and architecture

## Naming

ACCORD is intended to help an engineer and an LLM reach a shared agreement on what needs to be built, then turn that agreement into verifiable artifacts that implementation and review agents can use.

> **ACCORD**: **Agentic Contract for Collaborative Objectives, Requirements, and Rigorous Delivery**
> *Reach ACCORD before you build.*

The adversarial spec/plan-to-test subsystem is named:

> **Crucible**
> *Where intent is stress-tested into evidence.*

Suggested product-language flow:

> **Reach ACCORD. Enter the Crucible. Emerge with Oracles. Verify with Evidence.**

## Architecture

The codebase is organized around harness concepts first, then host integration:

- **Core** (`packages/accord-core/src/`) contains host-neutral harness logic: work items, artifacts, config, queries, agent roles, briefing, telemetry, Crucible verification, and orchestration.
- **Standalone CLI** (`packages/accord-cli/`) runs the same orchestration loop headlessly via `accord` — see [`docs/accord-cli.md`](accord-cli.md).
- **ACCORD** is represented by the work item lifecycle, spec/plan artifacts, decisions, deviations, and intent contract helpers.
- **Briefing** (`packages/accord-core/src/briefing/`) is the context router that packages ACCORD artifacts into role-specific agent briefs.
- **Crucible** (`packages/accord-core/src/verification/`) owns verification pressure: command execution, formatted results, and stale-artifact checks.
- **Harness** (`packages/accord-core/src/harness/`) holds host-neutral hook logic (artifact validation, subagent prep/results, gather/verify preflight, orchestrator usage, session cost seeding). Pi maps lifecycle events to these callables; Cursor hook scripts can import the same module.
- **Adapters** (`packages/pi-accord/src/adapters/`) contain host-specific glue: Pi (`packages/pi-accord/src/adapters/pi/`) and a stdio MCP server (`packages/pi-accord/src/adapters/mcp/`) that exposes the same `dev_*` tools.

See [`docs/pipeline.md`](pipeline.md) for the runtime command flow and pattern-by-pattern execution diagrams, and [`docs/file-structure.md`](file-structure.md) for the full directory tree. For the **target** harness-owned orchestration design (state machine in core, thin Pi adapter), see [`docs/harness-orchestration.md`](harness-orchestration.md). For the **implementation plan** (phased delivery), see [`docs/plans/harness-orchestration-implementation-plan.md`](plans/harness-orchestration-implementation-plan.md). For making CLI, MCP, and agent runtimes **Pi-optional**, see [`docs/plans/host-agnostic-plan.md`](plans/host-agnostic-plan.md).
