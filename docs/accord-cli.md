# Standalone `accord` CLI

Headless ACCORD orchestrator — same core routing as `/dev`, without the Pi REPL. Pi extension and stdio MCP are optional clients on top of `@clive.shirley/accord-core`.

For extraction history and package layout, see [`plans/accord-cli-extraction.md`](plans/accord-cli-extraction.md).

## Quick start

From an ACCORD checkout (monorepo root):

```bash
bun install
bun run accord tasks
bun run accord init
bun run accord resume DEMO-1 --harness pi -y
```

Global install: link or publish `@clive.shirley/accord-cli` and run `accord` directly.

Dev checkout: `bun run install:dev` (or `bun run install:shim`) installs `~/.local/bin/accord` pointing at this repo. Ensure `~/.local/bin` is on your `PATH`.

Requires **AGENTS.md** with a `## Dev Harness` JSON block (or run `accord init --write` first). Agent markdown and provider playbooks ship from `packages/accord-assets/` (or `~/.config/pi/agent/` after `install:assets`).

## Commands

| Command | Purpose |
|---------|---------|
| `accord tasks [--json]` | Work item dashboard (`devTasks`) |
| `accord plan resume\|finish <ID> [--json]` | Orchestration plan only (same JSON as `dev_orchestrate`) |
| `accord resume <ID>` | Full resume loop with harness spawns |
| `accord finish <ID>` | Finish closeout + verify acceptance spawn |
| `accord align\|spec\|plan\|check <ID>` | Forced phase subcommands (`runDevSubcommandOrchestrationWithReplans`) |
| `accord init [--json] [--write [--target …]]` | Stack detect + optional AGENTS.md write |
| `accord config init [--write] [--force] [--harness <id>]` | Generate `~/.config/accord/accord.json` with backends + tiers |
| `accord review [--json]` | Standalone diff review (`review-code`, `review-security`, optional `review-test`) |

**Naming:** `accord plan resume DEMO-1` is the **orchestrate preview** (resume/finish). `accord plan DEMO-1` is the **workflow** subcommand that spawns `phase-plan`.

### Global flags

| Flag | Description |
|------|-------------|
| `--harness <id>` | Agent backend (`pi`, `claude`, `cursor`, legacy `exec`) |
| `--cwd <dir>` | Project root (default: `process.cwd()`) |
| `--json` | Machine-readable output where supported |
| `-y`, `--yes` | Auto-confirm gather preflight (non-interactive) |
| `-h`, `--help` | Usage |

### Init

```bash
accord init                    # detect + print summary
accord init --json             # full detect payload
accord init --write            # write using placement-derived default target
accord init --write --target=local
```

Targets: `local`, `root`, `root_replace`, `link_only` (same as `dev_init_write`).

### Global config init

```bash
accord config init --write -y     # ~/.config/accord/accord.json
accord config init --write --harness cursor --force
```

Detects installed CLIs (`pi`, `claude`, `agent`) and writes `harness.backends[]` plus `harness.tiers` (model + thinking per tier). Per-agent tier routing uses the agent markdown `tier:` frontmatter or review agent name.

### Exec harness

#### Pi CLI (built-in `--harness pi`)

Spawns `pi --mode json -p` via `pi-subagent` — no `pi-accord` headless harness. Use when Pi is your agent runtime and you want native subagent.json profile resolution.

```bash
accord resume DEMO-1 --harness pi -y
```

Optional exec preset: import `PI_EXEC_HARNESS` or point `harness.exec.command` at `packages/accord-cli/scripts/pi-exec.ts`.

#### Claude Code CLI (bundled preset)

For headless `claude -p` spawns. Frontmatter controls `claude --model` and `--effort` via `subagent.json`. Agent body → `--system-prompt`; project stack → `--append-system-prompt`; task → prompt. Prefer `anthropic-direct` (or similar) in `subagent.json`.

```json
{
  "harness": {
    "default": "exec",
    "exec": {
      "command": [
        "bun",
        "packages/accord-cli/scripts/claude-code-exec.ts",
        "--agent={{agentId}}",
        "--agent-file={{agentFile}}",
        "--task-file={{taskFile}}",
        "--system-append-file={{systemAppendFile}}",
        "--cwd={{cwd}}"
      ],
      "response_json": "stdout"
    }
  }
}
```

Or import `CLAUDE_CODE_EXEC_HARNESS`. Set `ACCORD_CLAUDE_CODE_BIN` to override the `claude` path.

#### Cursor Agent CLI (bundled preset)

For headless `agent --print` spawns. Frontmatter in agent markdown (`tier`, `model`, `thinking`) controls `agent --model` via `subagent.json` — same resolution as Pi subagent spawns. Only the agent **body**, project stack append, and orchestrator task are sent as the prompt.

```json
{
  "harness": {
    "default": "exec",
    "exec": {
      "command": [
        "bun",
        "packages/accord-cli/scripts/cursor-agent-exec.ts",
        "--agent={{agentId}}",
        "--agent-file={{agentFile}}",
        "--task-file={{taskFile}}",
        "--system-append-file={{systemAppendFile}}",
        "--cwd={{cwd}}"
      ],
      "response_json": "stdout"
    }
  }
}
```

Or import `CURSOR_AGENT_EXEC_HARNESS` from `@clive.shirley/accord-cli`. Set `ACCORD_CURSOR_AGENT_BIN` to override the `agent` binary path.

#### Generic subprocess template

```json
{
  "harness": {
    "exec": {
      "command": ["my-runner", "--agent", "{{agentId}}", "--task-file", "{{taskFile}}"],
      "response_json": "stdout",
      "env": { "MY_FLAG": "1" }
    }
  }
}
```

Tokens: `{{agentId}}`, `{{agent}}`, `{{agentFile}}`, `{{task}}`, `{{taskFile}}`, `{{systemAppend}}`, `{{systemAppendFile}}`, `{{assetsDir}}`, `{{schemasDir}}`, `{{cwd}}`. Task briefs stage under `.tasks/.exec-spawn/` when `{{taskFile}}` is used.

```bash
accord resume DEMO-1 --harness exec
```

### Review

Mirrors the bundled `/review` skill: gathers git diff (staged → unstaged → `origin/HEAD...HEAD`), runs review agents via harness, merges findings.

```bash
accord review --harness pi
accord review --json
```

Core helpers: `packages/accord-core/src/review/standalone.ts`.

## Harness backends

| ID | Implementation | Notes |
|----|----------------|-------|
| `pi` | `accord-cli/harnesses/pi-exec.ts` | `pi --mode json -p` via pi-subagent subprocess spawns |
| `exec` | `accord-cli/harnesses/exec.ts` + exec presets | Subprocess template; claude/cursor/pi presets map frontmatter → CLI flags |

Shared spawn path: `accord-cli/src/harnesses/spawn-pipeline.ts` (preflight → spawn → `processSubagentToolResult`).

## Pi extension as client

`/dev resume`, `/dev finish`, and workflow subcommands delegate through `packages/pi-accord/src/adapters/pi/cli-client.ts`:

| Mode | Env | Behaviour |
|------|-----|-----------|
| In-process (default) | — | `@clive.shirley/accord-cli` commands + `createPiExtensionHarness` (full Pi TUI) |
| Subprocess | `ACCORD_CLI_DELEGATE=subprocess` | Spawns `accord <cmd> <ID> --harness pi` |
| Custom entry | `ACCORD_CLI_BIN=<path>` | Override CLI script for subprocess mode |

Pi-only: TUI spawn widgets, dynamic tools, session transcript markers, finish review-queue preview.

## MCP

Stdio server: `bun run mcp` (see [`hooks-and-tools.md`](hooks-and-tools.md)).

| Env | Effect |
|-----|--------|
| `ACCORD_CWD` | Project root (`.tasks/`, `docs/dev/`) |
| `ACCORD_MCP_HARNESS=pi\|exec` | `dev_orchestrate` can execute resume/finish via harness |
| `execute: false` on `dev_orchestrate` | Plan-only even when harness is set |

When harness is configured, `dev_orchestrate` returns the same enriched JSON as `accord plan --json`, plus optional `execution: { exit_code, … }`.

## Programmatic API

```typescript
import {
  createCliContext,
  createHarness,
  runResumeCommand,
} from "@clive.shirley/accord-cli";
```

Exports mirror CLI commands; used by Pi `cli-client` and MCP `mcp-orchestrate-host.ts`.

## Related

- [`file-structure.md`](file-structure.md) — `accord-core` / `accord-cli` / `pi-accord` layout
- [`harness-orchestration.md`](harness-orchestration.md) — orchestration ports and state machine
- [`hooks-and-tools.md`](hooks-and-tools.md) — `dev_*` tools and MCP parity
