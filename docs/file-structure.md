# File structure

```
packages/                      Bun workspaces — Pi extensions bundled with pi-accord
  pi-accord/                   ACCORD harness (/dev, tools, hooks, orchestration, MCP)
    src/
      index.ts                 Harness entry; delegates to adapters/pi/extension.ts
      core/                    Host-neutral ACCORD logic (orchestration, work-items, …)
      adapters/pi/             Pi extension registration, hooks, tools, spawn UI
      adapters/mcp/            Stdio MCP server (same dev_* tools as Pi)
      integrations/            Provider sidecar loader + pi-subagent re-exports
    assets/                    Skills, agents, providers, lang-profiles, manifest.json
    schemas/                   Artifact + return-packet JSON schemas and examples
    scripts/                   install-assets, validate-assets, runtime-smoke
    tests/                     Bun unit tests for the harness
  pi-subagent/src/             subagent tool + agent discovery
  pi-worktree/src/             wt_* tools, /wt command
  pi-thrift/src/               /thrift (alias /tp) input + output token pruning
  pi-git-tools/src/            git_commit_*, gh_pr_* tools
  pi-tools/src/                Jira / Slack / Google Workspace integrations
  pi-accord-ci/                GitHub Actions autopipeline scripts + contract tests

scripts/install-dev.sh         pi install + install:assets (`install:dev`)

docs/dev/<ID>/                 Committed work artifacts (brief, spec, plan, verify, …)
docs/*.md                      Project documentation
.tasks/                        Runtime work item state (transient)
```

## Navigation guide

- Change `/dev` command routing or intent classification in `packages/pi-accord/src/core/commands/`.
- Change harness orchestration (`packages/pi-accord/src/core/orchestration/`) — see [`docs/harness-orchestration.md`](harness-orchestration.md) and [`docs/harness-orchestration-implementation-plan.md`](harness-orchestration-implementation-plan.md). The core orchestrator owns `/dev` workflow routing by default (`ACCORD_CORE_ORCHESTRATOR` off only disables programmatic spawns).
- Change Pi-specific command behavior, autocomplete, hook listeners, status, or tool envelope wrapping in `packages/pi-accord/src/adapters/pi/`.
- Change work item state and `.tasks/` handling in `packages/pi-accord/src/core/work-items/`.
- Change agent brief construction in `packages/pi-accord/src/core/briefing/`.
- Change verification pressure, command execution, or stale artifact checks in `packages/pi-accord/src/core/verification/`.
- Change subagent prepare/preflight/result handling in `packages/pi-accord/src/core/subagent/`; other shared hooks stay in `packages/pi-accord/src/core/harness/` (re-exports subagent for compatibility).
- Change Pi programmatic spawn UI in `packages/pi-accord/src/adapters/pi/subagent/`; hook wiring stays in `packages/pi-accord/src/adapters/pi/pi-hook-listeners.ts`.
- Add, remove, or rename a `dev_*` tool surface in `packages/pi-accord/src/core/tools/registry.ts` — both Pi and MCP adapters pick it up automatically.
- Change schemas or return packet rules in `packages/pi-accord/schemas/` and `packages/pi-accord/src/core/artifacts/validation.ts`.
- Run `npm run check` from the package root after structural changes; it includes `bun test`, schema examples, asset validation, bundle, and runtime smoke checks.

Core modules should stay host-neutral; Pi, Claude Code, Codex, or Copilot-specific APIs belong under `packages/pi-accord/src/adapters/`.
