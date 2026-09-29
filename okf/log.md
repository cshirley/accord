# Bundle Update Log

## 2026-09-28

* **Creation**: Established OKF v0.2 bundle at `okf/` with overview, architecture, playbooks, specs, and references sections.
* **Creation**: Concepts synthesised from `README.md`, `AGENTS.md`, `docs/*.md`, `docs/ci/*.md`, package READMEs, and source (`packages/accord-core/src/orchestration/policy.ts`, `config/paths.ts`, `work-items/`, `tools/active-set.ts`, `accord-cli --help`) as of commit `46b8fa3`.
* **Note**: `docs/schemas.md` still references `packages/pi-accord/schemas/`; actual location is `packages/accord-core/schemas/` — bundle uses the correct path.
* **Note**: `docs/accord-cli.md` says `decisions[]` lives in `docs/dev/<ID>/<ID>.json`; source resolves work items at `.tasks/<ID>.json` (`work-items/tasks-dir.ts`) — bundle uses `.tasks/`.
* **Note**: `orchestration.review_loop.max_rgr_respawns` and schema entries for `max_gather_attempts` / `max_unblocks_per_task` / `max_lifetime_retries` in [Orchestration policy](/references/orchestration-policy.md) were taken from uncommitted working-tree changes to `accord-schema.json` / `policy.ts`; confirm once that work lands.
