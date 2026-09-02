# File structure

```
packages/                      Bun workspaces — Pi extensions bundled with pi-accord
  accord-core/                 Host-neutral ACCORD harness (orchestration, work-items, schemas)
    src/
      orchestration/           Graph, runner, policy, post-result handlers, plan payload
      work-items/              .tasks/ I/O, lifecycle, rehydrate
      artifacts/               Schema validation, markdown renderers
      briefing/                Agent brief builders
      verification/            Crucible command runner
      subagent/                Preflight + result pipeline (host-neutral)
      harness/                 Hook callables (artifact write, session start, …)
      review/                  Standalone diff review helpers (`accord review`)
      commands/                Intent, dispatch, help
      queries/                 dev_tasks, resume state, dashboard, …
      tools/                   dev_* tool registry
      agents/                  Agent metadata registry
      config/                  AGENTS.md, accord.json, init-detect/write, paths
      telemetry/               Usage accounting
      types/                   HarnessHost, domain enums, spawn contracts
      integrations/            Provider sidecar loader
    schemas/                   Artifact + return-packet JSON schemas and examples
  accord-cli/                  Standalone `accord` CLI
    src/
      main.ts, cli.ts          Entry + argv parser
      context.ts               Dev harness config + mutable harness state
      commands/                tasks, plan, resume, finish, workflow, init, review
      harnesses/               types, registry, spawn-pipeline, exec, as-runtime-host
      index.ts                 Programmatic exports (Pi client, MCP)
    tests/                     CLI smoke + exec harness tests
  pi-accord/                   Pi extension (/dev, hooks, MCP, assets) — npm: pi-accord-harness
    src/
      index.ts                 Harness entry; registers pi-subagent preflight backend
      adapters/pi/             Extension, cli-client, headless-harness, hooks, tools, spawn UI
      adapters/mcp/            Stdio MCP server, mcp-orchestrate-host, register-tools
      integrations/            pi-subagent re-exports
      queries/                 Pi-backed subagent spawn preflight
    assets/                    Skills, agents, providers, lang-profiles, manifest.json
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
docs/*.md                      Project documentation (see accord-cli.md for standalone CLI)
.tasks/                        Runtime work item state (transient)
```

## Navigation guide

- Change `/dev` command routing or intent classification in `packages/accord-core/src/commands/`.
- Change harness orchestration in `packages/accord-core/src/orchestration/` — see [`docs/harness-orchestration.md`](harness-orchestration.md). The core orchestrator owns `/dev` workflow routing by default (`ACCORD_CORE_ORCHESTRATOR=0` only disables programmatic spawns).
- Change Pi-specific command behavior, autocomplete, hook listeners, status, or tool envelope wrapping in `packages/pi-accord/src/adapters/pi/`.
- Change standalone CLI commands and harness registry in `packages/accord-cli/src/`.
- Change work item state and `.tasks/` handling in `packages/accord-core/src/work-items/`.
- Change agent brief construction in `packages/accord-core/src/briefing/`.
- Change verification pressure, command execution, or stale artifact checks in `packages/accord-core/src/verification/`.
- Change subagent prepare/preflight/result handling in `packages/accord-core/src/subagent/`; Pi spawn bridge in `packages/pi-accord/src/adapters/pi/subagent/`.
- Change standalone diff review in `packages/accord-core/src/review/`.
- Add, remove, or rename a `dev_*` tool surface in `packages/accord-core/src/tools/registry.ts` — both Pi and MCP adapters pick it up automatically.
- Change schemas or return packet rules in `packages/accord-core/schemas/` and `packages/accord-core/src/artifacts/validation.ts`.
- Run `bun run accord resume <ID>` or `accord resume <ID>` for headless orchestration without Pi REPL — see [`docs/accord-cli.md`](accord-cli.md).
- Run `npm run check` from the package root after structural changes; it includes `bun test`, schema examples, asset validation, bundle, and runtime smoke checks.

Core modules live in `accord-core` and stay host-neutral; Pi-specific APIs belong under `packages/pi-accord/src/adapters/`.
