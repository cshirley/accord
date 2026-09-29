# Specs

Implementation and migration plans live in [`docs/plans/`](../../docs/plans/README.md). Per-work-item
contracts produced by ACCORD itself live in `docs/dev/<ID>/` (none committed in this repo yet).

* [Harness orchestration plan](../../docs/plans/harness-orchestration-implementation-plan.md) — Phases 1–7 moving routing into core (shipped; design in [Orchestration](/architecture/orchestration.md)).
* [accord-cli extraction](../../docs/plans/accord-cli-extraction.md) — Split into `accord-core` / `accord-cli` / `pi-accord`.
* [Host-agnostic plan](../../docs/plans/host-agnostic-plan.md) — Pi-optional CLI, MCP, and exec harnesses.
* [Task trace ledger plan](../../docs/plans/task-trace-ledger-plan.md) — Proposed per-task JSON v2: requirement-centric trace, stable finding IDs, round/action timeline.
* [Pi SDK upgrade plan](../../docs/plans/pi-sdk-upgrade-plan.md) — `@earendil-works/*` 0.83.x adoption.
* [Design research](../../docs/accord-research.md) — Principles P1–P6, emergent decisions, cuts, open questions.
