---
type: Playbook
title: Local development setup
description: Make this checkout the live /dev extension in Pi and iterate on it.
tags: [setup, pi, install, assets, development]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: local-dev
    resource: /docs/local-development.md
    title: Local development
  - id: install-dev
    resource: /scripts/install-dev.sh
    title: install-dev script
  - id: contributing
    resource: /CONTRIBUTING.md
    title: Contributing
---

# Trigger

Developing ACCORD itself, or running it from a local checkout rather than a published package.

# Prerequisites

- Bun
- Pi ≥ 0.83.0 (`pi --version`) — peer deps target `@earendil-works/*` 0.83.x

# Steps

## 1. Install and check

```bash
bun install
npm run check
```

## 2. Register with Pi

```bash
bun run install:dev    # = pi install "$(pwd)" && bun run install:assets
```

Adds the repo root to `~/.config/pi/agent/settings.json` → `packages`; Pi loads all five
extensions from `package.json` → `pi`. Other local Pi packages:
`bash scripts/install-dev.sh /path/to/other-pkg …` (this repo installed last). Project-local:
`pi install -l <path>`.

Remove any legacy `~/.config/pi/agent/extensions/accord` (or separate `subagent`, `worktree`)
dirs so the harness isn't loaded twice.

## 3. Start Pi twice

First start: `session_start` bootstrap links assets and seeds `~/.config/pi/agent/accord.json`,
then asks for a restart. Second start: `/dev` fully functional.

## 4. Verify

- `/dev help` prints subcommands; `/dev tasks` shows an empty dashboard.
- `cat ~/.config/pi/agent/.accord-assets.json` exists.
- `ls ~/.config/pi/agent/agents/accord ~/.config/pi/agent/providers` resolve.

# Edit-test loop

| Edit | Takes effect |
|------|--------------|
| TypeScript under `packages/*/src` | Next Pi session restart (no build step) |
| Agent / provider markdown | Next subagent spawn |
| Skills (`packages/pi-skills/skills/*/SKILL.md`) | Next skill invocation |
| Schemas | Immediately at runtime — run `bun run validate:schemas` first |

# Variants

- Skills only, no harness: `bash scripts/install-pi-skills.sh [--integrations]`.
- Headless: `bun run accord …` or `bun run install:shim` for `~/.local/bin/accord`.
- MCP: `ACCORD_CWD=/path/to/repo bun run mcp`.
- Asset install control: `bun run install:assets --dry-run | --force`; opt out with `ACCORD_AUTO_INSTALL_ASSETS=0` or `asset_bootstrap.auto_install: false`.
