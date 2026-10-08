# Changelog

All notable changes to this package are documented here.

## [Unreleased] — Host-agnostic `accord` CLI

### Added

- **`accord-cli` no longer hard-depends on Pi** — `--harness exec` (plus bundled `claude`/`cursor` exec presets) runs the full resume/finish/workflow-phase loop without `pi-accord` or a Pi install. `pi` remains an opt-in harness for driving Pi subagents from the CLI.
- **`accord config init --harness <id>`** detects installed CLIs (`pi`, `claude`, `agent`) and writes `harness.backends[]` + per-tier model/thinking config to `~/.config/accord/accord.json` (host-neutral path; legacy `~/.config/pi/agent/accord.json` still read as a deprecated fallback).
- **`accord-mcp`** extracted as its own package (`packages/accord-mcp/`) with zero Pi dependency; `ACCORD_MCP_HARNESS=pi|exec` lets MCP clients execute (not just preview) resume/finish via `accord-cli` harnesses.

### Documentation

- [`README.md`](README.md), [`docs/accord-cli.md`](docs/accord-cli.md), [`docs/concepts.md`](docs/concepts.md) (host feature matrix), [`docs/local-development.md`](docs/local-development.md) — clarified that Pi is one optional client, not a dependency, of the CLI/MCP surfaces; fixed a Quickstart example that passed `--harness pi` under a "without Pi" heading.
- [`docs/plans/host-agnostic-plan.md`](docs/plans/host-agnostic-plan.md) — tracks remaining gaps (judgment LLM off Pi, asset/skill install without Pi's config layout, orchestration cleanup).

## [Unreleased] — Pi SDK 0.83 → 1.1.0 upgrade

### Added

- **Pi 0.83 peer upgrade** — `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui` at `^0.83.0`; `typebox` `^1.3.7`.
- **Pi 1.1.0 peer bump (Phase 6)** — peers re-pinned to `^1.1.0` in lockstep across root and `packages/pi-{accord,git,integrations,subagent,thrift}/package.json`; `ToolCall.arguments` typed through `pi-ai`'s `JsonObject`, `ToolRenderContext` stub updated for required `durationMs`/`outputPad`. See [`docs/plans/pi-sdk-upgrade-plan.md`](docs/plans/pi-sdk-upgrade-plan.md) Phase 6.
- **`agent_settled`** — pending-decision notify and thrift output pruning run after full settle (not on bare `agent_end`).
- **Entry renderers** — `dev-harness-run`, thrift output level, and pi-worktree session markers styled in scrollback/`/tree`.
- **Dynamic `dev_*` tools** — core set always active; phase bundles expand on demand (`ACCORD_DYNAMIC_TOOLS` on by default, `0` to opt out). MCP stdio keeps all tools active.
- **Orchestration judgment model** — `orchestration.judgment.model` config with resolution precedence; scoped-model preflight diagnostics.
- **Correlation headers** — `X-Accord-Run-Id`, `X-Accord-Session-Tag`, `X-Accord-Work-Item-Id` via `before_provider_headers`.
- **`promptGuidelines`** on high-traffic core `dev_*` tools.
- **Built-in tool render overrides** — `read` / `write` / `edit` highlight `.tasks/` and `docs/dev/` paths in the TUI.
- **`dev_retro` session enrichment** — `SessionManager` transcript analysis (RPC `get_entries` / `get_tree` parity) for entry counts, compactions, tool errors, and harness markers.
- **Review agent thinking** — `thinking: xhigh` on all `review-*` agents; `max` thinking level support in subagent profiles.

### Changed

- Orchestrator spawn UI hides Pi's default working row (`setWorkingVisible(false)`) while the custom above-editor widget is active.
- CI `subagent.json` reasoning tier uses `xhigh` thinking.

### Documentation

- [`docs/hooks-and-tools.md`](docs/hooks-and-tools.md) — `agent_settled`, entry renderers, dynamic tools, correlation headers, built-in renders.
- [`docs/local-development.md`](docs/local-development.md) — Pi ≥ 1.1.0 requirement and `ACCORD_DYNAMIC_TOOLS`.
- [`docs/plans/pi-sdk-upgrade-plan.md`](docs/plans/pi-sdk-upgrade-plan.md) — phases 0–6 complete.

## [0.1.0] — Initial release

- ACCORD `/dev` harness: work items, Crucible verification, phase/review agents, Pi extension and stdio MCP surface.
