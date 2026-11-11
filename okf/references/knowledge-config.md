---
type: Reference
title: Knowledge configuration
description: The top-level `knowledge` key in accord.json - feature knowledge layer root, impact analysis, drift check.
tags: [configuration, accord-json, knowledge, features]
status: stable
generated: { by: agent:pi, at: 2026-10-02T00:00:00Z }
sources:
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (knowledge)
  - id: plan
    resource: /docs/plans/evidence-stack-plan.md
    title: Evidence stack plan
---

The harness reads these keys. The layer is off by default. Design: [Evidence stack](/architecture/evidence-stack.md), section "Storage and feature knowledge".

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

# Behaviour

When `enabled` is `true`, the harness keeps living feature docs in `docs/features` (the `root` key). Each doc has anchors, links and test references. `index.md` and `index.json` in that directory are generated.

* **Impact analysis**: at align and spec, the harness lists impacted features and writes them to `features[]` in `spec.json`.
* **Drift check**: a change that touches a feature anchor must update the feature doc, or declare no change. `drift_check` sets the result: `off`, `warn` or `block`. The check runs locally and in CI.
* **Validation**: `bun run validate:features` checks anchors, links, test references, `max_acs_per_feature` and the index.
* **Tools**: `dev_feature_find` searches the index. `dev_feature_impact` lists the features that a set of paths impacts. The `accord feature find` and `accord feature impact` commands call the same code.
