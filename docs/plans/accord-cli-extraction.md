# ACCORD CLI extraction (complete)

Standalone orchestrator CLI (`packages/accord-cli`) on host-neutral `@clive.shirley/accord-core`. Pi extension and MCP are thin clients.

**User guide:** [`accord-cli.md`](../accord-cli.md) — commands, flags, env vars, harness config.

**Next:** [`host-agnostic-plan.md`](host-agnostic-plan.md) — remaining work to make CLI, MCP, and agent runtimes Pi-optional.

## Target package layout

```
packages/
  accord-core/          # Host-neutral harness (orchestration, artifacts, schemas, review helpers)
  accord-cli/           # `accord` bin, harness registry, CLI commands
  pi-accord/            # Pi extension (adapters/pi, assets, MCP) — npm: @clive.shirley/pi-accord
  pi-subagent/          # Pi subagent backend (one AgentHarness implementation)
  pi-git-tools/         # Optional Pi companion
  pi-tools/             # Optional Pi companion
  pi-worktree/          # Optional Pi companion
  pi-thrift/            # Optional Pi companion
```

Published names:

| Package | npm name | Role |
|---------|----------|------|
| `accord-core` | `@clive.shirley/accord-core` | Orchestration, artifacts, briefing, verification, schemas, standalone review helpers |
| `accord-cli` | `@clive.shirley/accord-cli` | `accord` bin, harness registry, programmatic API |
| `pi-accord` | `@clive.shirley/pi-accord` | Pi `/dev` extension, bundled assets, MCP adapter |

---

## Phase 1 — CLI skeleton ✅

| File | Purpose |
|------|---------|
| `packages/accord-cli/package.json` | `bin: accord` |
| `packages/accord-cli/src/main.ts` | Entry |
| `packages/accord-cli/src/cli.ts` | Arg parser |
| `packages/accord-cli/src/context.ts` | `loadDevHarnessConfig` + harness state |
| `packages/accord-cli/src/harnesses/types.ts` | `AgentHarness` port |
| `packages/accord-cli/src/harnesses/registry.ts` | Lazy `pi` harness + `exec` backend |
| `packages/accord-cli/src/commands/*.ts` | `resume`, `finish`, `plan`, `tasks`, workflow, `init`, `review` |

---

## Phase 2 — Extract `@accord/core` ✅

Host-neutral tree: `pi-accord/src/core/` → `accord-core/src/`. Schemas: `accord-core/schemas/`.

### De-Pi split (Pi-only stays in `pi-accord`)

| Path | Reason |
|------|--------|
| `adapters/pi/subagent/spawn-bridge.ts` | pi-subagent programmatic API |
| `adapters/pi/headless-harness.ts` | Headless Pi harness for standalone CLI |
| `integrations/pi-subagent.ts` | Re-exports pi-subagent |
| `queries/subagent-preflight.ts` | Credential/agent-file checks via pi-subagent |
| `adapters/pi/extension.ts`, hooks, TUI, MCP | Pi host surface |

### Path resolution

| Constant | Points to |
|----------|-----------|
| `CORE_DIR` | `packages/accord-core` (schemas) |
| `ASSETS_DIR` | `packages/accord-assets` (agents, providers, lang-profiles) |
| `PI_PKG_DIR` | `packages/pi-accord` (skills, ci templates) |

Override: `ACCORD_ASSETS_DIR` (alias: deprecated `ACCORD_HARNESS_PKG_DIR`), `ACCORD_PI_PKG_DIR`.

---

## Phase 3 — Exec harness ✅

`packages/accord-cli/src/harnesses/exec.ts` + `harness.exec` in Dev Harness JSON / `accord-schema.json`.

Shared pre/post: `packages/accord-cli/src/harnesses/spawn-pipeline.ts`.

---

## Phase 4 — Pi extension as client ✅

`packages/pi-accord/src/adapters/pi/cli-client.ts` — in-process `@clive.shirley/accord-cli` or subprocess (`ACCORD_CLI_DELEGATE=subprocess`).

`pi-extension-harness.ts` wraps `createResumeOrchestrationRuntimeHost` for full TUI.

---

## Phase 5 — MCP spawn delegation ✅

`packages/pi-accord/src/adapters/mcp/mcp-orchestrate-host.ts` — `ACCORD_MCP_HARNESS=pi|exec`, enriched `dev_orchestrate` payload, optional execution.

---

## CLI command roadmap ✅

| Command | Core entry |
|---------|------------|
| `accord tasks` | `devTasks()` |
| `accord plan resume\|finish <ID>` | `buildDevOrchestratePayload` + `enrichDevOrchestratePayload` |
| `accord resume <ID>` | `runResumeOrchestrationWithReplans` |
| `accord finish <ID>` | `runFinishOrchestrationFromResolution` |
| `accord align\|spec\|plan\|check <ID>` | `runDevSubcommandOrchestrationWithReplans` |
| `accord init` | `devInitDetect` / `devInitWrite` |
| `accord review` | `review/standalone` + harness spawns |

---

## Dependency graph

```
accord-cli
  ├── accord-core
  └── pi-accord (lazy — pi headless harness only)

pi-accord
  ├── accord-cli
  ├── accord-core
  └── @earendil-works/pi-coding-agent
```

**Rule:** `accord-core` must not import `@earendil-works/pi-coding-agent` or `pi-subagent`.

---

## Related docs

- [`accord-cli.md`](../accord-cli.md) — CLI usage reference
- [`harness-orchestration.md`](../harness-orchestration.md) — ports + state machine
- [`file-structure.md`](../file-structure.md) — monorepo layout
- [`hooks-and-tools.md`](../hooks-and-tools.md) — `dev_*` tools and MCP
- [`host-agnostic-plan.md`](host-agnostic-plan.md) — Pi-optional hosts and agent backends
