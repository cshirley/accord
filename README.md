# ACCORD

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Pi extension providing **ACCORD**: an agentic contract workflow for the `/dev` command. It handles project configuration, schema validation, verification gating, usage tracking, and status bar updates via transparent event hooks so agents stay focused on their task.

> **ACCORD**: **Agentic Contract for Collaborative Objectives, Requirements, and Rigorous Delivery**
> _Reach ACCORD before you build._

The adversarial spec/plan-to-test subsystem is named **Crucible** — _where intent is stress-tested into evidence._

> **Reach ACCORD. Enter the Crucible. Emerge with Oracles. Verify with Evidence.**

## What it does

- Takes a free-text request to `/dev` and routes it to the right pipeline (quick fix, full implement, investigate, infrastructure, analysis).
- Persists every step as a validated artifact (`brief.md`, `spec.json`, `plan.json`, `verify.json`) so review and verification agents have something concrete to work against.
- Runs preflight and post-step hooks (config guard, schema injection, gather/verify preflight, post-code verification, usage accounting) without the agent needing to know they exist.
- Bundles its own Pi skill, agent, and provider prompts; an installer links them into the host's config directory.

## Documentation

| Doc                                                      | Read this when you want to…                                                                                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/accord-workflow.md`](docs/accord-workflow.md)     | …get the single end-to-end overview of the harness: phases, agents, schemas, hooks, commands. Start here.                                                            |
| [`docs/accord-research.md`](docs/accord-research.md)     | …understand _why_ ACCORD is shaped the way it is — the principles, the design decisions that emerged in the build, and what got cut.                                 |
| [`docs/concepts.md`](docs/concepts.md)                   | …understand the naming and the codebase shape (Core / Adapters / Crucible / Briefing / Harness).                                                                     |
| [`docs/pipeline.md`](docs/pipeline.md)                   | …see the command flow and the per-pattern execution diagrams (standard, quick_fix, express, orchestrated, investigate, infra, analyse) plus pattern selection rules. |
| [`docs/harness-orchestration.md`](docs/harness-orchestration.md) | …read the **target** design: workflow graph in core, deterministic routing, validation boundaries, thin Pi adapter, and phased migration off skill-driven orchestration. |
| [`docs/harness-orchestration-implementation-plan.md`](docs/harness-orchestration-implementation-plan.md) | …follow the **build plan**: spikes, phases 1–7, acceptance criteria, feature flags, MCP options, and open decisions. |
| [`docs/pi-sdk-upgrade-plan.md`](docs/pi-sdk-upgrade-plan.md) | …upgrade `@earendil-works/*` to 0.83.x and adopt Pi extension APIs (dynamic tools, scoped models, entry renderers, `agent_settled`). |
| [`docs/artifacts.md`](docs/artifacts.md)                 | …know where work-item state and committed artifacts live on disk, plus the work-item-ID format.                                                                      |
| [`docs/schemas.md`](docs/schemas.md)                     | …look up the JSON schema for any artifact or agent return packet.                                                                                                    |
| [`docs/hooks-and-tools.md`](docs/hooks-and-tools.md)     | …trace what runs at each Pi lifecycle event and which `dev_*` tools the harness exposes (also over stdio MCP).                                                       |
| [`docs/packaged-assets.md`](docs/packaged-assets.md)     | …understand what ships in `assets/`, how the installer wires it in, and how the agent registry connects prompts to schemas.                                          |
| [`docs/configuration.md`](docs/configuration.md)         | …see how `/dev init` detects the project stack and what supported languages are inferred.                                                                            |
| [`docs/extending.md`](docs/extending.md)                 | …add a language profile, a new agent, or a custom tracker/enrichment provider (bundled or per-project).                                                              |
| [`docs/file-structure.md`](docs/file-structure.md)       | …navigate the source tree by responsibility.                                                                                                                         |
| [`docs/local-development.md`](docs/local-development.md) | …register this checked-out repo in Pi `settings.json` so `/dev` runs from your local source.                                                                         |
| [`docs/ci/autopipeline.md`](docs/ci/autopipeline.md)     | …run ACCORD end-to-end in GitHub Actions: Jira → spec → plan → code → verify → PR, with no human in the loop. See also the sibling docs in [`docs/ci/`](docs/ci/).   |

For the dev-harness configuration this package itself uses (test/lint/verify commands), see [`AGENTS.md`](AGENTS.md).

For the CI autopipeline (Jira-triggered, fully autonomous spec→PR), see the dedicated CI docs:

- [`docs/ci/autopipeline.md`](docs/ci/autopipeline.md) — architecture + contract surface.
- [`docs/ci/consumer-quickstart.md`](docs/ci/consumer-quickstart.md) — ten-line adoption walkthrough.
- [`docs/ci/atlassian-automation.md`](docs/ci/atlassian-automation.md) — Jira trigger rule setup.
- [`docs/ci/troubleshooting.md`](docs/ci/troubleshooting.md) — recurring review items + recovery flows.

## Install Pi ([pi.dev](https://pi.dev/))

ACCORD is a [Pi](https://pi.dev/) package: the `/dev` command, hooks, and bundled skills run inside the **Pi coding agent** terminal app. Install Pi first, then add this repo (see [Quickstart](#quickstart) below).

**Requires Pi ≥ 0.83.0** (`@earendil-works/pi-coding-agent` and peer packages). Upgrade with `npm install -g @earendil-works/pi-coding-agent@latest` or the [pi.dev installer](https://pi.dev/install.sh) if your CLI is older.

**OpenRouter:** when routing OpenAI-compatible models through OpenRouter, set `compat.sessionAffinityFormat` to `"openrouter"` on those models in Pi `models.json` so session-affinity headers use `x-session-id` (Pi 0.83+). See Pi [models.md](https://github.com/earendil-works/pi-coding-agent/blob/main/docs/models.md#compat-fields).

**Linux and macOS** — recommended installer from the Pi site:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

**Alternative** — install the same CLI from npm (see [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)):

```bash
npm install -g @earendil-works/pi-coding-agent
```

**Windows** — Pi needs a bash-capable environment on Windows. Use the [Windows](https://pi.dev/docs/latest/windows) guide (Git Bash, WSL, Cygwin, etc.) under _Platform setup_ in the docs.

**Next steps on the Pi side** — read the official **[Documentation](https://pi.dev/docs/latest)** and **[Quickstart](https://pi.dev/docs/latest/quickstart)** for authentication (subscription or API keys), starting a session, and project-level settings. When `pi` is on your `PATH`, continue with this package’s quickstart.

## Configure Pi (MCP and extensions)

For full **phase-gather** (Jira, GitHub, Slack, Confluence, Google Docs, …) plus **Cursor Agent** models inside Pi, register two extra Pi packages and wire the MCP servers those providers expect.

### Pi packages: `pi-mcp-adapter` and `pi-cursor-agent`

Install from npm (restart Pi after each):

```bash
pi install npm:pi-mcp-adapter
pi install npm:pi-cursor-agent # to use cursor subscription
```

Or add the same strings to the `packages` array in Pi settings (global `~/.config/pi/agent/settings.json` or project `.pi/settings.json`), together with any local checkouts such as this repo:

```json
{
  "packages": [
    "npm:pi-mcp-adapter",
    "npm:pi-cursor-agent",
    "/absolute/path/to/pi-accord"
  ]
}
```

Use `pi list` to confirm Pi sees every entry.

| Package                                                            | Role                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter)   | Bridges MCP servers into Pi so tools show up as `mcp__<server>__<tool>` (lazy by default). Reads shared MCP config (e.g. project `.mcp.json`, user `~/.config/mcp/mcp.json`) and Pi-specific overrides; run **`/mcp setup`** in Pi to import host configs or scaffold servers. See the package README for precedence and `pi-mcp-adapter init`. |
| [`pi-cursor-agent`](https://www.npmjs.com/package/pi-cursor-agent) | Registers **Cursor Agent** as a Pi model provider so you can pick `cursor-agent/…` models (used by ACCORD’s subagent path when configured that way).                                                                                                                                                                                            |

### MCP servers used by bundled providers

ACCORD’s bundled tracker/enrichment sidecars under [`assets/providers/`](assets/providers/) list **optional** MCP tool names for gather. If **pi-mcp-adapter** (or any setup that exposes the same tool ids) is active, those names must resolve to real tools — which depends on the **server key** you give each server in `mcpServers` (the segment between `mcp__` and the next `__` in the id).

| Provider                                      | `mcpTools` (from sidecars)                                                        | You typically configure…                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub** (`github`)                         | `mcp__github__get_issue`                                                          | A GitHub MCP server registered as `github` (plus `gh` CLI fallback).                                                                                        |
| **GitHub PR** (`github-pr`)                   | `mcp__github__get_pull_request`                                                   | Same `github` server.                                                                                                                                       |
| **GitHub Discussions** (`github-discussions`) | `mcp__github__graphql`                                                            | Same `github` server.                                                                                                                                       |
| **Jira** (`jira`)                             | `mcp__atlassian__getJiraIssue`, `atlassian-getJiraIssue`                          | An Atlassian/Jira-capable MCP server whose key matches the prefix you see in Pi (e.g. `atlassian` → `mcp__atlassian__getJiraIssue`).                       |
| **Confluence** (`confluence`)                 | `mcp__atlassian__confluence_search`, `mcp__claude_ai_Atlassian__searchConfluence` | Same family of Atlassian MCP as Jira.                                                                                                                       |
| **Slack** (`slack`)                           | `mcp__slack__search_messages`                                                     | A Slack MCP server registered as `slack` (or adjust [`accord.json`](docs/configuration.md) / project providers if your server uses a different key). |
| **Google Docs** (`google-docs`)               | `mcp__google_workspace__search_drive`, `mcp__google_workspace__get_doc`           | A Google Workspace MCP server registered as `google_workspace`.                                                                                             |
| **GitLab**, **Figma**, **plain-text**         | _(no MCP ids in sidecars)_                                                        | Use `glab` / `FIGMA_ACCESS_TOKEN` / description-only flows per provider playbooks.                                                                          |

Example **shared** MCP config (minimal; extend with whatever binaries or `npx` packages your team uses for Jira, Slack, Google, etc. — the important part is the **`mcpServers` key** matching the prefix in the table, e.g. `github` → `mcp__github__…`):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "directTools": true
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "~/src"
      ],
      "directTools": true
    },
    "atlassian": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://mcp.atlassian.com/v1/mcp"
      ],
      "directTools": true
    },
    "google_workspace": {
      "command": "npx",
      "args": [
        "--yes",
        "--package",
        "git+https://github.com/gemini-cli-extensions/workspace.git#v0.0.8",
        "gemini-workspace-server"
      ],
      "directTools": true
    }
  }
}
```

Add a sibling entry for **`slack`** (or any other server your team uses — `gitlab`, Figma, etc.) using the vendor’s documented `command` / `args` / `env` block, matching the **`mcpServers` key** to the prefix the corresponding sidecar expects. Place the file in **`~/.config/mcp/mcp.json`** (user-wide) or **`.mcp.json`** at a project root, then restart Pi or use **`/mcp`** to confirm servers and tool names. If Pi shows different prefixes than the sidecars expect, add a provider override in [`accord.json`](docs/configuration.md) with `mcpTools` that match the live tool list.

**Separate from gather MCP:** this repo also ships a stdio **`dev_*`** MCP server for Cursor and other clients (`bun run mcp` — see [hooks-and-tools](docs/hooks-and-tools.md)). That process does not replace the GitHub/Atlassian/Slack/Google servers above; it only exposes ACCORD’s harness tools.

## Quickstart

Inside the package:

```bash
bun install
npm run check                    # bun test + schemas + assets + types + bundle + runtime smoke
```

Make pi.dev load `/dev` from this checkout:

```bash
bun run install:dev       # pi install this repo + link bundled assets (see scripts/install-dev.sh)
# or: pi install .
# Start pi → it auto-links the bundled skills/agents/providers and
# notifies you to restart. Restart pi once more — done.
```

See [`docs/local-development.md`](docs/local-development.md) for the auto-install behaviour matrix, the opt-out env var, the edit-test loop, and how to remove the install.

Or expose the same `dev_*` tools over stdio MCP without registering as a Pi extension:

```bash
ACCORD_CWD=/path/to/your/repo bun run mcp
```

Inside a project that has the extension installed:

```bash
/dev init                        # detect stack, write ## Dev Harness block in AGENTS.md
/dev "ticket-or-free-text"       # let ACCORD route to the right pipeline
/dev finish <ID>                 # run verification and produce the completion packet
```

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, how to run checks, and pull request expectations.

## License

Licensed under the [MIT License](LICENSE).
