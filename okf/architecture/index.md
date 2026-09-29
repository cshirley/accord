# Architecture

* [Monorepo packages](/architecture/monorepo-packages.md) - Bun workspaces, layering (core → CLI → adapters), and which package owns what.
* [Orchestration](/architecture/orchestration.md) - Core orchestrator: deterministic routing, resume loop, post-result handlers, host ports.
* [Subagent spawning](/architecture/subagent-spawning.md) - Isolated child processes, spawn payload, return packets, harness backends.
* [Hooks](/architecture/hooks.md) - Lifecycle hooks: schema validation, config guard, gather/verify preflight, post-code verify, write guard.
* [Agents](/architecture/agents.md) - Phase and review agents, registry, tiers, scope matrix.
* [Providers](/architecture/providers.md) - Tracker and enrichment playbooks + connectivity sidecars used by phase-gather.
* [Crucible verification](/architecture/crucible-verification.md) - Test-first loop, adversarial review, post-code gate, acceptance verification.
* [Tool surface](/architecture/tool-surface.md) - `dev_*` tools, dynamic activation bundles, MCP parity.
