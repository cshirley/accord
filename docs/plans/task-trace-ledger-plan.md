# Task trace ledger — per-task JSON v2 (plan)

Status: **implemented** (branch `wt/task-trace-v2`; reference concept `okf/references/task-file.md`) · Owner: harness core · Touches: `packages/accord-core` (schemas, orchestration, briefing, work-items), `packages/accord-assets` (agent prompts), `packages/accord-cli` / `pi-accord` / `accord-mcp` (thin render adapters), `okf/`.

## 1. Problem

`.tasks/<ID>-task-<N>.json` is an append-only audit dump. Reading it answers "what did the last agent say", not "what happened to **AC-15** across the test↔review loop". Evidence from `emed-vaas-vlab/.worktrees/CLD-4380/.tasks/CLD-4380-task-1.json` (131 KB, one task, blocked after 3 review-test rounds):

| # | Defect | Evidence | Consequence |
|---|--------|----------|-------------|
| D1 | No anchor to spec/plan | Only `ac_covered: [AC-9, AC-14, AC-15, AC-16]` at top level; plan task's TCs (TC-9/12/15/16) appear only in prose | Human cannot pivot "show me everything about AC-15" |
| D2 | `ref` is overloaded | Findings carry `ref: "AC-9"` **or** `ref: "TC-12"` — never both | Same requirement split across two keys; TC→AC link lives only in `spec.json#/verification/test_cases` |
| D3 | Findings have no identity | `review_responses[]` link back via paraphrased `issue` text + `ref` | Can't tell whether round-3 finding is new, re-raised, or the same root cause; reviewer can "move goalposts" undetected |
| D4 | Loop history is overwritten | `last_review_feedback` and `review_responses` replaced each round; history only survives inside `agent_returns[].packet` | Retry brief shows only the latest round; adversarial agents never see what was already tried/disputed per requirement |
| D5 | Two unlinked timelines | `events[]` and `agent_returns[]` share no round/attempt id | Deviation "Round-3 edits…" can't be joined to the review it answered |
| D6 | Agent-supplied timestamps | Deviation `at: 2025-06-02…`, `16:05` deviation before `15:58` applied event | Chronology is untrustworthy |
| D7 | Duplicated data | Findings stored in packet **and** `last_review_feedback.findings` **and** `last_review_feedback.packet`; `test_output` top-level + every packet; `quick_fix_loop` mirrors `review_loop` | File size, drift, ambiguity over which copy is authoritative |
| D8 | Asymmetric loops | phase-test returns `review_responses[]`; phase-code (answering review-code/review-security) returns none; `files_changed` not persisted | Code loop is less traceable than test loop |
| D9 | No open/closed view | Final blocked round's 8 findings have no status; earlier "fixed" ones never marked "verified" | `/dev unblock` user must diff packets by hand |

## 2. Goals / non-goals

**Goals**
- G1: Every finding, response, and verification traces to a **requirement** (`AC-*`, via `TC-*`) from `spec.json`, through the **plan task** in `plan.json`.
- G2: Stable **finding IDs** that survive rounds; every response/recheck references one.
- G3: One chronological **log** of agent runs, harness decisions, and human actions, grouped by round.
- G4: **Human readable + actionable**: opening the file answers "what state is this in, what's blocking, what do I do next" in the first ~20 lines, then requirement → findings → history top-down, without cross-referencing other files.
- G5: Retry briefs show per-requirement trees (open findings + what was tried) instead of the last raw packet.
- G6: **Recoverable**: the file alone (plus sidecars) lets the harness resume the agent loop after a crash, a lost return packet, or a fresh session — no heuristics.

**Non-goals**: backward compatibility with v1 task files (no migration — see P6); changing loop caps/policy semantics; multi-task cross-requirement analytics (follow-up).

## 3. Proposed structure (task file v2.0)

### 3.1 Principles

1. **Read order = priority.** Top of file: what state, what's blocking, what to do next. Then the loop control state. Then requirements. Timeline last.
2. **Facts + snapshot.** Facts (changes, findings, history, log, counters) are appended/updated by post-result handlers. Snapshot fields (`summary`, requirement `status`, finding `state`) are **recomputed by one pure `refresh(task, spec, plan, config)` on every write**, inside the same locked write. Never hand-edited, so they can't drift; tests assert `refresh(refresh(x)) == refresh(x)`.
3. **Self-contained for humans.** One-line AC text and task title are copied in from spec/plan at seed time (read-only), so the file reads without opening `spec.json`.
4. **Explicit loop state for recovery.** Phase, gates, counters, and the in-flight agent run are stored, not derived — recovery never replays.
5. **Stored once.** Finding text lives only under its requirement; the log references finding IDs. Raw packets / test output live in sidecars.
6. **Self-describing refs.** `<loop><n>/<actor>` where loop is `T` (test loop), `C` (code loop), `V` (verify) — e.g. `T2/phase-test`, `C1/review-security`, `C1/decision`, `T3/unblock`. Numbering is per loop. Each actor appears at most once per round; re-running the loop head opens a new round (§3.9).
7. Harness owns IDs and timestamps; agent-supplied times are discarded.

### 3.2 Layout

```jsonc
{
  // ── 1. Header ─────────────────────────────────────────────────────
  "schema_version": "2.0",
  "work_item": "CLD-4380",
  "task": 1,
  "title": "Jest scaffolding, redis dependency, coverage gate, and presence-gated cache config",
  "plan": "docs/dev/CLD-4380/plan.json#/tasks/0",
  "spec": "docs/dev/CLD-4380/spec.json",

  // ── 2. Summary (snapshot — what a human reads first) ──────────────
  "summary": {
    "headline": "BLOCKED in review-test: retry cap reached (3/3). 2 critical + 5 warning findings open on AC-14, AC-15, AC-16, TC-9.",
    "updated": "2026-09-29T11:01:29Z",
    "requirements": { "satisfied": 0, "open": 3, "covered": 1, "pending": 0 },
    "next": {
      "who": "human",                      // agent | human | harness
      "why": "Review-test retry cap reached (3; severity_gate=block)",
      "do": [
        "Fix the blocking findings below, or accept/waive them",
        "accord unblock CLD-4380 --task 1   (or: --accept F-025 \"reason\" | --waive F-025 \"reason\")",
        "accord resume CLD-4380"
      ]
    },
    "blockers": [
      { "finding": "F-025", "ac": "AC-15", "severity": "critical", "issue": "collectable guard reads project-level collectCoverageFrom, which Jest 29.7 discards" },
      { "finding": "F-026", "ac": "AC-15", "severity": "warning",  "issue": "threshold key validated textually, never proven to fire" }
    ]
  },

  // ── 3. Loop control (what the harness needs to resume) ────────────
  "control": {
    "owner_nonce": "a1b2c3",
    "phase": "review-test",
    "status": "blocked",                   // pending | in_progress | blocked | done
    "pre_impl_gates": "pending",
    "round": "T4",
    "in_flight": null,                     // or { "ref": "T5/phase-test", "stage": "spawned|returned", "at": "…" }
    "retries": {
      "test_review": { "used": 3, "lifetime": 3 },
      "code_review": { "used": 0, "lifetime": 0 },
      "rgr":         { "used": 0, "lifetime": 0 },
      "verify":      { "used": 0, "lifetime": 0 },
      "unblocks": 0
    },
    "test_files": ["packages/vlab-authorizer-api/src/lib/caching/__tests__/store-config.test.ts"],
    "stub_files": ["packages/vlab-authorizer-api/src/lib/caching/store.ts"],
    "last_test_run": { "ref": "T4/phase-test", "red": "behaviour", "output": "T4-phase-test.output.txt" },
    "quick_fix_contract": null
  },

  // ── 4. Requirements (AC → changes → findings → history → verification)
  "requirements": [
    {
      "id": "AC-15",
      "text": "MUST: npm run test fails when the caching module is below 80% coverage",
      "test_cases": ["TC-15"],
      "status": "open",                    // pending | covered | open | implemented | satisfied | waived  (snapshot)
      "changes": [
        { "file": "…/__tests__/store-config.test.ts", "action": "add", "kind": "test", "by": "T1/phase-test",
          "tests": ["AC-15 coverage threshold lives on root config"] }
      ],
      "findings": [
        {
          "id": "F-005",
          "state": "verified",             // snapshot of last history outcome
          "severity": "critical",
          "tc": "TC-15",
          "issue": "Path-scoped 80% coverageThreshold has no test at all",
          "file": "…/store-config.test.ts",
          "detail": { "category": "inventory", "evidence": "…", "recommendation": "…" },
          "raised": "T1/review-test",
          "history": [
            { "by": "T2/phase-test",  "fixed":    "Added static threshold assertion…" },
            { "by": "T2/review-test", "reraised": "Key-substring check can't prove the gate fires", "severity": "warning" },
            { "by": "T3/phase-test",  "fixed":    "Assert on resolved globalConfig via readConfigs…" },
            { "by": "T3/review-test", "verified": "" }
          ]
        },
        {
          "id": "F-025",
          "state": "open",
          "severity": "critical",
          "tc": "TC-15",
          "issue": "Collectable guard reads project-level collectCoverageFrom, which Jest 29.7 discards",
          "file": "…/store-config.test.ts",
          "detail": { "category": "adversarial", "evidence": "…", "recommendation": "…" },
          "raised": "T4/review-test",
          "history": []
        }
      ],
      "verification": null                 // set only by phase-verify-task: { "by": "V1/phase-verify-task", "result": "pass", "tests": [...] }
    },
    { "id": "_task", "text": "Changes/findings not attributable to one AC", "status": "n/a", "changes": [], "findings": [] }
  ],

  // ── 5. Log (chronological, newest last; references only) ──────────
  "log": [
    { "ref": "T1/phase-test",  "at": "2026-09-28T15:14:56Z", "result": "done",   "note": "8 tests RED (import-only)",
      "events": [{ "type": "deviation", "ac": ["AC-9"], "text": "Reused existing untracked test file…", "reason": "Avoid discarding spec-aligned work" }] },
    { "ref": "T1/review-test", "at": "2026-09-28T15:34:30Z", "result": "issues", "note": "Check 0 fails; 7 critical, 6 warning, 1 suggestion → F-001…F-014" },
    { "ref": "T1/decision",    "at": "2026-09-28T15:34:30Z", "result": "retry",  "note": "7 critical ≥ gate block → phase-test (test_review 1/3)" },
    …
    { "ref": "T4/review-test", "at": "2026-09-29T11:01:29Z", "result": "issues", "note": "1 critical, 5 warning, 2 suggestion → F-025…F-032; F-015…F-024 verified" },
    { "ref": "T4/decision",    "at": "2026-09-29T11:01:29Z", "result": "blocked", "note": "Review-test retry cap reached (3; severity_gate=block)" }
  ]
}
```

Sidecars `.tasks/<ID>-task-<N>/`: `<round>-<actor>.json` (full validated packet + analysis), `<round>-<actor>.output.txt` (test/verify output). Write-once, named from the ref, so no path fields needed beyond `last_test_run.output` convenience.

### 3.3 Finding lifecycle

```
review raises ──► open ──(fixed)──────► addressed ──(recheck)──► verified
                   │                        └──────────────────► reraised ─► same ID, gates again
                   ├──(disputed)──► disputed ──(recheck)──► dispute_upheld | reraised
                   └──(wont_fix)──► wont_fix_proposed ──(reviewer accepts | accord unblock --accept)──► wont_fix_accepted
                                                └──(reviewer rejects)──► reraised
   human: waived (accord unblock --waive F-n|AC-n "reason")     harness: superseded (merged root cause)
```
History entries use the outcome as key (`{"by": "T2/phase-test", "fixed": "note"}`) — one line each when read raw.

**Gating** = `open | reraised | disputed | wont_fix_proposed` at or above `severity_gate`. `wont_fix_proposed` gates until accepted — an agent can't self-clear. Decision semantics (`decideAfterReviewTest/Code`) unchanged; input is gating findings from the requirements tree.

### 3.4 Requirement status

| Status | When (computed by `refresh`) |
|--------|------------------------------|
| `pending` | no changes yet |
| `covered` | ≥1 test change attributed, no gating findings |
| `open` | any gating finding |
| `implemented` | code change attributed + no gating findings + review-code clean |
| `satisfied` | **only** phase-verify-task `evidence[]` with `result: pass` + named tests |
| `waived` | human waiver |

Work item cannot hand off while any MUST requirement ≠ `satisfied | waived`.

### 3.5 `summary.next` rules

| Condition | `who` | `do` |
|-----------|-------|------|
| `in_flight.stage = spawned` | harness | "Awaiting `<ref>`; if the session died: `accord resume`" |
| `in_flight.stage = returned` | harness | "Return received but not applied: `accord resume` re-applies from sidecar" |
| status `blocked` (cap) | human | fix / `--accept` / `--waive` blockers, `accord unblock`, `accord resume` |
| status `blocked` (crash, escalation) | human | the crash reason / escalation question, then unblock + resume |
| status `blocked` (verify cap) | human | failing ACs + their verify findings; fix / `--waive AC-n`, `accord unblock`, `accord resume` |
| any `wont_fix_proposed` blocker awaiting human | human | `accord unblock --accept F-n` or reject |
| otherwise | agent | "`accord resume` spawns `<next agent>` for round N" |

`blockers[]` = gating findings (≤10, severity-sorted, one line each; full text is under the requirement). `advisories[]` = open security + below-gate findings (≤10, one line each) — shown, never block.

### 3.6 Recovery (G6)

| Failure | State used | Harness behaviour |
|---------|-----------|-------------------|
| Session/process dies after spawn | `in_flight {stage: spawned}` | Resume respawns the **same ref**; no round/counter consumed |
| Subagent exits without packet | `in_flight` + packet absent | Same as above (replaces `recover-task-packet.ts` heuristics) |
| Packet received, crash before post-result applied | `in_flight {stage: returned}` + sidecar packet | Re-run post-result handler from sidecar; idempotent by ref (a ref already in `log` is never applied twice) |
| Crash after apply, before next spawn | `control.phase/status` | Normal resume |
| Fresh session / new agent context | `control.test_files/stub_files/last_test_run` + requirements tree | Brief rebuilt entirely from the file + sidecars |
| Blocked | `control.status` + `summary.next` | Human acts; `accord unblock` resets `retries.*.used`, bumps `unblocks`, appends `<round>/unblock` |
| Concurrent writers | Existing `advancePrimaryTask` lock | Unchanged; `refresh` runs inside the lock |

Write protocol per agent run: (1) before spawn: set `in_flight {spawned}`; (2) on return: write sidecar, set `in_flight {returned}`; (3) post-result: append log entry, mutate facts, clear `in_flight`, `refresh` — steps 3's mutations are one locked write.

### 3.7 Contract changes (return schemas)

| Schema | Change |
|--------|--------|
| `return-schemas/phase-test.json` | Required `changes[]`: `{file, action: add\|modify\|delete, kind: test\|stub\|fixture\|config, ac_ids[], tc_ids?[], tests?[]}`. Retry: `review_responses[]` `{finding_id, resolution: fixed\|disputed\|wont_fix, note}`. Remove `test_files`/`stub_files`/`ac_covered` (derived from `changes`). |
| `return-schemas/phase-code.json` | Required `changes[]` (`kind: code\|config\|dep`); remove `files_changed`/`ac_covered`. Add `review_responses[]` for review-code / review-security findings. |
| `return-schemas/review.json` | findings: `ac_id` (omit only if cross-cutting → `_task`), `tc_id?`, `also_affects?[]`, `finding_id?` (re-raise). New `rechecks[]` `{finding_id, outcome: verified\|reraised\|dispute_upheld\|wont_fix_accepted, note?, severity?}`. Remove `ref`. |
| `return-schemas/phase-verify-task.json` | `evidence[]` `{ac_id, result: pass\|fail, tests[], command?}`; remove `ac_covered`. |
| `task_event` | `ac_ids?`, `finding_ids?`; no agent `at`. |

**Finding → AC**: reviewer brief contains each AC's `changes[]`; reviewer infers `ac_id` from `file`. Harness fallback: same file→AC map; ambiguous → `_task` + footer warning. Other fallbacks: `tc_id` → AC via `spec.verification.test_cases[].covers`; response without `finding_id` → match `(ac_id, file)` then issue similarity, else recorded on the log entry as `unlinked` + warning; prior gating finding not rechecked → state unchanged + warning.

### 3.8 Briefs and CLI

- Retry briefs (`appendReviewFeedbackToResumeBrief`) render the requirements tree: per AC, `changes`, gating findings with `history`, verified findings collapsed to IDs. Reviewers get the same view (replaces `phase_test_review_responses`) and recheck by ID.
- `accord trace <ID> [--task N] [--open]` (+ `/dev trace`, `dev_trace` MCP): pretty-prints `summary` + requirements tree + log. The raw file is already readable; this is colour + filtering.
- `accord unblock <ID> --task N [--accept F-n | --waive F-n|AC-n] "reason"`.

### 3.9 Loop coverage (test, code, RGR, verify)

One structure serves every loop; they differ only in actors, gate owner, and which counter a retry consumes.

| Loop | Round prefix | Head (fixer) | Reviewers in round | Gate decided by | Retry counter | Exit |
|------|--------------|--------------|--------------------|-----------------|---------------|------|
| Test (pre-impl) | `T` | phase-test | review-test | review-test findings | `test_review` | no gating → `pre_impl_gates: complete`, open `C1` |
| Code | `C` | phase-code | review-security (sensitive paths) → review-code | review-code findings only (security is **advisory**) | `code_review` | no gating → `V1` (or `done` if verify not configured) |
| RGR bounce | new `T` | phase-test | review-test | as test loop | `rgr` + `test_review` | back to a new `C` round |
| Verify | `V` | phase-verify-task | — (verify-fail findings go through a full `C` round: phase-code → review-security → review-code) | any `evidence[]` fail | `verify` (cap 3, then block for human) | all pass → `done`, requirements `satisfied` |

Example flow on one task: `T1 → T2 → C1 → C2 → T3 (RGR) → C3 → V1 (fail) → C4 → V2 (pass)`.

Rules that make the shared model hold:

1. **Findings are loop-agnostic.** A finding records who raised it (`raised: "C2/review-code"`); the loop is visible from the prefix. Test- and code-loop findings on the same AC sit side by side under that requirement, so a reader sees the full adversarial history for the AC.
2. **Recheck authority = raiser.** Only the agent type that raised a finding (or a human) can move it to `verified` / `dispute_upheld` / `wont_fix_accepted`. review-test rechecks test findings; review-code rechecks code findings; review-security rechecks its own on the next `C` round; phase-verify-task rechecks verify findings on the next `V` round (re-running the failing tests).
3. **Respondent = the head of the raiser's loop.** Test findings → phase-test; review-code / review-security / verify findings → phase-code. Briefs include only findings the spawned agent must answer.
4. **Gating is per loop.** A `T` decision considers only gating findings raised in `T` rounds; a `C` decision only `C`/`V` ones. Findings below the gate at loop exit stay `open` with `advisory: true` (visible, not in `blockers`, not blocking `satisfied`).
5. **RGR = a finding.** phase-code `test_issue` events (or test files appearing in phase-code `changes[]`) become findings raised by `Cn/phase-code` (category `test_issue`) under the affected AC, answered by phase-test in the next `T` round and rechecked by review-test. `pre_impl_gates` resets to `pending`; `retries.rgr` bumps.
6. **Verify loop is adversarial.** Each `evidence[]` entry with `result: fail` raises a gating finding from `Vn/phase-verify-task` under that AC (issue = failing test(s), evidence = output excerpt; full output in sidecar). `Vn/decision` opens a new `C` round: phase-code responds by `finding_id`, review-security (advisory) and review-code run as usual (the inner code loop keeps its own `code_review` cap), then `V(n+1)` re-verifies and rechecks. Each V-fail → C bounce consumes `retries.verify`; at `orchestration.verify_loop.max_retries` (default **3**, plus `max_lifetime_retries`) the task **blocks for a human** — same unblock/accept/waive semantics as the other loops. Pass sets `requirements[].verification` and marks verify findings `verified`.
7. **Security is advisory, but never lost.** review-security findings never gate, never consume a retry, and never appear in `blockers` — they are listed in `summary.advisories`. They persist under their AC (today `review-code` overwrites them and `readLastReviewFeedback` drops `review-security` entirely), appear in phase-code's next brief, and phase-code should respond (`fixed | disputed | wont_fix`); an unanswered security finding is a footer warning, not a block. Any `critical` security finding still open at hand-off is surfaced in the work-item summary.
8. **Quick-fix** seeds one requirement `QF` from `quick_fix_contract.plan.summary` (no spec ACs); loops identical, test loop uses `orchestration.quick_fix_loop` caps.
9. **Requirement status per loop:** `covered` after `T` exits; `implemented` when the latest `C` round's review-code verdict is non-gating and the AC has no gating `C` findings; `satisfied` only from `V`.

### 3.10 Human unblock

A block is resolved **per blocker**, and every human decision is recorded in the finding's `history` + log, so the next agent round sees it.

**1. See what's blocking** — top of the task file (`summary.next`, `summary.blockers`) or `accord trace CLD-4380 --task 1 --open`.

**2. Decide each blocker** (one flag per finding, repeatable; reason required):

| Action | Command | Effect on finding | Next round |
|--------|---------|-------------------|------------|
| Guide the agent | `--note F-025 "use readConfigs in child process, not project config"` | stays gating; `history += {by: "T4/unblock", note}` | Note is in the fixer's brief under that finding |
| I fixed it myself | `--fixed F-025 "moved threshold to root config"` | `addressed` | Raiser rechecks it like an agent fix |
| Accept agent's `wont_fix` / dispute | `--accept F-026 "textual check is sufficient here"` | `wont_fix_accepted` / `dispute_upheld` → not gating | — |
| Waive a finding | `--waive F-027 "out of scope, ticket CLD-4400"` | `waived` → not gating | — |
| Waive a requirement | `--waive AC-15 "coverage gate moved to CLD-4401"` | AC `waived`; its findings `waived` | AC excluded from gates + hand-off check |
| Crash / escalation block | fix the environment or answer the decision (`accord decide …`), then `accord unblock` | — | Head agent reruns |

**3. Unblock** — the same command applies the decisions and resumes:

```bash
accord unblock CLD-4380 --task 1 \
  --note  F-025 "use jest-config readConfigs in a child process" \
  --accept F-026 "textual key check is acceptable" \
  --waive F-031 "suggestion, not needed"
accord resume CLD-4380
```

Harness then:
1. Applies each decision (history entry `by: "<round>/unblock"`, actor `human`, reason).
2. `refresh` → recompute gating.
3. **No gating findings left** (everything accepted/waived) → the loop's gate passes: advance as a normal clean decision (e.g. `T` exit → `C1`). **Does not consume** `max_unblocks_per_task` or reset counters.
4. **Gating findings remain** → reset `retries.<blocked loop>.used` (only that loop), `unblocks += 1`, status `pending`, append `<round>/unblock` log entry listing the decisions. Next round opens with human notes in the brief.
5. Refusals (with the reason in `summary.next`):
   - lifetime cap for that loop reached → only accept/waive (step 3) or raising config can proceed;
   - `max_unblocks_per_task` exhausted → same;
   - **blind unblock**: gating findings remain, none has a human decision, and `git diff` shows no change since the block → refuse unless `--force "reason"` (prevents "reset and hope").

**Interactive**: `accord unblock CLD-4380 --task 1` with no flags in a TTY (and `/dev unblock` in Pi via `ctx.ui.select`) walks the blockers one by one: `[n]ote  [f]ixed  [a]ccept  [w]aive  [s]kip`, then confirms. `dev_unblock` (MCP) takes the same decisions as structured args: `{decisions: [{target: "F-025", action: "note", reason}]}`.

**Why this is better than today**
- Blocks cleared by judgement (accept/waive) don't burn retry budget.
- Human guidance reaches the agent through the finding it relates to, not a chat message.
- The trace shows who closed each finding and why — agent, reviewer, or human.

## 4. Implementation plan

Each phase ships green (`bun run check`). RGR: tests first per phase.

### P1 — Schema + types (1 d)
- `packages/accord-core/schemas/task-schema.json` → v2.0 only (v1 definitions removed).
- `schemas/examples/task-v2.example.json` (CLD-4380-derived).
- `work-items/types.ts`: `TaskFile`, `TaskSummary`, `TaskControl`, `Requirement`, `Change`, `Finding`, `FindingState`, `HistoryEntry`, `LogEntry`, `InFlight`.

### P2 — Pure task model (2.5 d)
`packages/accord-core/src/tasks/model/` (no I/O):
- `seed.ts` — `seedTask(workItem, planTask, spec)`: header, `requirements[]` (text + TCs from spec), `_task`, `control` defaults (from profile `preImplGates`).
- `refs.ts` — ref build/parse, round rules, finding ID allocation, `findFinding(task, id)`.
- `attribute.ts` — `applyChanges`, `fileToAcMap`, `resolveFindingAc`.
- `apply.ts` — `applyReview`, `applyResponses`, `applyRechecks`, `applyVerification`, `appendLog`, `humanUnblock/Accept/Waive`.
- `refresh.ts` — finding `state`, requirement `status`, `summary` (headline, counts, `next`, `blockers`); idempotent.
- `gate.ts` — gating findings → `decideAfterReviewTest/Code` (signature only).
- Tests: replay CLD-4380's 8 returns → golden file; lifecycle cases (re-raise with/without ID, dispute upheld, wont_fix accept/reject/human, multi-AC file, unlinked response, import-only RED, crash, `satisfied` only after evidence); **synthetic full-flow fixture `T1→T2→C1(security+code)→C2→T3(RGR)→C3→V1(fail)→C4→V2`** asserting per-loop gating, counters, recheck authority, respondent routing, advisory findings, security findings reaching phase-code; `refresh` idempotence; `summary.next` table.

### P3 — Persistence, writers, recovery (2.5 d)
- `work-items/io.ts`: sidecar dir + write-once helper; `loadTaskFile` rejects `schema_version != "2.0"` with remediation (P6).
- In-flight protocol (§3.6) in spawn + `subagent/result/process.ts`; delete `orchestration/recover-task-packet.ts` (replaced).
- Rewrite `orchestration/task-agent-audit.ts`, `orchestration/review-feedback.ts` (remove `last_review_feedback`, `agent_returns`, `review_loop`, `quick_fix_loop`), `post-result/{phase-test,review-test,phase-code,review-code,review-security,phase-verify-task}.ts`, `quick-fix.ts`, `briefing/{code-brief,sync-task-owner-nonce}.ts` to use `control` + model fns; every write ends with `refresh`.
- `queries/{block-task,work-item-status,dashboard-hints}.ts`, `orchestration/resolve/primary-task.ts`: read `control`/`summary`.
- `queries/unblock-task.ts` rewrite per §3.10: decision parsing (`--note/--fixed/--accept/--waive/--force`), apply-then-gate (no budget use when all blockers resolved), per-loop counter reset, blind-unblock guard (git diff since block ref), refusals surfaced in `summary.next`.
- Handoff gate: MUST requirements `satisfied | waived`.
- `post-result/phase-code.ts`: RGR path raises `test_issue` findings (§3.9 rule 5). `post-result/review-security.ts`: findings persist to ledger (fixes security feedback being overwritten/dropped). `post-result/phase-verify-task.ts`: fail evidence → gating findings, `retries.verify` bump, new `C` round; cap → `blocked` (§3.9 rule 6); `review-code` exit routes to `V` when verify configured.
- New config `orchestration.verify_loop` `{max_retries: 3, max_lifetime_retries}`: `config/types.ts`, `config/global.ts` merge, `schemas/accord-schema.json`, `orchestration/policy.ts` (`verifyRetryPolicy`), `decideAfterVerify`; `unblock-task.ts` resets `retries.verify.used`.
- Security advisory: `review-security` findings excluded from `gatingFindings`; `summary.advisories` in `refresh`.

### P4 — Contracts + prompts (2 d)
- Return schemas per §3.7.
- Prompts in `packages/accord-assets/agents/accord/`: `phase-test.md`, `phase-code.md` (`changes[]` with `ac_ids`; responses by `finding_id`; when `wont_fix` is legitimate), `review-test.md`, `review-code.md`, `review-security.md` (infer `ac_id` from change map; `rechecks[]` incl. wont_fix accept/reject), `phase-verify-task.md` (`evidence[]`).
- `manifest.json` / `agents/registry.ts` alignment; `validate:assets`.

### P5 — Briefs (1 d)
- Requirement-tree renderer for retry briefs and reviewer/verify inputs (`briefing/task-requirements.ts`); history capped to last 3 + count.
- Snapshot tests.

### P6 — Cut-over, no migration (0.5 d)
- v1 task file on load → hard error: "Task file is v1. Run `accord task reseed <ID> [--task N]` to re-seed from plan (code in git is kept; loop history/counters reset)."
- `accord task reseed`: archive v1 to `.tasks/archive/`, seed v2 at the task's plan position with `control.phase` = `phase-test` (or `phase-code` if user passes `--from code`).

### P7 — CLI / adapters (1 d)
- `accord-core/queries/task-trace.ts` (`renderTaskTrace`); `accord-cli` `trace` + `unblock` decision flags + interactive walk + `task reseed`; `/dev unblock` interactive via `ctx.ui.select`; `dev_unblock` structured `decisions[]`; `pi-accord` `/dev trace`; `accord-mcp` `dev_trace` (tool-surface registry).
- `accord tasks` dashboard: `summary.headline` + blocker count per task.

### P8 — Docs (0.5 d)
- OKF: `references/artifacts-and-state.md`, `references/schemas.md`, `architecture/crucible-verification.md`, `architecture/orchestration.md` (recovery, verify loop), `references/orchestration-policy.md`, `playbooks/unblock-a-task.md`, `references/accord-cli.md`, `references/dev-command.md`; `okf/log.md`; `validate:okf`.

**Estimate**: ~11 dev-days. Critical path P1→P2→P3. P4/P5 parallel after P2; P6/P7 after P3.

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Agents omit `changes[]` / `finding_id` / `rechecks` | Deterministic fallbacks (§3.7); footer warnings; `_task` bucket / `unlinked` visible |
| Snapshot drift | Only `refresh` writes snapshot fields; idempotence test; `validate` recomputes and diffs in CI tests |
| `wont_fix` used to dodge work | Gates until reviewer/human accepts; lifetime cap unchanged |
| Double-apply on recovery | Post-result idempotent by ref (ref already in `log` → skip) |
| In-flight work items break at cut-over | Explicit error + `accord task reseed`; CLD-4380 needs a reseed |
| File growth over many rounds | Raw in sidecars; finding `detail` holds long text; typical ≤30 KB |
| Verify gate blocks hand-off | `--waive AC-n` escape hatch, recorded in log |
| Verify↔code loop runs long (each bounce is a full C round) | `verify` cap 3 + lifetime cap; inner `code_review` cap still applies |
| Advisory security findings ignored | Listed in `summary.advisories`; critical ones surfaced at hand-off |

## 6. Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Storage shape | Nested under `requirements[]`; task-unique `F-n`; multi-AC via `also_affects` |
| D2 | Raw packets / test output | Sidecar dir `.tasks/<ID>-task-<N>/` |
| D3 | Finding → AC | phase agents report `changes[]` with `ac_ids`; reviewers infer from it; harness falls back to same map |
| D4 | Won't-fix | `wont_fix` allowed; gates until reviewer or human accepts |
| D5 | `satisfied` | Requires phase-verify-task `evidence[]` |
| D6 | Readability vs redundancy | Store snapshot fields (`summary`, `status`, `state`, AC `text`) for readability; recomputed by `refresh` on every write |
| D7 | Recovery | Explicit `control` incl. `in_flight`; post-result idempotent by ref |
| D8 | Compatibility | None; v1 → hard error + `accord task reseed` |
| D9 | Verify failure | Adversarial loop: V-fail → full `C` round → re-verify; `retries.verify` cap 3 then block for human |
| D10 | Security findings | Advisory only: persisted, briefed, response expected, never gate |
| D11 | Human unblock | Per-blocker decisions (note/fixed/accept/waive) recorded in history; all-resolved advances without using unblock budget; blind unblock needs `--force` |

## 7. Implementation notes (deviations from the sketch above)

- History entries use an explicit `outcome` field (`{by, outcome, note?, severity?, actor?}`) rather than outcome-as-key — same readability, simpler typing and schema.
- `requirements[].changes[]` has one entry per (file, kind) with `by: [refs]` (runs that touched it) instead of one entry per run.
- Below-gate findings and all review-security findings carry `advisory: true`; gating ignores them.
- A reviewer that does not re-raise an `addressed` / `disputed` finding closes it implicitly (`verified` / `dispute_upheld`, note "not re-raised"); `wont_fix_proposed` needs an explicit accept.
- Similar re-raises (same AC/file, Jaccard ≥ 0.5 on issue text) keep the prior `F-nnn` id even without `finding_id`.
- `control.blocked.fingerprint` (HEAD + diff hash, excluding `.tasks/`) backs the blind-unblock guard.
- Code layout: `packages/accord-core/src/tasks/{types,model,record,decide,render,seed,store}.ts`; worked example `packages/accord-core/schemas/task-file.example.json` (regenerate with `ACCORD_WRITE_TASK_EXAMPLE=1 bun test ./packages/accord-core/tests/task-trace-v2.test.ts`).

