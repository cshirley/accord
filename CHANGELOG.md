# Changelog

All notable changes to this package are documented here.

## [Unreleased] — Pi SDK 0.83 upgrade

### Added

- **Pi 0.83 peer upgrade** — `@earendil-works/pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui` at `^0.83.0`; `typebox` `^1.3.7`.
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
- [`docs/local-development.md`](docs/local-development.md) — Pi ≥ 0.83 requirement and `ACCORD_DYNAMIC_TOOLS`.
- [`docs/pi-sdk-upgrade-plan.md`](docs/pi-sdk-upgrade-plan.md) — phases 0–5 complete.

## [0.1.0] — Initial release

- ACCORD `/dev` harness: work items, Crucible verification, phase/review agents, Pi extension and stdio MCP surface.
