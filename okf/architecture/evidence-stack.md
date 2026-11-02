---
type: Architecture
title: Evidence stack
description: Delivery shape - contract PR, size-bounded task PRs, one commit per phase with loop and round, and a closeout PR - so git history becomes the evidence log.
tags: [stack, pr, commits, evidence, trunk-based, contract, sizing]
status: proposed
generated: { by: agent:pi, at: 2026-10-02T00:00:00Z }
sources:
  - id: compute-stack
    resource: /packages/accord-core/src/stack/compute-stack.ts
    title: computeStack
  - id: stack-provider
    resource: /packages/accord-core/src/stack/provider.ts
    title: StackProvider port
  - id: merge-bottom-up
    resource: /packages/accord-core/src/stack/merge-bottom-up.ts
    title: advanceStack
  - id: plan
    resource: /docs/plans/evidence-stack-plan.md
    title: Evidence stack plan
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (stack)
  - id: policy
    resource: /packages/accord-core/src/orchestration/policy.ts
    title: Policy defaults
  - id: phase-commit
    resource: /packages/accord-core/src/commit/phase-commit.ts
    title: Per-phase orchestrator commit
  - id: evidence-asset
    resource: /packages/accord-core/src/evidence/asset.ts
    title: Evidence asset builder
  - id: contract
    resource: /packages/accord-core/src/contract/
    title: Contract lock, PR0 and contract-amend
  - id: evidence-commit
    resource: /packages/accord-core/src/commit/evidence-commit.ts
    title: Final evidence(task-<N>) commit
  - id: state-snapshot
    resource: /packages/accord-core/src/state/snapshot.ts
    title: Task state snapshot
  - id: state-redact
    resource: /packages/accord-core/src/state/redact.ts
    title: State redaction
  - id: state-restore
    resource: /packages/accord-core/src/state/restore.ts
    title: Resume from committed state
  - id: state-closeout
    resource: /packages/accord-core/src/state/closeout.ts
    title: Closeout marker and state removal
---

**Partly implemented.** `stack.commits: phase` is implemented: the orchestrator makes one typed commit per phase, the commit guard checks it, and `accord evidence` prints the timeline. The final `evidence(task-<N>)` commit writes the evidence asset `docs/dev/<ID>/evidence/task-<N>.{md,json}`. The contract lock (PR0, lock file, tag, lock guard and contract-amend) and the `review-security` gate are also implemented. Tree state is implemented: redacted task state under `docs/dev/<ID>/state/`, resume from a fresh clone, and the closeout marker. PR stack compute is implemented: `computeStack`, the `StackProvider` port with the `gh` provider, and the `dev_stack*` tools and `accord stack`. The other features stay proposed. Without `stack.enabled`, a work item is one branch and one PR with one commit per `done` task ([Orchestration policy](/references/orchestration-policy.md)). Red/green runs and review rounds live in `.tasks/`, not in git. Full plan: [`docs/plans/evidence-stack-plan.md`](../../docs/plans/evidence-stack-plan.md).

# Shape

```
main ─ PR0 Contract ─ PR1 T1 ─ PR2 T2 ─ … ─ PRn Closeout
```

* **PR0 Contract** — `docs/dev/<ID>/{brief,spec,plan}` and `contract.lock.json` (sha256). Docs only. Tagged `accord/<ID>/contract`. Locked: later changes need a `contract-amend` commit (`/dev amend-spec`).
* **Task PRs** — one concern each, leave `main` green, feature unreachable until the last task flips a flag. Independent tasks are siblings.
* **Scope** — `implement` and greenfield work items only. `quick_fix` keeps one branch and one PR (no PR0).
* **Closeout** — `verify.md`, `trace.*`, `workflow-cost.*`.

# Contract PR0 and amendment

* **PR0** — the harness commits `brief.md`, `spec.json`, `plan.json`, `contract.lock.json` and the redacted, transient work-item state file as one docs-only commit (loop `contract`, ref `contract-pr0`, outcome `locked`). It then sets the tag `accord/<ID>/contract` on that commit. Key `stack.contract.tag` turns off the tag. `contract.lock: false` skips PR0 entirely.
* **Lock file** — `contract.lock.json` holds a sha256 for each locked file. The `plan.json` hash is over canonical JSON without `guidance`. The lock covers `brief.md`, `spec.json` and `plan.json`; it does not cover `state/work-item.json`, because closeout deletes that file.
* **Lock guard** — the pre-write hook rejects a change to a locked file unless an amend session is open. The CI check rejects a change to a locked file unless the commit has `outcome=amend`.
* **Amendment** — `/dev amend-spec <ID> <reason>` opens a contract-amend. It needs `stack.enabled` and a present lock. The harness commits the changed contract as one commit (loop `amend`, ref `contract-amend`, `outcome=amend`), writes the lock again, and blocks tasks that the change makes stale. Flags: `--replan` and `--cancel`.

# Commit grammar

The orchestrator is the only committer; agents never commit. Every phase completion is one commit that names its harness ref (`<round>/<actor>`: `T<n>` test, `C<n>` code, `V<n>` verify), including the adversarial reviews: `T1/phase-test` (RED) → `T1/review-test` (findings) → `T2/phase-test` (answers) → `T2/review-test` (clean) → `C1/phase-code` (GREEN) → `C1/review-security` → `C1/review-code` → `C2/phase-code` (answers both) → `C2/review-security` → `C2/review-code` → `V1/phase-verify-task` → `evidence(task-<N>)`. The ref is the join key to the task file `log[]` ([Per-task file](/references/task-file.md)). `review-security` gates on critical and warning findings inside the existing `C` loop; its fix is the next `C` round, re-reviewed by `review-code`. Review and verify commits may touch only `reviews/**` and `docs/dev/<ID>/state/**`, so reviewers cannot alter what they review. Findings are committed before the next phase starts and read back from the tree, so a stateless runner never loses them. `state(task-<N>)` is only for orchestrator-originated changes (unblock, human answer, cap reached). The last commit is `evidence(task-<N>)`: it writes the evidence asset `docs/dev/<ID>/evidence/task-<N>.{md,json}` and removes the state; squash is allowed because the asset survives. Each carries one `Accord:` trailer of `key=value` pairs (loop, round, outcome, finding counts, test counts, tokens, model, cost) for grep and awk reporting: [Commit message format](/references/commit-format.md). Green commits touch no test files (guarded). Evidence commits are append-only. The asset holds red/green excerpts, findings, `review..fix` patches, and planned vs actual size. It survives any merge strategy; rebase or merge also keeps the commits.

# Evidence asset

* **Path** — `docs/dev/<ID>/evidence/task-<N>.{md,json}`, written by the final `evidence(task-<N>)` commit (`evidence/asset.ts`, `commit/evidence-commit.ts`).
* **Squash** — the evidence asset survives squash merge, because it is a file in the final commit. The typed commits do not survive a squash.
* **Refs** — when `stack.enabled`, the asset and `trace.json` use qualified `<ID>/AC-<n>` refs (`trace.json` keeps bare `AC-n` when `stack.enabled` is off).

# State persistence

Default `stack.state.persist: "tree"`: task state is committed under `docs/dev/<ID>/state/task-<N>/` with each typed commit. `STATE.md` is the `renderTaskTrace()` output for the task. `.tasks/` stays the local raw state. Each snapshot is per PR; there is no work-item-wide file.

- **Redaction.** `stack.state.redact` (default `true`) MUST stay `true`: the content enters git history. The snapshot masks secrets. Raw packets are not copied.
- **Size cap.** `stack.state.max_bytes` (default `262144`) limits the bytes of one task snapshot.
- **Fresh clone.** A fresh clone or a CI runner resumes from the branch alone: restore rebuilds `.tasks/` from `docs/dev/<ID>/state/` and the committed artifacts.
- **Removal.** The final `evidence(task-<N>)` commit builds the evidence asset from the state and deletes `state/task-<N>/`. The closeout step builds `trace.*`, `verify.*` and `workflow-cost.*` first, writes the marker `evidence/closeout.json`, and then deletes the rest of `docs/dev/<ID>/state/` in the same commit.
- **Check.** The `accord/evidence` check fails when state files remain after the closeout marker exists.

State and typed commits do not survive a squash merge; the evidence asset and the closeout marker do. Modes `notes` and `none` exist. Long-term, CI starts from a branch that contains only `brief.md` and `spec.json`: it plans, proposes the stack table in PR0, then builds each task PR. See the plan, sections 3.2a and 3.2b.

# Sizing

`computeStack` is pure and deterministic. It reads `max_pr_lines`, `min_pr_lines`, `max_files`, `max_depth` and `merge_small_same_concern`. The `split_on` boundaries (package, concern, refactor, interface) are planned, not yet read; `overrun_factor` is planned for trunk-hardening. **Flag** a task for re-plan on size, file count, package, concern, refactor-vs-behaviour, or interface-vs-consumer; the harness never splits, the plan agent re-plans it as smaller integer-id tasks. **Merge** small same-concern neighbours (`evidence(task-<N>,<M>)`). Tasks are planned independent, so PRs branch from `main`; `max_depth` caps open PRs in a `depends_on` chain. Topological order on `depends_on`. Green-and-unreachable beats the size budget. `N_PRs = 2 + packed task groups`. After GREEN the harness measures actual lines and raises a decision when it exceeds `overrun_factor` × estimate. The human approves the stack table in PR0. Keys: [Stack configuration](/references/stack-config.md).

# Reviewer surface

One generated stack map comment and one generated PR brief per PR. Three lenses: contract, net change, process audit. Findings sit in review commits and the evidence asset, not inline bot comments. One `accord/evidence` status check. Human notifications only at gates.

# Storage and feature knowledge

* **Change record** — `docs/dev/<ID>/` stays: ticket-keyed, immutable after merge (brief, spec, plan, contract lock, `evidence/`, verify, trace).
* **Feature knowledge** — `<knowledge.root>/<slug>.md` (default `docs/features/`) plus generated `index.md` / `index.json`. Feature-keyed, living, updated only by closeout PRs. OKF-style frontmatter with stable feature-scoped `acs`, code and interface `anchors`, `depends_on`, `related`, `supersedes`, and `changes[]` linking work items, PRs, evidence, and contract sha.
* **Cross-referencing** — `spec.json` `features[]` (relation and AC delta). Impact analysis at align/spec (anchor overlap, dependency traversal, index search) lands as an "Impacted features" table in PR0. Each `spec.json` AC may carry an optional `feature` slug; closeout maps `<ID>/AC-<n>` to the feature AC id and the feature doc lists the tests. Outside the spec every AC reference is work-item-qualified (`<ID>/AC-<n>`). Review agents receive impacted features as invariants. `validate:features` and a CI drift check keep docs true. Config: [Knowledge configuration](/references/knowledge-config.md). Plan sections 3.2c and 3.2d.

# Bottom-up merge

`advanceStack` (`stack/merge-bottom-up.ts`) finds open task PRs whose parent PR (from the plan) has merged. It runs `git merge origin/main --no-commit --no-ff` on the child branch, pushes without force, calls `StackProvider.retarget` (`gh pr edit <pr> --base main`) when the base is not already main, then runs `stackSubmit` so freed depth slots open. It never rebases, amends or force-pushes. After a squash-merged base, a conflicted path keeps the child's version only when main's blob equals the parent PR head's blob. Any other conflict aborts the merge and raises a `decisions[]` entry. Known limit: a clean merge that takes main's version of a path the child reverted is not detected.

# Layering

Logic in `accord-core` (`commit/`, `stack/`, `evidence/`). `StackProvider` port (`git`, `gh`, `graphite`, `spr`); only `gh` is implemented; the others are later. `dev_stack`, `dev_stack_sync`, `dev_stack_submit` and `dev_stack_report` (and `accord stack`) are thin adapters over `stack/service.ts` and need `stack.enabled`. `pi-accord`, `accord-cli`, `accord-mcp` are thin adapters ([Monorepo packages](/architecture/monorepo-packages.md)).
