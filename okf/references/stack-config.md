---
type: Reference
title: Stack configuration
description: The top-level `stack` key in accord.json - evidence stack switches, sizing budgets, contract lock.
tags: [configuration, accord-json, stack, sizing, proposed]
status: proposed
generated: { by: agent:pi, at: 2026-10-02T00:00:00Z }
sources:
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (stack)
  - id: plan
    resource: /docs/plans/evidence-stack-plan.md
    title: Evidence stack plan
  - id: config-doc
    resource: /docs/configuration.md
    title: Project configuration
---

**Proposed.** The key is in the schema, so it validates. The harness does not read it yet. Applies to `implement` and greenfield work items, not `quick_fix`. Design: [Evidence stack](/architecture/evidence-stack.md).

`stack` is a top-level key in `accord.json`: the global file (`~/.config/accord/accord.json`) or the project `## Dev Harness` block. Project overrides global ([Dev Harness configuration](/references/dev-harness-config.md)).

| Key | Default | Meaning |
|-----|---------|---------|
| `enabled` | `false` | Turn the evidence stack on. Off = one branch, one PR |
| `provider` | `gh` | `git`, `gh`, `graphite`, or `spr`: branch, restack, retarget, submit. Only `gh` is implemented first |
| `commits` | `task` | `task` = one commit per done task. `phase` = (format: [Commit message format](/references/commit-format.md)) one orchestrator-made commit per phase completion (phase-test, review-test, phase-code, review-code, review-security, phase-verify-task) with loop and round trailers, plus `state` and the final `evidence` |
| `merge_strategy` | `rebase` | `rebase`, `merge`, or `squash`. Squash is safe when `evidence.asset` is `true` (the asset keeps the evidence) |
| `evidence.asset` | `true` | Final commit of each task PR (`evidence(task-<N>)`) writes `docs/dev/<ID>/evidence/task-<N>.{md,json}` |
| `state.persist` | `tree` | `tree` = commit task state under `state.path` per typed commit; the final `evidence(task-<N>)` commit deletes it. `notes` = git notes under `refs/notes/accord/<ID>`. `none` = local `.tasks/` only |
| `state.path` | `docs/dev/{id}/state` | Directory template for committed state (`<path>/task-<N>/`). Visible beside the other artifacts; must not be gitignored. Deleted at `evidence(task-<N>)` and closeout |
| `state.redact` | `true` | Redact secrets and raw packets before commit. Keep `true`: content enters git history |
| `state.max_bytes` | `262144` | Max bytes of state per task snapshot |
| `evidence.include_diffs` | `true` | Include `review..fix` patches and red/green output excerpts in the asset |
| `sizing.max_pr_lines` | `400` | Changed lines per PR, excluding tests, generated files, lockfiles |
| `sizing.min_pr_lines` | `30` | Below this a task merges into a same-concern neighbour (not refactor, schema, flag) |
| `sizing.max_files` | `10` | Files per PR |
| `sizing.max_depth` | `6` | Max *open* PRs in a `depends_on` chain; the next opens after a base merges. Chains that cannot fit split into milestone work items |
| `sizing.overrun_factor` | `1.5` | Actual/estimate ratio that raises a re-plan-or-accept decision |
| `sizing.split_on` | all | Boundaries that flag a task for re-plan (never an automatic split). Any of `package`, `concern`, `refactor`, `interface` |
| `sizing.merge_small_same_concern` | `true` | Merge adjacent same-concern tasks that fit the budget |
| `contract.lock` | `true` | Write `contract.lock.json`; guard locked files |
| `contract.tag` | `true` | Tag the contract commit `accord/<ID>/contract` |
| `require_flag` | `true` | Non-final tasks leave the feature unreachable; the last task enables it |

```json
"stack": {
  "enabled": true,
  "provider": "gh",
  "commits": "phase",
  "evidence": { "asset": true },
  "state": { "persist": "tree" },
  "sizing": { "max_pr_lines": 400, "max_depth": 6 }
}
```

# Related: security gate (proposed)

`review-security` gates in this process: critical and warning ("major") findings must be fixed in code. It gates inside the existing `C` loop (`phase-code`, then `review-security`, then `review-code`); the fix is the next `C` round, re-reviewed by `review-code`, and uses the `code_review` retry counter. `suggestion` stays advisory. New key `orchestration.review_loop.review_security.severity_gate` (`advisory`, `block`, `warn`, `none`). Schema default is `advisory` (today's behaviour); with `stack.enabled: true` the effective default is `warn`. See the plan, section 5a.

```json
"orchestration": { "review_loop": { "review_security": { "severity_gate": "warn" } } }
```
