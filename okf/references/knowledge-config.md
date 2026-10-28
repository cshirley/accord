---
type: Reference
title: Knowledge configuration
description: The top-level `knowledge` key in accord.json - feature knowledge layer root, impact analysis, drift check.
tags: [configuration, accord-json, knowledge, features, proposed]
status: proposed
generated: { by: agent:pi, at: 2026-10-02T00:00:00Z }
sources:
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (knowledge)
  - id: plan
    resource: /docs/plans/evidence-stack-plan.md
    title: Evidence stack plan
---

**Proposed.** The key is in the schema, so it validates. The harness does not read it yet. Design: [Evidence stack](/architecture/evidence-stack.md), section "Storage and feature knowledge".

`knowledge` is a top-level key in `accord.json` (global or project `## Dev Harness` block; project overrides global). It is separate from `stack`: feature knowledge is useful without stacked PRs.

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `false` | Turn the feature knowledge layer on |
| `root` | `docs/features` | Directory of feature docs and the generated `index.md` / `index.json` |
| `impact_analysis` | `true` | At align/spec, list impacted features (anchor overlap, dependency traversal, index search) in the contract PR |
| `drift_check` | `warn` | `off`, `warn`, or `block`: a change touching a feature's anchors must update its doc or declare no change |
| `max_acs_per_feature` | `12` | `validate:features` asks for a split above this |

```json
"knowledge": { "enabled": true, "root": "docs/features", "drift_check": "warn" }
```
