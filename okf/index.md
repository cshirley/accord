---
okf_version: "0.2"
---

# ACCORD

Knowledge bundle for the [ACCORD](https://github.com/cshirley/accord) monorepo — the agentic
delivery harness behind Pi's `/dev` command, the headless `accord` CLI, the `accord-mcp` stdio
server, the GitHub Actions autopipeline, and the companion Pi extensions (`pi-subagent`,
`pi-git`, `pi-thrift`, `pi-integrations`, `pi-skills`).

Concept IDs are bundle-relative paths without `.md` (e.g. `architecture/orchestration`).
Long-form narrative docs still live in [`docs/`](../docs/accord-workflow.md); this bundle is the
routed, agent-oriented entry point and cites those docs and source files in `sources`.

# Overview

* [Overview](overview.md) — What ACCORD is, the contract (brief → spec → plan → verify), and who uses which entry point.

# Architecture

* [architecture/](architecture/index.md) — Package layering, core orchestrator, hooks, subagent spawning, agents, providers, Crucible verification, tool surface.

# Playbooks

* [playbooks/](playbooks/index.md) — Local dev setup, running a work item, answering decisions, unblocking loops, adding agents/providers/languages, adopting the autopipeline.

# Specs

* [specs/](specs/index.md) — Implementation and migration plans (routed to `docs/plans/`).

# References

* [references/](references/index.md) — `/dev` + `accord` commands, Dev Harness config, orchestration policy, env vars, artifacts/state, schemas, patterns.

# Log

* [Bundle update log](log.md)
