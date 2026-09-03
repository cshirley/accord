# accord

Cursor Marketplace-style plugin for **Cursor Agent in the CLI** (interactive `agent`, headless `--print`, MCP, and ACP clients).

## Layout

| Path | Purpose |
| --- | --- |
| `.cursor-plugin/plugin.json` | Plugin manifest (required `name`: `accord`) |
| `rules/agent-cli.mdc` | Rule scoped to automation-oriented file globs |
| `skills/agent-cli/SKILL.md` | Skill invoked for CLI/ACP/scripting topics |
| `commands/agent-print.md` | Agent-executable command doc for non-interactive runs |
| `../../accord-cli/scripts/cursor-agent-exec.ts` | ACCORD exec harness backend — frontmatter → `--model`, body-only prompt |

Optional directories you can add later: `agents/`, `hooks/`, `mcp.json`, `assets/`, `scripts/`. See [Plugins reference](https://cursor.com/docs/reference/plugins.md).

## Try it locally

1. Symlink this repo into Cursor’s local plugins folder and reload the app:

   `ln -s "$(pwd)" ~/.cursor/plugins/local/accord`

2. Confirm rules and skills appear under Cursor Settings → Rules (and Skills / Agent Decides).

The same rules and MCP configuration are consumed by **Agent in the CLI** when you run `agent` from a project using this plugin ([Using Agent in CLI](https://cursor.com/docs/cli/using)).

## Publish

Iterate in `~/.cursor/plugins/local`, then submit the public Git repository at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) when ready.
