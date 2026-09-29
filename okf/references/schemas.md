---
type: Reference
title: Schemas
description: JSON schemas for every persisted artifact and agent return packet, and how they are validated.
tags: [schemas, validation, return-packet]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: schemas-dir
    resource: /packages/accord-core/schemas/
    title: Schema directory
  - id: validation
    resource: /packages/accord-core/src/artifacts/validation.ts
    title: SCHEMA_MAP
  - id: schemas-doc
    resource: /docs/schemas.md
    title: Schemas doc
---

Location: `packages/accord-core/schemas/`.

# Artifact schemas

| Schema | Validates |
|--------|-----------|
| `work-item-schema.json` | `.tasks/<ID>.json` |
| `checkpoint-schema.json` | `.tasks/<ID>-checkpoint.json` |
| `task-schema.json` | `.tasks/<ID>-task-N.json` |
| `investigation-schema.json` | `.tasks/<ID>-investigation.json` |
| `spec-schema.json` | `docs/dev/<ID>/spec.json` |
| `plan-schema.json` | `docs/dev/<ID>/plan.json` |
| `verify-schema.json` | `docs/dev/<ID>/verify.json` |
| `workflow-cost-schema.json` | `docs/dev/<ID>/workflow-cost.json` |
| `accord-schema.json` | `## Dev Harness` block |
| `provider-schema.json` | Provider sidecars |
| `orchestration-judgment-packet.json` | Bounded judgment output |
| `model-pricing.json` | Pricing lookup for cost tracking |

New persisted file types need a `SCHEMA_MAP` entry in `artifacts/validation.ts`.

# Return schemas (`return-schemas/`)

Agents emit a packet as their **last fenced ` ```json ` block**.

| Schema | Statuses |
|--------|----------|
| `phase-align` | `done`, `needs_input`, `needs_gather`, `stuck` |
| `phase-spec`, `phase-plan`, `phase-gaps` | `done`, `needs_input`, `stuck` |
| `phase-code` | `done`, `stuck`, `blocked` |
| `phase-test`, `phase-gather`, `phase-explore`, `phase-verify-task` | `done`, `stuck` |
| `phase-hypothesise`, `phase-verify-acceptance`, `phase-verify-infra` | `done` |
| `review` (all review agents) | `verdict`: `clean`, `issues` |

Every `stuck` shape: `question` + `context`, optional `tried`.

# Examples

`schemas/examples/<agent>.json` — array of payloads, one per status. Injected into agent briefs
alongside the schema and validated by `bun run validate:schemas`. Run after any schema change.
