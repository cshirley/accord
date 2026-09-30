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
  - id: answer
    resource: /packages/accord-core/src/queries/answer-decision.ts
    title: answer / dev_answer
---

# Trigger

- Resume halts with pending questions, or `accord` exits `2` (stuck).
- Pi notifies pending decisions at end of turn / status bar shows a count.
- Resume refuses to spawn `phase-test`, `phase-code`, `review-test`, `review-code`, `phase-verify-task` because of pending decisions.

# Steps

## Interactive (Pi)

```
/dev answer PROJ-1234                    # list pending decisions (/dev review shows the whole queue)
/dev answer PROJ-1234 q1 "Use a new method"
```

Answer every pending item (repeat `<id> "answer"` pairs in one call), then `/dev resume PROJ-1234`.

## Headless

1. `accord answer PROJ-1234` — lists pending decisions (`accord tasks` also shows them).
2. Answer one or more in a single, all-or-nothing call:

   ```
   accord answer PROJ-1234 q1 "Use a new method" phase-code-stuck-1 "Test defect; fix the test"
   ```

   This sets `"status": "resolved"`, `"answer"` and `"resolved_at"` on each entry under the work
   item lock. An unknown id, empty answer or already-resolved entry fails the whole call without
   writing; `--force` overwrites an existing answer.
3. `accord resume PROJ-1234` (or the specific phase, e.g. `accord spec PROJ-1234`).

Pi: `/dev answer PROJ-1234 q1 "…"` is identical. Agents use the `dev_answer` tool (only with the
user's answers). Hand-editing `.tasks/PROJ-1234.json` still works but is no longer needed.

The checkpoint's `answered`/`pending` lists are a derived cache — editing `decisions[]` alone is
enough.

# Bypass

If a pending decision is unrelated to the next task:
`/dev resume PROJ-1234 --allow-pending-decisions` (CLI flag identical).

# Not a decision

A `verify.json` verdict of `gaps` creates no `decisions[]` entry — fix the failing ACs and run
`/dev check PROJ-1234`.
