---
type: Reference
title: accord CLI
description: Headless ACCORD orchestrator commands, global flags, and harness selection.
tags: [cli, accord, headless, harness]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: cli-doc
    resource: /docs/accord-cli.md
    title: Standalone accord CLI
  - id: cli-src
    resource: /packages/accord-cli/src/
    title: accord-cli source
---

# Invocation

```bash
bun run accord <command>          # from monorepo root
accord <command>                  # after `bun run install:shim` (~/.local/bin/accord)
accord                            # interactive shell in a TTY
eval "$(accord completion bash)"  # shell completion (bash|zsh)
```

Requires AGENTS.md with a `## Dev Harness` block (`accord init --write` creates it).

# Commands

| Command | Purpose |
|---------|---------|
| `tasks [--select] [--json]` | Work item dashboard; lists pending decisions with file/IDs to edit |
| `run <text>` | Bootstrap from ticket or description |
| `drive <ID>` | Drive work-item loop (`--finish` to close out, `--max-rounds <n>`) |
| `resume <ID>` | Full resume loop with harness spawns |
| `finish <ID>` | Closeout + verify-acceptance spawn |
| `align\|spec\|plan\|check <ID>` | Forced workflow phase |
| `plan resume\|finish <ID> [--json]` | Orchestration **preview** only (same JSON as `dev_orchestrate`) |
| `block <ID> <task_id> <reason>` | Force-block a task |
| `answer <ID> [<decision-id> "answer"]… [--force]` | Resolve pending `decisions[]` entries; no answers lists them. All-or-nothing; `--force` overwrites a resolved answer |
| `unblock <ID> [--task n] [--note\|--fixed\|--accept\|--waive F-n\|AC-n "reason"]… [--force "reason"]` | Decide blockers and unblock; interactive per-blocker walk in a TTY when no flags |
| `trace <ID> [--task n] [--open]` | Per-task trace (`--json` for the raw v2 files) |
| `task reseed <ID> [--task n] [--from test\|code]` | Replace v1/broken task files with fresh v2 files seeded from the plan |
| `gaps`, `spec-gaps`, `deviations`, `rehydrate`, `retro`, `tag` | Same as `/dev` equivalents |
| `init [--json] [--write [--target local\|root\|root_replace\|link_only]]` | Stack detect + AGENTS.md write |
| `config init [--write] [--force] [--harness <id>] [-y]` | Generate `~/.config/accord/accord.json` |
| `review [--json]` | Standalone diff review (`review-code`, `review-security`, optional `review-test`) |

Naming trap: `accord plan resume X` = preview; `accord plan X` = spawn `phase-plan`.

# Global flags

| Flag | Meaning |
|------|---------|
| `--harness <id>` | `pi`, `claude`, `cursor`, `exec` — see [Subagent spawning](/architecture/subagent-spawning.md) |
| `--cwd <dir>` | Project root |
| `--json` | Machine-readable output |
| `-y`, `--yes` | Auto-confirm gather preflight |
| `--allow-pending-decisions` | Bypass pending-decisions resume gate |
| `--no-color` | Disable ANSI |

# Exit behaviour

A `stuck` packet stops the loop, promotes the question to `decisions[]`, and exits **2**.
Answer headlessly per [Answer decisions](/playbooks/answer-decisions.md).

# Programmatic API

`@clive.shirley/accord-cli` exports command runners (`runResumeCommand`, `createHarness`, …) and
presets (`PI_EXEC_HARNESS`, `CLAUDE_CODE_EXEC_HARNESS`, `CURSOR_AGENT_EXEC_HARNESS`). Used by
Pi `cli-client.ts` and MCP `mcp-orchestrate-host.ts`.
