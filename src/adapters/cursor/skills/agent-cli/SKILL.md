---
name: agent-cli
description: >-
  Design, debug, or document flows that run Cursor Agent from the CLI or via ACP
  (non-interactive flags, MCP, permissions, resume, worktrees). Use when the user
  mentions agent, Cursor CLI, scripting agents, CI, or ACP integrations.
---

# Agent CLI (Cursor)

## When to use

- Wiring `agent` in shell scripts, Makefiles, or CI (`-p`, `--output-format`, resume).
- Custom clients that spawn `agent acp` and speak JSON-RPC over stdio.
- Choosing among interactive mode, `--print`, cloud handoff (`&` in chat — editor-oriented but related), or `@cursor/sdk` for programmatic agents.

## Checklist for reliable CLI automation

1. **Auth**: Prefer `CURSOR_API_KEY` or documented login for the target environment.
2. **Working directory**: Run from the intended repo root or pass `--workspace` / `--worktree` when edits must stay isolated.
3. **Approvals**: Non-interactive mode has full write access but still surfaces tool approvals where configured; scripts must match `cli-config.json` / project `cli.json` permission rules or use unrestricted flows deliberately.
4. **Observability**: Use `--output-format json` when downstream tools parse results; validate schema across CLI upgrades.

## MCP and ACP

- **MCP**: Same discovery as the editor—keep `mcp.json` minimal and documented (env vars, required secrets via `.env.example`).
- **ACP**: Implement the full handshake (`initialize`, `authenticate`, session lifecycle) and never block on unhandled `session/request_permission` messages.

## Related

- Rules in this plugin’s `rules/agent-cli.mdc` apply to agent-cli–related files by glob.
- For programmatic agents outside the `agent` binary, see Cursor TypeScript SDK docs (`@cursor/sdk`).
