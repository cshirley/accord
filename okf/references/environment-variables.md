---
type: Reference
title: Environment variables
description: ACCORD_* and related PI_* environment switches across core, CLI, MCP, Pi extensions, and CI.
tags: [configuration, env]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: paths
    resource: /packages/accord-core/src/config/paths.ts
    title: Config paths and overrides
  - id: hooks-doc
    resource: /docs/hooks-and-tools.md
    title: Event hooks and tools
  - id: cli-doc
    resource: /docs/accord-cli.md
    title: Standalone accord CLI
  - id: local-dev
    resource: /docs/local-development.md
    title: Local development
---

# Orchestration and behaviour

| Variable | Default | Effect |
|----------|---------|--------|
| `ACCORD_CORE_ORCHESTRATOR` | on | `0`/`false`/`no`/`off` disables programmatic spawns (not recommended) |
| `ACCORD_ORCHESTRATION_JUDGMENT` | off | `1` lets Pi run bounded judgment when `orchestration.judgment.enabled` |
| `ACCORD_ALLOW_AGENT_WORKFLOW_WRITES` | off | `1`/`true`/`yes` lets agents write orchestrator-owned `.tasks/` state (legacy) |
| `ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS` | — | Orchestration default spawn timeout (else `subagent.json` `spawnTimeoutMs`) |
| `ACCORD_LOG_LEVEL` | `error` | `debug`/`info`/`warn`/`error`/`silent`; overrides Dev Harness `log_level` |
| `ACCORD_HARNESS` | — | Default harness backend id when not configured |

# Pi extension

| Variable | Default | Effect |
|----------|---------|--------|
| `ACCORD_DYNAMIC_TOOLS` | on | `0` exposes every `dev_*` tool always |
| `ACCORD_AUTO_INSTALL_ASSETS` | on | `false`/`0`/`no`/`off` disables session-start asset linking |
| `ACCORD_CLI_DELEGATE` | in-process | `subprocess` spawns `accord <cmd> --harness pi` |
| `ACCORD_CLI_BIN` | — | CLI script path for subprocess delegate |
| `PI_PROGRESSIVE_TOOLS` | on | `0` disables progressive tool loading for pi-git / pi-integrations |
| `PI_GIT_DYNAMIC_TOOLS`, `PI_INTEGRATIONS_DYNAMIC_TOOLS` | on | Per-package progressive toggle |

# MCP

| Variable | Effect |
|----------|--------|
| `ACCORD_CWD` | Project root; server `chdir`s so `.tasks/` / `docs/dev/` resolve |
| `ACCORD_MCP_HARNESS` | `pi` \| `exec` — `dev_orchestrate` executes spawns (else plan-only) |

# Harness binaries

| Variable | Effect |
|----------|--------|
| `ACCORD_PI_BIN` | `pi` binary path |
| `ACCORD_CLAUDE_CODE_BIN` | `claude` binary path |
| `ACCORD_CLAUDE_SKIP_PERMISSIONS` | `1` adds `--dangerously-skip-permissions` (CI only; off locally) |
| `ACCORD_CURSOR_AGENT_BIN` | Cursor `agent` binary path |

# Paths

| Variable | Default |
|----------|---------|
| `ACCORD_CONFIG_DIR` | `~/.config/accord` |
| `ACCORD_PI_AGENT_DIR` | `~/.config/pi/agent` |
| `ACCORD_ASSETS_DIR` (deprecated `ACCORD_HARNESS_PKG_DIR`) | `packages/accord-assets` |
| `ACCORD_PI_PKG_DIR` | `packages/pi-accord` |
| `ACCORD_PI_SKILLS_DIR` | `packages/pi-skills` |

# CI (accord-ci)

| Variable | Effect |
|----------|--------|
| `ACCORD_CI_HARNESS` | Exec backend for autopipeline phases (default `claude`) |
| `ACCORD_DISPATCH_KIND` | Canonicalised trigger kind (preferred over `GITHUB_EVENT_NAME` inside reusable workflows) |

Secrets (`ANTHROPIC_API_KEY`, `JIRA_*`, `GH_PAT_PR`) are described in
[Adopt autopipeline](/playbooks/adopt-autopipeline.md). Never commit `.env` files.
