---
type: Reference
title: Commit message format
description: Proposed orchestrator commit message - human subject, human body, and one machine-readable `Accord:` trailer of key=value pairs for grep and awk reporting.
tags: [commits, trailers, reporting, awk, evidence, cost, proposed]
status: proposed
generated: { by: agent:pi, at: 2026-10-02T00:00:00Z }
sources:
  - id: plan
    resource: /docs/plans/evidence-stack-plan.md
    title: Evidence stack plan (section 3.2e)
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema (stack.commits)
---

**Proposed.** Used when `stack.commits` is `phase` ([Stack configuration](/references/stack-config.md), [Evidence stack](/architecture/evidence-stack.md)). Full text and extraction script: plan section 3.2e.

# Shape

```
[<ID>][task-<N>] <ref>: <human summary>

<human body: one line per finding or response>

Accord: v=1 id=<ID> task=<N> seq=<n> ref=<ref> agent=<agent> loop=<loop> round=<n> outcome=<outcome> …
```

* `ref` is the harness ref `<round>/<actor>` (`T1/review-test`, `C2/phase-code`, `V1/phase-verify-task`), the same string as the task file `log[].ref`, so a commit joins to its log entry. Subject example: `[FEAT-ASDLC][task-2] T1/review-test: 1 critical, 2 warning`. The trailer wins if they differ.
* One `Accord:` trailer per commit: space-separated `key=value`, integers for counts, no spaces in values, absent keys omitted. Read it with `git log --format='%(trailers:key=Accord,valueonly,unfold)'`.
* Only the orchestrator writes it. Values are measured or validated (usage log, return packets, test run, staged diff), never taken from an agent's claim.

# Keys (`v=1`)

| Group | Keys |
|-------|------|
| Identity | `v id task seq ref agent loop round` |
| Outcome | `outcome` = `red` `green` `findings` `clean` `fixed` `pass` `fail` `blocked` `done` |
| Findings | `crit warn sugg` raised; `open_crit open_warn` open after; responses `addressed disputed wont_fix`; verdicts `verified reraised dispute_upheld wont_fix_accepted waived` (same names as the finding lifecycle in [Per-task file](/references/task-file.md)); `findings fixes` ID lists |
| Tests | `t_pass t_fail t_skip t_ms red` (`assertion` `import` `compile`) |
| Criteria | `ac ac_pass ac_fail` |
| Diff | `files add_src del_src add_test del_test` |
| Model and cost | `harness model spawns tok_in tok_out tok_cache_r tok_cache_w usd_u ms usage` (`usd_u` micro-dollars; summed over every spawn since the previous commit, including retries and failures; `usage` = `host` `self` `missing`) |
| Retry | `retry retry_life` (`control.retries.<loop>` used and lifetime) |

Extensions use an `x_` prefix; consumers ignore unknown keys; `v` changes only for breaking changes. The commit guard checks that the trailer parses, required keys exist, and counts match the staged files.

# Reporting

`accord stack report` renders a per-PR and per-stack roll-up table from the trailers. `accord evidence <ID> --format tsv` exports columns for `awk`. The roll-up is also written to `docs/dev/<ID>/evidence/task-<N>.json`, so it survives squash-merge.
