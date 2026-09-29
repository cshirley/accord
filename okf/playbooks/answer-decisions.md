---
type: Playbook
title: Answer pending decisions
description: Resolve questions raised by needs_input or stuck agents so resume can continue.
tags: [decisions, needs-input, stuck, review-queue]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: cli-doc
    resource: /docs/accord-cli.md
    title: Standalone accord CLI (Answering pending questions)
  - id: stuck
    resource: /packages/accord-core/src/orchestration/post-result/stuck.ts
    title: Stuck promotion
  - id: gate
    resource: /packages/accord-core/src/orchestration/pending-decisions-gate.ts
    title: Pending-decisions gate
---

# Trigger

- Resume halts with pending questions, or `accord` exits `2` (stuck).
- Pi notifies pending decisions at end of turn / status bar shows a count.
- Resume refuses to spawn `phase-test`, `phase-code`, `review-test`, `review-code`, `phase-verify-task` because of pending decisions.

# Steps

## Interactive (Pi)

```
/dev review            # or /dev review PROJ-1234
```

Answer every pending item in one pass, then `/dev resume PROJ-1234`.

## Headless

1. `accord tasks` — lists pending decisions with the file and IDs to edit.
2. Edit `.tasks/PROJ-1234.json` → `decisions[]` entry:

   ```json
   { "id": "q1", "source": "spec", "status": "resolved", "question": "...", "answer": "Use a new method", "resolved_at": "2026-09-28T17:00:00Z" }
   ```

3. `accord resume PROJ-1234` (or the specific phase, e.g. `accord spec PROJ-1234`).

The checkpoint's `answered`/`pending` lists are a derived cache — editing `decisions[]` alone is
enough.

# Bypass

If a pending decision is unrelated to the next task:
`/dev resume PROJ-1234 --allow-pending-decisions` (CLI flag identical).

# Not a decision

A `verify.json` verdict of `gaps` creates no `decisions[]` entry — fix the failing ACs and run
`/dev check PROJ-1234`.
