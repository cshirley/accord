# Using ACCORD tooling from any harness or CI

The logic lives in `accord-core`. Pi extensions are thin adapters. Every other
harness, and CI, uses the same capabilities through these CLIs:

| CLI | Purpose | Exit codes |
|-----|---------|------------|
| `accord-guardrail check "<cmd>" [--json]` | Classify a shell command | 0 allow, 1 ask (medium), 2 deny (high) |
| `accord-guardrail hook claude` | Claude Code `PreToolUse` hook (JSON on stdin) | 0 |
| `accord-notify "<msg>"` / `hook claude` | OSC 9 terminal notification, tmux-aware | 0 |
| `gdoc-md <url\|id> [-o out.md] [--json]` | Google Doc to Markdown | 0, 1 error, 64 usage |
| `accord-tools list\|describe\|run` | git/gh/Jira/Slack/Google tool defs as JSON | 0, 1 tool error, 64 usage |

Install locally with `bun run install:shim` (installs all shims to `~/.local/bin`).
In CI, run the entry files directly: `bun packages/accord-cli/src/guardrail-main.ts ...`.

## Claude Code

`~/.claude/settings.json` (or `.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "accord-guardrail hook claude"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": "accord-notify hook claude"}]}]
  }
}
```

## Headless agents in CI

Skills and `AGENTS.md` are shared (`~/.agents/`), so headless runs behave like local ones:

```bash
claude -p "Run accord-tools run repo_verify and summarise failures"
codex exec "Use accord-tools run gh_ci_context --json-input '{...}' to triage CI"
```

Gate a command list in any job:

```bash
accord-guardrail check "$CMD" || { echo "blocked by guardrail"; exit 1; }
```

`accord-tools` runs without a pi session. Jira, Slack and Google tools need
credentials in `~/.pi/agent/service-auth.json` or `AI_TOOLS_AUTH_PATH`.
Session-scoped `wt_*` worktree tools are pi-only; use `git worktree`.
