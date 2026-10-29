# References

* [/dev command](/references/dev-command.md) - Pi `/dev` subcommands and routing (local vs core orchestrator).
* [accord CLI](/references/accord-cli.md) - Headless `accord` commands, flags, exit behaviour.
* [Dev Harness config](/references/dev-harness-config.md) - `## Dev Harness` block in AGENTS.md, `accord.json`, supported stacks.
* [Orchestration policy](/references/orchestration-policy.md) - `orchestration.*` keys: review loops, quick-fix loop, resume chaining, auto-commit, judgment.
* [Stack configuration](/references/stack-config.md) - Proposed top-level `stack` key in accord.json: sizing budgets, provider, commit granularity, contract lock.
* [Knowledge configuration](/references/knowledge-config.md) - Proposed top-level `knowledge` key in accord.json: feature knowledge root, impact analysis, drift check.
* [Commit message format](/references/commit-format.md) - Proposed `Accord:` trailer (key=value) on every orchestrator commit: loop, round, findings, tests, tokens, cost.
* [Environment variables](/references/environment-variables.md) - `ACCORD_*` / `PI_*` env switches.
* [Per-task file (v2)](/references/task-file.md) - `.tasks/<ID>-task-N.json`: summary, loop control, requirement → findings trace, round log, recovery, unblock.
* [Artifacts and state](/references/artifacts-and-state.md) - `docs/dev/<ID>/`, `.tasks/`, work-item ID format, `decisions[]`.
* [Schemas](/references/schemas.md) - Artifact and return-packet JSON schemas.
* [Patterns](/references/patterns.md) - Intent patterns/variants and their phase sequences.
