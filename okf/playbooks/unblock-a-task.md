---
type: Playbook
title: Unblock or force-block a task
description: Decide each blocker (note/fixed/accept/waive) to recover a task blocked by a loop cap, or deliberately stop a non-converging loop.
tags: [block, unblock, retries, review-loop]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: help
    resource: /packages/accord-core/src/commands/help.ts
    title: /dev help (block/unblock)
  - id: policy
    resource: /packages/accord-core/src/orchestration/policy.ts
    title: Retry and unblock limits
  - id: block-cmd
    resource: /packages/accord-cli/src/commands/block.ts
    title: accord block
  - id: unblock
    resource: /packages/accord-core/src/queries/unblock-task.ts
    title: Per-blocker unblock
---

# Trigger

- A task is `blocked` because a loop hit its cap: `review-test` / `review-code` findings exhausted
  `max_critical_retries` (quick-fix `max_test_review_loops`), `max_rgr_respawns`, or the verify loop
  (`verify_loop.max_retries`).
- A test-runner crash (`control.blocked.kind: crash`) or a manual `/dev block`.
- A test↔review loop is visibly not converging and you want to stop it now.

# Force-block

```
/dev block PROJ-1234 2 stuck in adversarial test/review loop
accord block PROJ-1234 2 stuck in adversarial test/review loop
```

Task ID must be numeric; reason is free text. Logged as `<round>/block` (human).

# Unblock

1. See what is blocking: the task file `summary` (`headline`, `next`, `blockers`) or
   `accord trace PROJ-1234 --task N --open` (requirement → finding → history).
2. Decide each blocker (reason required; recorded in the finding's history and the log):

   | Decision | Flag | Effect |
   |----------|------|--------|
   | Guide the agent | `--note F-7 "…"` | Still gating; note appears in the fixer's next brief |
   | I fixed it | `--fixed F-7 "…"` | `addressed`; the raising reviewer rechecks it |
   | Accept wont_fix / dispute | `--accept F-8 "…"` | Closed, no longer gating |
   | Waive a finding / AC | `--waive F-9 "…"` / `--waive AC-3 "…"` | Closed / AC excluded from gates |

3. Run (interactive walk in a TTY or Pi when no flags are given):

   ```
   accord unblock PROJ-1234 --task N --note F-7 "use a table-driven case" --accept F-8 "covered by e2e"
   accord resume PROJ-1234
   ```

Outcomes: every blocker accepted/waived → the loop's gate passes (advance as a clean decision; no
unblock budget used). Blockers remain → that loop's `used` counter resets, `unblocks += 1`, next
round opens (straight to the reviewer when every remaining blocker was `--fixed` by you).

Refused: lifetime cap for that loop (`max_lifetime_retries`, never reset), `max_unblocks_per_task`
exhausted (default 1), or a **blind unblock** — blockers remain, none decided, working tree
unchanged since the block — unless `--force "reason"`. Past the caps: accept/waive, replan, or
amend the spec. Crash / manual blocks release without using budget.

Optionally loosen `orchestration.review_loop.severity_gate` ([policy](/references/orchestration-policy.md)).
