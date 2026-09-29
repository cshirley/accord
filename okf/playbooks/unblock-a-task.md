---
type: Playbook
title: Unblock or force-block a task
description: Recover a task blocked by review-loop retry caps, or deliberately stop a non-converging loop.
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
---

# Trigger

- A task is `blocked` because `review-test`/`review-code` findings exhausted `max_critical_retries` (or quick-fix `max_test_review_loops`, or `max_rgr_respawns`).
- A test↔review loop is visibly not converging and you want to stop it now.

# Force-block

```
/dev block PROJ-1234 2 stuck in adversarial test/review loop
accord block PROJ-1234 2 stuck in adversarial test/review loop
```

Task ID must be numeric; reason is free text.

# Unblock

1. Read `last_review_feedback` in `.tasks/PROJ-1234-task-N.json`; fix the findings (or adjust spec/plan).
2. Optionally loosen `orchestration.review_loop.severity_gate` ([policy](/references/orchestration-policy.md)).
3. Run:

   ```
   /dev unblock PROJ-1234 [task_id]
   /dev resume PROJ-1234
   ```

Limits: `max_unblocks_per_task` (default 1) resets per task, ever; `max_lifetime_retries`
(default retries × (unblocks + 1)) is a hard ceiling unblock never resets. Past that, replan
or amend the spec.
