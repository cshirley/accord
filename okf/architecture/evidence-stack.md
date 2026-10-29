---
type: Architecture
title: Evidence stack
description: Proposed delivery shape - contract PR, size-bounded task PRs, one commit per phase with loop and round, and a closeout PR - so git history becomes the evidence log.
tags: [stack, pr, commits, evidence, trunk-based, contract, sizing]
status: proposed
generated: { by: agent:pi, at: 2026-10-02T00:00:00Z }
sources:
  - id: plan
    resource: /docs/plans/evidence-stack-plan.md
    title: Evidence stack plan
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (stack)
  - id: policy
    resource: /packages/accord-core/src/orchestration/policy.ts
    title: Policy defaults
---

**Proposed, not yet implemented.** Today a work item is one branch and one PR with one commit per `done` task ([Orchestration policy](/references/orchestration-policy.md)). Red/green runs and review rounds live in `.tasks/`, not in git. Full plan: [`docs/plans/evidence-stack-plan.md`](../../docs/plans/evidence-stack-plan.md).

# Shape

```
main ─ PR0 Contract ─ PR1 T1 ─ PR2 T2 ─ … ─ PRn Closeout
```

* **PR0 Contract** — `docs/dev/<ID>/{brief,spec,plan}` and `contract.lock.json` (sha256). Docs only. Tagged `accord/<ID>/contract`. Locked: later changes need a `contract-amend` PR (`/dev amend-spec`).
* **Task PRs** — one concern each, leave `main` green, feature unreachable until the last task flips a flag. Independent tasks are siblings.
* **Scope** — `implement` and greenfield work items only. `quick_fix` keeps one branch and one PR (no PR0).
* **Closeout** — `verify.md`, `trace.*`, `workflow-cost.*`.

# Commit grammar

The orchestrator is the only committer; agents never commit. Every phase completion is one commit that names its harness ref (`<round>/<actor>`: `T<n>` test, `C<n>` code, `V<n>` verify), including the adversarial reviews: `T1/phase-test` (RED) → `T1/review-test` (findings) → `T2/phase-test` (answers) → `T2/review-test` (clean) → `C1/phase-code` (GREEN) → `C1/review-security` → `C1/review-code` → `C2/phase-code` (answers both) → `C2/review-security` → `C2/review-code` → `V1/phase-verify-task` → `evidence(task-<N>)`. The ref is the join key to the task file `log[]` ([Per-task file](/references/task-file.md)). `review-security` gates on critical and warning findings inside the existing `C` loop; its fix is the next `C` round, re-reviewed by `review-code`. Review and verify commits may touch only `reviews/**` and `docs/dev/<ID>/state/**`, so reviewers cannot alter what they review. Findings are committed before the next phase starts and read back from the tree, so a stateless runner never loses them. `state(task-<N>)` is only for orchestrator-originated changes (unblock, human answer, cap reached). The last commit is `evidence(task-<N>)`: it writes the evidence asset `docs/dev/<ID>/evidence/task-<N>.{md,json}` and removes the state; squash is allowed because the asset survives. Each carries one `Accord:` trailer of `key=value` pairs (loop, round, outcome, finding counts, test counts, tokens, model, cost) for grep and awk reporting: [Commit message format](/references/commit-format.md). Green commits touch no test files (guarded). Evidence commits are append-only. The last commit of every task PR is `evidence(task-<N>)`: it writes the evidence asset `docs/dev/<ID>/evidence/task-<N>.{md,json}` (red/green excerpts, findings, `review..fix` patches, planned vs actual size). The asset survives any merge strategy, so squash is allowed; rebase or merge also keeps the commits.

# State persistence

Default `stack.state.persist: "tree"`: task state (`STATE.md` is the existing `accord trace` rendering of the task file; `.tasks/` stays the local raw state) is committed under `docs/dev/<ID>/state/task-<N>/` with each typed commit (redacted, per-PR, no work-item-wide file). The final `evidence(task-<N>)` commit builds the evidence asset from it and deletes the directory; closeout deletes the rest of `docs/dev/<ID>/state/`. What survives which merge strategy: plan section 3.2a. A fresh clone or CI runner resumes from the branch alone. Long-term, CI starts from a branch that contains only `brief.md` and `spec.json`: it plans, proposes the stack table in PR0, then builds each task PR. Modes `notes` and `none` exist. See the plan, sections 3.2a and 3.2b.

# Sizing

`computeStack(plan, config)` is pure and deterministic. **Flag** a task for re-plan on size, file count, package, concern, refactor-vs-behaviour, or interface-vs-consumer; the harness never splits, the plan agent re-plans it as smaller integer-id tasks. **Merge** small same-concern neighbours (`evidence(task-<N>,<M>)`). Tasks are planned independent, so PRs branch from `main`; `max_depth` caps open PRs in a `depends_on` chain. Topological order on `depends_on`. Green-and-unreachable beats the size budget. `N_PRs = 2 + packed task groups`. After GREEN the harness measures actual lines and raises a decision when it exceeds `overrun_factor` × estimate. The human approves the stack table in PR0. Keys: [Stack configuration](/references/stack-config.md).

# Reviewer surface

One generated stack map comment and one generated PR brief per PR. Three lenses: contract, net change, process audit. Findings sit in review commits and the evidence asset, not inline bot comments. One `accord/evidence` status check. Human notifications only at gates.

# Storage and feature knowledge

* **Change record** — `docs/dev/<ID>/` stays: ticket-keyed, immutable after merge (brief, spec, plan, contract lock, `evidence/`, verify, trace).
* **Feature knowledge** — `<knowledge.root>/<slug>.md` (default `docs/features/`) plus generated `index.md` / `index.json`. Feature-keyed, living, updated only by closeout PRs. OKF-style frontmatter with stable feature-scoped `acs`, code and interface `anchors`, `depends_on`, `related`, `supersedes`, and `changes[]` linking work items, PRs, evidence, and contract sha.
* **Cross-referencing** — `spec.json` `features[]` (relation and AC delta). Impact analysis at align/spec (anchor overlap, dependency traversal, index search) lands as an "Impacted features" table in PR0. Review agents receive impacted features as invariants. `validate:features` and a CI drift check keep docs true. Config: [Knowledge configuration](/references/knowledge-config.md). Plan sections 3.2c and 3.2d.

# Layering

Logic in `accord-core` (`commit/`, `stack/`, `evidence/`). `StackProvider` port (`git`, `gh`, `graphite`, `spr`); only `gh` is planned first. `pi-accord`, `accord-cli`, `accord-mcp` are thin adapters ([Monorepo packages](/architecture/monorepo-packages.md)).
