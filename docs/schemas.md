# Schemas

Source of truth for all artifact shapes. Located in `schemas/`.

## Artifact schemas

| Schema | Validates | Canonical field |
|--------|-----------|-----------------|
| `work-item-schema.json` | `.tasks/<ID>.json` | `id` |
| `checkpoint-schema.json` | `.tasks/<ID>-checkpoint.json` | `work_item_id` |
| `task-schema.json` | `.tasks/<ID>-task-N.json` | `work_item_id` + `task_id` |
| `spec-schema.json` | `docs/dev/<ID>/spec.json` | `work_item_id` |
| `plan-schema.json` | `docs/dev/<ID>/plan.json` | `work_item_id` |
| `verify-schema.json` | `docs/dev/<ID>/verify.json` | `work_item_id` |
| `workflow-cost-schema.json` | `docs/dev/<ID>/workflow-cost.json` | `work_item_id` |
| `investigation-schema.json` | `.tasks/<ID>-investigation.json` | `work_item_id` |
| `accord-schema.json` | `## Dev Harness` compatibility config block in AGENTS.md | `schema_version` |
| `orchestration-judgment-packet.json` | Bounded LLM output merged into resume task text (Phase 5); no routing fields | `schema_version` |
| `provider-schema.json` | `assets/providers/{trackers,enrichments}/<name>.json` connectivity sidecars | `name` |
| `model-pricing.json` | Token pricing lookup for cost tracking | — |

## Return schemas

One per agent in `return-schemas/`. Define the JSON packet agents must emit as their last fenced code block.

| Schema | Statuses |
|--------|----------|
| `phase-align.json` | `done`, `needs_input`, `needs_gather`, `stuck` |
| `phase-spec.json` | `done`, `needs_input`, `stuck` |
| `phase-plan.json` | `done`, `needs_input`, `stuck` |
| `phase-code.json` | `done`, `stuck`, `blocked` |
| `phase-test.json` | `done`, `stuck` |
| `phase-gather.json` | `done`, `stuck` |
| `phase-explore.json` | `done`, `stuck` |
| `phase-gaps.json` | `done`, `needs_input`, `stuck` |
| `phase-hypothesise.json` | `done` |
| `phase-verify-acceptance.json` | `done` |
| `phase-verify-infra.json` | `done` |
| `review.json` | `clean`, `issues` (uses `verdict`, not `status`) |

## Validated examples

`schemas/examples/` contains one JSON file per return schema. Each file is an array of example payloads (one per status). These are:

- **Injected** alongside schemas into agent briefs at spawn time by `formatSchemaBrief()`
- **Validated** by `validate-examples.mjs` against their corresponding return schema

```bash
node schemas/examples/validate-examples.mjs
# 23 passed, 0 failed
```

Run after any schema change to catch drift.
