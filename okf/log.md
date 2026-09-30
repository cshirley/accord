# Bundle Update Log

## 2026-09-30

* **Update**: `answer` / `dev_answer` (`packages/accord-core/src/queries/answer-decision.ts`) resolve pending `decisions[]` entries by id (all-or-nothing, locked atomic write, `--force` to overwrite); no answers lists pending ones. Wired as `accord answer`, `/dev answer`, and the `dev_answer` tool (bundles `code` + `meta`). Replaces the hand-edit-the-JSON guidance in the pending-decisions gate, stuck/needs_input handoffs, dashboard, and CLI stuck messages. `work-item-schema.json` decision items now allow `resolved_at` (previously documented in the playbook but rejected by `additionalProperties: false`). [Answer pending decisions](/playbooks/answer-decisions.md) rewritten (it also wrongly said `/dev review` answers decisions; it only lists the queue); [/dev command](/references/dev-command.md), [accord CLI](/references/accord-cli.md), [Tool surface](/architecture/tool-surface.md) updated.

## 2026-09-29

* **Creation**: [Per-task file (v2)](/references/task-file.md) — requirement-centric task file (summary, control, requirements → findings → history, round log), sidecars, recovery, per-blocker unblock.
* **Update**: [Crucible verification](/architecture/crucible-verification.md) — rounds per loop, verify loop after review-code, advisory review-security, findings by id. [Orchestration policy](/references/orchestration-policy.md) — `verify_loop`, findings/counters location, commit log entry. [Unblock a task](/playbooks/unblock-a-task.md) rewritten for per-blocker decisions. [Artifacts and state](/references/artifacts-and-state.md), [/dev command](/references/dev-command.md), [accord CLI](/references/accord-cli.md), [Tool surface](/architecture/tool-surface.md) (`dev_trace`, `dev_unblock`), [Agents](/architecture/agents.md) aligned.
* **Creation**: [Specs](/specs/index.md) links the proposed [task trace ledger plan](../docs/plans/task-trace-ledger-plan.md) (per-task JSON v2).
* **Resolved**: Loop-cap config (`max_rgr_respawns`, `max_gather_attempts`, `max_unblocks_per_task`, `max_lifetime_retries`) landed in commit `129976d`; [Orchestration policy](/references/orchestration-policy.md) now matches committed source.
* **Update**: `AGENTS.md` slimmed to always-loaded rules + OKF routing; detail previously duplicated there now lives only in this bundle. Concepts that cited `/AGENTS.md` ([Monorepo packages](/architecture/monorepo-packages.md), [Agents](/architecture/agents.md), [Add an agent](/playbooks/add-an-agent.md)) re-pointed at primary sources; [Verify a change](/playbooks/verify-a-change.md) keeps it only for the `## Dev Harness` block.
* **Update**: [Overview](/overview.md) gains the "not a standalone workflow engine" principle (moved from `AGENTS.md`).
* **Tooling**: `bun run validate:okf` (`scripts/validate-okf.ts`, part of `bun run check`) enforces frontmatter, `sources` paths, links, and index reachability.

## 2026-09-28

* **Creation**: Established OKF v0.2 bundle at `okf/` with overview, architecture, playbooks, specs, and references sections.
* **Creation**: Concepts synthesised from `README.md`, `AGENTS.md`, `docs/*.md`, `docs/ci/*.md`, package READMEs, and source (`packages/accord-core/src/orchestration/policy.ts`, `config/paths.ts`, `work-items/`, `tools/active-set.ts`, `accord-cli --help`) as of commit `46b8fa3`.
* **Note**: `docs/schemas.md` still references `packages/pi-accord/schemas/`; actual location is `packages/accord-core/schemas/` — bundle uses the correct path.
* **Note**: `docs/accord-cli.md` says `decisions[]` lives in `docs/dev/<ID>/<ID>.json`; source resolves work items at `.tasks/<ID>.json` (`work-items/tasks-dir.ts`) — bundle uses `.tasks/`.
* **Note**: `orchestration.review_loop.max_rgr_respawns` and schema entries for `max_gather_attempts` / `max_unblocks_per_task` / `max_lifetime_retries` in [Orchestration policy](/references/orchestration-policy.md) were taken from uncommitted working-tree changes to `accord-schema.json` / `policy.ts`; confirm once that work lands.
