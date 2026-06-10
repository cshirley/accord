# File structure

```
packages/                      Bun workspaces — extra Pi extensions bundled with pi-accord
  pi-subagent/src/             subagent tool + agent discovery (see package.json pi.extensions)
  pi-worktree/src/             wt_* tools, /wt command
  pi-thrift/src/               /thrift (alias /tp) input + output token pruning
  pi-git-tools/src/            git_commit_*, gh_pr_* tools
  pi-tools/src/                Jira / Slack / Google Workspace integrations (defs, commands, MCP)

src/
  index.ts                       Harness entry; delegates to src/adapters/pi/extension.ts

  core/
    subagent/                    Host-neutral subagent prepare, preflight, spawn payload, result processing
    harness/                     Host-neutral hook callables (Pi + Cursor; re-exports subagent surface)
    work-items/                  .tasks lifecycle, checkpointing, JSON IO, WorkItem types
    artifacts/                   Artifact and return-packet validation
    config/                      Config types, globals, AGENTS.md parsing, placement, detection
      detect/                    Project stack, monorepo, tracker, and command inference
    commands/                    Host-neutral /dev dispatch, help, intent classification, classify-dispatch, subcommand-routing
    asset-install.ts             Pi asset symlink installer (CLI wrapper: scripts/install-assets.ts)
    plan/                        Task pipeline profile loading
    git/                         Git helpers for orchestration commits
    orchestration/               Workflow graph (`graph.ts`, `guards.ts`, `interpreter.ts`), host ports (`host.ts`), planning (`plan.ts` — `buildDevOrchestratePayload`, `planDevResume/Finish`), runner (`runner.ts` — `runResumeOrchestrationWithReplans`, `runFinishOrchestration`, `runUntilStop`), `judgment.ts`, `policy.ts`, `quick-fix.ts`, `phase-coarse-routing.ts`, `post-result/` (per-agent post-spawn handlers + shared `advancePrimaryTask`), `resolve/` (resume + finish resolution; unified `resolvePrimaryTaskResumeAgentId`)
    queries/                     Read-only dashboards, review queue, verify summaries, retro
    briefing/                    Context router: code briefs, decision packets, intent contract briefs
    verification/                Verification command runner (`runner.ts`), staleness checks (`staleness.ts`) — formerly `crucible/`
    agents/                      Logical agent role registry and schema assignments
    telemetry/                   Usage accounting, run tags, work item discovery
    tools/                       Single registry of `dev_*` tools (`registry.ts`) + TypeBox→Zod compiler (`compile-zod.ts`); Pi + MCP adapters iterate this
    types/                       Cross-cutting types: `domain.ts`, `phases.ts`, `result.ts`, `host.ts` (HarnessHost / HarnessMutableState)

  adapters/mcp/
    server.ts                    Stdio MCP server (same dev_* tools as Pi)
    register-tools.ts            MCP tool registration

  adapters/pi/
    extension.ts                 Pi extension registration for /dev, tools, hook listeners
    subagent/                    Programmatic spawn UI + OrchestrationRuntimeHost (resume/finish)
      runtime-host.ts            Preflight, runSubagent, processSubagentToolResult
      command-preflight.ts       Plan mode + work-item-id gate for resume + finish
      spawn-bridge.ts            runOrchestrationSubagent / mapSpawnResultToSingle
      spawn-ui.ts                Spawn progress UI wiring
      chat-display.ts            In-chat progress row during orchestration spawns
      spawn-status.ts            Footer widget + heartbeat during spawns
      judgment.ts                Optional LLM judgment for resume task supplements
    workflow-orchestration.ts    Core orchestrator entry for `/dev` workflow subcommands (default on)
    finish-orchestration.ts      `/dev finish` closeout (verify → dev_verify_summary → dev_finalize)
    command/autocomplete.ts      Pi autocomplete wiring for /dev arguments
    pi-hook-listeners.ts         Pi lifecycle event handlers (host-neutral harness hooks + UI wiring)
    hook-state.ts                Shared Pi hook state and session marker sync
    plan-mode.ts                 Pi plan-mode guard messages
    status-bar.ts                Pi status bar rendering
    tools.ts                     Thin loop over `core/tools/ACCORD_TOOLS` — translates host-neutral results into Pi envelopes

  integrations/
    pi-subagent.ts                 Re-exports for packages/pi-subagent (single import surface for ACCORD)
    provider-deps.ts             Bundled + user provider loader, preflight dep checks, and report formatting

assets/
  manifest.json                  Install-time manifest for bundled Pi prompt assets
  lang-profiles/*.json           Per-language defaults
  skills/{commit,pr,review}/SKILL.md  Companion skills (commit, PR, review)
  agents/accord/*.md             Phase and review agent definitions
  agents/default.md              Default agent stub
  providers/trackers/*.md        Primary tracker fetch playbooks
  providers/trackers/*.json      Tracker connectivity sidecars
  providers/enrichments/*.md     Enrichment fetch playbooks
  providers/enrichments/*.json   Enrichment connectivity sidecars

schemas/                         Source of truth for artifact shapes
  *.json                         Artifact schemas
  return-schemas/*.json          Per-agent return schemas
  examples/*.json                Validated example payloads
  examples/validate-examples.mjs

scripts/install-assets.ts         CLI wrapper for `src/core/asset-install.ts` (`install:assets`)
scripts/install-dev.sh            Run `pi install` on this repo then `install:assets` (`install:dev`)
scripts/runtime-smoke.ts          Lightweight runtime smoke (`check:runtime`)
scripts/validate-assets.ts        Manifest + registry consistency (`validate:assets`)
tests/*.test.ts                   Bun unit tests (`core-contracts`, `harness`, `providers`, …)
```

## Navigation guide

- Change `/dev` command routing or intent classification in `src/core/commands/`.
- Change harness orchestration (`src/core/orchestration/`) — see [`docs/harness-orchestration.md`](harness-orchestration.md) and [`docs/harness-orchestration-implementation-plan.md`](harness-orchestration-implementation-plan.md). The core orchestrator owns `/dev` workflow routing by default (`ACCORD_CORE_ORCHESTRATOR` off only disables programmatic spawns).
- Change Pi-specific command behavior, autocomplete, hook listeners, status, or tool envelope wrapping in `src/adapters/pi/`.
- Change work item state and `.tasks/` handling in `src/core/work-items/`.
- Change agent brief construction in `src/core/briefing/`.
- Change verification pressure, command execution, or stale artifact checks in `src/core/verification/`.
- Change subagent prepare/preflight/result handling in `src/core/subagent/`; other shared hooks stay in `src/core/harness/` (re-exports subagent for compatibility).
- Change Pi programmatic spawn UI in `src/adapters/pi/subagent/`; hook wiring stays in `src/adapters/pi/pi-hook-listeners.ts`.
- Add, remove, or rename a `dev_*` tool surface in `src/core/tools/registry.ts` — both Pi and MCP adapters pick it up automatically.
- Change schemas or return packet rules in `schemas/` and `src/core/artifacts/validation.ts`.
- Run `npm run check` from the package root after structural changes; it includes `bun test`, schema examples, asset validation, bundle, and runtime smoke checks.

Core modules should stay host-neutral; Pi, Claude Code, Codex, or Copilot-specific APIs belong under `src/adapters/`.
