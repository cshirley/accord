---
type: Playbook
title: Optimise agent token usage
description: Keep context small and spawn cost low when working in or with this repo — always-on context, session hygiene, scoped verification, delegation.
tags: [tokens, context, cost, subagent, verification]
status: stable
generated: { by: agent:pi, at: 2026-11-12T00:00:00Z }
sources:
  - id: agents-md
    resource: /AGENTS.md
    title: Always-on rules and OKF routing table
  - id: check-changed
    resource: /scripts/check-changed.ts
    title: Scoped inner-loop check
  - id: thrift
    resource: /packages/pi-thrift/README.md
    title: pi-thrift token reduction
  - id: package-json
    resource: /package.json
    title: Root scripts
---

# Always-on context

- `AGENTS.md` loads every session. Keep it a router into `okf/`; put detail in a concept, not there.
- Read `okf/index.md` → one index → only the concepts you need. Do not load the whole bundle or `docs/`.
- Prefer `rg` with a narrow path, and `read` with `offset`/`limit`, over whole-file reads.
- Agent prompts under `packages/accord-assets/agents/accord/` are paid on every spawn. Add rules to a shared reference, not to each prompt.

# Session hygiene

- One session per ticket or phase. Compact below 50% context.
- Resume with `dev_work_item_status` / `dev_trace` / `dev_resume_state`, not by reading `.tasks/*.json`.
- Enable `/tp on` (pi-thrift) to fold large tool output; use `thrift_recall` to recover elided text. Check `/tp stats`.
- Do not paste command output back into the chat. Quote only the failing lines.

# Scoped verification

- Inner loop: `bun run check:changed` runs Biome on changed files, tests for changed test files and touched packages, and `validate:okf` when `okf/` changed. Add `--types` for `tsc`.
- Single target: `bun test <file>`, `bunx biome check <files>`.
- Before commit or PR: run `bun run check` once (see [Verify a change](/playbooks/verify-a-change.md)).
- Do not run `check:biome:fix` repo-wide; fix only the files you touched.

# Delegation

- Give each subagent a self-contained, minimal `task`: ticket id, file paths, acceptance criteria. Do not paste file contents it can read.
- Set a `response` schema so the return packet is small and structured.
- Run independent tasks in one `parallel` call instead of serial spawns.
- Keep adversarial loops at their cap (default 3); use `/dev unblock` rather than extra rounds.
