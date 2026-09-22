---
name: session-retro
description: Analyze local Pi session logs (jsonl) for tool usage, friction, and skill gaps. Use when the user wants a retro on agentic workflow or monthly Pi hygiene.
disable-model-invocation: true
---

# Session Retro

Offline analysis of Pi sessions under `~/.config/pi/agent/sessions`.

## Run

From the accord monorepo (or anywhere with Bun):

```bash
bun packages/pi-skills/scripts/session-retro.ts
bun packages/pi-skills/scripts/session-retro.ts --json
bun packages/pi-skills/scripts/session-retro.ts --sessions-root ~/.config/pi/agent/sessions
```

## Output

- Session count, user turns, tool calls, estimated cost
- Top tools, bash patterns, projects, intent signals
- Tool error hotspots, harness/subagent adoption
- Actionable gaps (same rubric as product retro)

## Rules

- Read-only — never modify session files.
- Summarize for the user; attach JSON only when they want raw data.
- Suggest new skills/tools from patterns (high bash:read ratio, repeated `gh run view`, low `wt_*` usage).
