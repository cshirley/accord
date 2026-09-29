---
type: Reference
title: ACCORD Overview
description: Agentic Contract for Collaborative Objectives, Requirements, and Rigorous Delivery — a schema-driven, multi-agent delivery harness for Pi, CLI, MCP, and CI.
tags: [accord, overview, harness, pi, crucible]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: readme
    resource: /README.md
    title: Repository README
  - id: workflow
    resource: /docs/accord-workflow.md
    title: ACCORD agentic workflow
  - id: concepts
    resource: /docs/concepts.md
    title: Concepts and architecture
  - id: research
    resource: /docs/accord-research.md
    title: Design rationale and research
---

# Purpose

ACCORD turns a free-text request or ticket into delivered code verified against an explicit,
immutable **contract**. Engineer and LLM agree the work first ("Reach ACCORD before you build"),
persist that agreement as validated artifacts, then autonomous phase agents implement against
it. The adversarial spec/plan-to-test subsystem is **Crucible** — "where intent is
stress-tested into evidence".

> Reach ACCORD. Enter the Crucible. Emerge with Oracles. Verify with Evidence.

# The contract

| Artifact | Produced by | Role |
|----------|-------------|------|
| `brief.md` | `phase-align` | Problem framed in human language |
| `spec.json` | `phase-spec` | Typed acceptance criteria with stable IDs (`AC-1`, …) |
| `plan.json` | `phase-plan` | Tasks mapped to ACs via `covers_ac`, with files + steps |
| `verify.json` | `phase-verify-acceptance` | Per-AC evidence and verdict (`pass` / `gaps`) |

Everything downstream is judged against these files, not conversation history. Human
attention is needed at two synchronous gates — spec/plan approval and PR review — plus batched
answers in the decision queue (`/dev review`). See [Artifacts and state](/references/artifacts-and-state.md).

# Entry points

| Surface | Use | Concept |
|---------|-----|---------|
| Pi `/dev` (alias `/accord`) | Interactive harness in Pi | [/dev command](/references/dev-command.md) |
| `accord` CLI | Headless orchestration, no Pi REPL | [accord CLI](/references/accord-cli.md) |
| `accord-mcp` | `dev_*` tools over stdio MCP (Cursor etc.) | [Tool surface](/architecture/tool-surface.md) |
| Autopipeline | Jira ticket → PR in GitHub Actions | [Adopt autopipeline](/playbooks/adopt-autopipeline.md) |
| `pi-skills` | `/commit`, `/pr`, `/review`, `/verify` without the harness | [Monorepo packages](/architecture/monorepo-packages.md) |

# Principles

From [design research](../docs/accord-research.md): spec quality (P1), structural enforcement
shifted left into hooks and schemas (P2), TDD with adversarial test review (P3), context
engineering via isolated subagents and role-specific briefs (P4), adversarial review with
cited findings (P5), and acceptance verification with evidence (P6).

Key consequences:

- **Deterministic routing** — the core orchestrator, not a model, picks the next agent. See [Orchestration](/architecture/orchestration.md).
- **Isolated context** — every phase/review agent runs in a fresh subprocess. See [Subagent spawning](/architecture/subagent-spawning.md).
- **State on disk** — JSON artifacts and `.tasks/` state make every phase resumable from a cold start.
- **Schema-first** — every artifact and return packet validated. See [Schemas](/references/schemas.md).
