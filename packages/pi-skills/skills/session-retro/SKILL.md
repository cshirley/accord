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
bun packages/pi-skills/scripts/session-retro.ts --since 2026-11-01   # pilot window only
```

`--since YYYY-MM-DD` keeps sessions whose file name date is on or after it. Run once without it for the baseline, then with it for the pilot, and compare.

## Output

- Session count, user turns, tool calls, estimated cost
- Top tools, bash patterns, projects, intent signals
- Tool error hotspots, harness/subagent adoption
- **Gates** (order-aware per session): edited and never verified; commits made with edits since the last verify; commits before any review; PR submits with no CI check afterwards; first prompts under 100 characters; rework signals ("wrong", "revert", "still not…")
- **Adoption** of the skill scripts: `green.sh` mark, check and review-mark; `wt-guard.sh`; `doc-verify.py`; `adhoc-id.sh` / `accord bootstrap --adhoc`; reads of the `brief`, `reuse-scout`, `risk-checklist`, `doc-verify` and `worktree` skills
- Actionable gaps (same rubric as product retro)

## Rules

- Read-only — never modify session files.
- Summarize for the user; attach JSON only when they want raw data.
- Suggest skills/tools from friction patterns (low `repo_verify`, low `wt_*`, repeated `gh run view`). **Do not** treat high bash+`rg` or bash:read ratio as bad — pi.dev prefers `rg` in bash over the grep/read search tools.
