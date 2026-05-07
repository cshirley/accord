# File structure

```
src/
  index.ts                       Composition root; delegates to src/adapters/pi/extension.ts

  core/
    harness/                     Host-neutral hook callables (Pi + Cursor)
    work-items/                  .tasks lifecycle, checkpointing, JSON IO, WorkItem types
    artifacts/                   Artifact and return-packet validation
    config/                      Config types, globals, AGENTS.md parsing, placement, detection
      detect/                    Project stack, monorepo, tracker, and command inference
    commands/                    Host-neutral /dev dispatch, help, intent classification
    queries/                     Read-only dashboards, review queue, verify summaries, retro
    briefing/                    Context router: code briefs, decision packets, intent contract briefs
    crucible/                    Verification command runner, result formatting, staleness checks
    agents/                      Logical agent role registry and schema assignments
    telemetry/                   Usage accounting, run tags, work item discovery

  adapters/mcp/
    server.ts                    Stdio MCP server (same dev_* tools as Pi)
    register-tools.ts            MCP tool registration

  adapters/pi/
    extension.ts                 Pi extension registration for /dev, tools, hooks
    command/autocomplete.ts      Pi autocomplete wiring for /dev arguments
    hooks.ts                     Pi lifecycle event handlers
    hook-state.ts                Shared Pi hook state and session marker sync
    plan-mode.ts                 Pi plan-mode guard messages
    status-bar.ts                Pi status bar rendering
    tools.ts                     Pi tool registration wrappers around core functions

  integrations/
    provider-deps.ts             Bundled + user provider loader, preflight dep checks, and report formatting

assets/
  manifest.json                  Install-time manifest for bundled Pi prompt assets
  lang-profiles/*.json           Per-language defaults
  skills/accord/SKILL.md         Canonical ACCORD orchestrator skill
  skills/dev/SKILL.md            Legacy alias skill
  agents/*.md                    Phase and review agent definitions
  providers/trackers/*.md        Primary tracker fetch playbooks
  providers/trackers/*.json      Tracker connectivity sidecars
  providers/enrichments/*.md     Enrichment fetch playbooks
  providers/enrichments/*.json   Enrichment connectivity sidecars

schemas/                         Source of truth for artifact shapes
  *.json                         Artifact schemas
  return-schemas/*.json          Per-agent return schemas
  examples/*.json                Validated example payloads
  examples/validate-examples.mjs

scripts/runtime-smoke.ts          Lightweight runtime smoke test for core helpers
scripts/install-pi-assets.ts      Links bundled Pi assets into a host config directory
tests/*.test.ts                   Bun unit tests (`core-contracts`, `harness`, `providers`, …)
```

## Navigation guide

- Change `/dev` command routing or intent classification in `src/core/commands/`.
- Change Pi-specific command behavior, autocomplete, hooks, status, or tool registration in `src/adapters/pi/`.
- Change work item state and `.tasks/` handling in `src/core/work-items/`.
- Change agent brief construction in `src/core/briefing/`.
- Change verification pressure, command execution, or stale artifact checks in `src/core/crucible/`.
- Change shared hook behaviour (reusable outside Pi) in `src/core/harness/`; Pi-specific wiring stays in `src/adapters/pi/hooks.ts`.
- Change schemas or return packet rules in `schemas/` and `src/core/artifacts/validation.ts`.
- Run `npm run check` from the package root after structural changes; it includes `bun test`, schema examples, asset validation, bundle, and runtime smoke checks.

Core modules should stay host-neutral; Pi, Claude Code, Codex, or Copilot-specific APIs belong under `src/adapters/`.
