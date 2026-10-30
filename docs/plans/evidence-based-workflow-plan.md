# Evidence-based workflow — gap plan alongside ASDLC-1

Status: **in progress** (iteration 1 skills and core items done; pilot and deferred items open) · Subordinate to `docs/plans/evidence-stack-plan.md` on branch `wt/FEAT-ASDLC` ([PR #18](https://github.com/cshirley/accord/pull/18), `ASDLC-1`; not yet on `main`).
Owner: skills (`packages/pi-skills`) and harness core for the loop budget.

This plan covers only what ASDLC-1 does **not**. It duplicates nothing in ASDLC-1.
Where ASDLC-1 is the source of truth (commit grammar, evidence asset, contract PR0,
stack compute, tree state, feature knowledge), this plan reuses its formats.

## 1. Why

Session analysis of 461 pi sessions (regex heuristics; patterns, not audited counts):

| Signal | Data |
|--------|------|
| Short opening briefs | median first prompt 174 chars; 142/461 under 100 |
| Rework | ~95 "wrong", 55 "still not…", 37 "missed/forgot", 11 "revert" |
| Edits without verify | 60/145 edit-heavy sessions ran no test/lint/typecheck |
| Commits without review | 49/70 committing sessions |
| PRs without CI check | 13/23 |
| Stale artifacts | 26+ "do we still need X?" prompts |
| Loop incident | Accord adversarial loop continued past retries=3 while run against another repository (a non-accord ticket) |
| Empty subagent output / unexpected default model | `cursor/composer-2.5` |
| Tool errors | ENOENT ~287, non-unique edit `oldText` ~139 |

## 2. What ASDLC-1 already covers (do not rebuild)

| Need | ASDLC-1 feature |
|------|-----------------|
| Squash-safe evidence | `evidence-asset` (`docs/dev/<ID>/evidence/task-<N>.{md,json}` in the final commit) |
| Commit history as evidence log | `commit-evidence` (`Accord:` trailer, one commit per phase, orchestrator-only) |
| Spec and plan in first PR; locked | `contract-lock` (PR0, `contract.lock.json`) |
| Stack sizing, `gh` provider, stack map | `stack-compute` |
| Resume from git; CI-triggered mode | `tree-state`, `ci-driven-mode` |
| Security findings gate | `security-gate` |
| Verify/staleness by contract, not mtime | `contract-lock` + `accord/evidence` check |
| Living feature docs, impact analysis, "do we still need X?" | `feature-knowledge` |
| Decisions and drift | `decisions[]`, alignment markers, `review-deviation` |

## 3. Gaps this plan owns

| # | Gap | Evidence | Why ASDLC-1 does not cover it |
|---|-----|----------|-------------------------------|
| G1 | **Loop budget: cost cap and no-progress detection** | Accord loop run against another repository (a non-accord ticket) went past retries=3 | Attempt caps now exist on `main` (see §6.3); a cost cap and no-progress detection were not found. ASDLC-1 has only a post-GREEN overrun re-plan decision |
| G2 | **Spawn preflight outside pi** (CLI/MCP hosts) | Empty review-code output; wrong default model | Preflight, empty-response handling and no-silent-cursor-substitution exist on `main`; the preflight backend registers only in `pi-accord` (see §6.3) |
| G3 | **Non-harness work** (dotfiles, docs, research, ad-hoc fixes) gets none of the evidence discipline | 142 short-brief sessions; many in `documentation`, `dotfiles`, `eng-practices` | ASDLC-1 only helps work run through accord |
| G4 | **Gates before the harness exists** (verify before commit, review before PR, CI after PR) | 60/145, 49/70, 13/23 | ASDLC-1 is default-off and unimplemented |
| G5 | **Environment guards** (wrong worktree, wrong path, missing-file preflight) | "you are modifying the wrong work tree"; ENOENT 287 | Not covered |
| G6 | **Research-quality checks** (claims provenance, date and link checks, "verify these still hold") | wrong date on plan; links broken after repo move; stale findings after PR split | Not covered |
| G7 | **Domain risk checklist** (PHI/PII, jurisdiction, rollback) as a reusable input to align/spec | Canada deployment, PHI data-flow questions | `phase-align` has dimensions but no reusable checklist |

## 4. Principles

1. **Reuse ASDLC-1 formats.** Any skill that records evidence emits the `Accord:` trailer
   and the evidence-asset shape. No parallel format.
2. **Skills first, then core.** Skills are advisory. Anything a pilot shows is skipped is
   promoted to a core check or hook (`accord check-*`).
3. **Host-agnostic wording.** Skills say "the project's verify command from
   `AGENTS.md ## Dev Harness`"; pi tools (`repo_verify`, `gh_pr_submit`) are optional.
4. **Interim means removable.** Skills that ASDLC-1 will replace are marked
   `interim: true` and deleted or thinned when the matching feature ships.
5. Modify only skills and agents that live in this repo (`packages/pi-skills`,
   `packages/accord-assets`).

## 5. Deliverables

### A. Core (not skills) — do first

| # | Item | Notes |
|---|------|-------|
| A1 | **Loop budget gaps** in `accord-core` orchestration: cost cap per task and per work item, and a no-progress detector (same diff hash and same findings twice). Attempt caps already exist (§6.3) | On trip: write blocked state with reason; `accord unblock` resumes. Closes G1. **Separate ticket** (ASDLC-1 brief is locked). |
| A3 | **Done.** `accord bootstrap <ID> <title…>` and `accord bootstrap --adhoc <title…>`; synthetic-ID helper in `accord-core/work-items/synthetic.ts`; orchestrator re-runs `phase-align` without `phase-gather` for `ADHOC-` ids; `phase-align.md` rule; docs and `okf/log.md` updated. Tests: `bootstrap.test.ts`, `synthetic-work-item.test.ts`, `orchestration-align-followup.test.ts`. | Enables harness-mode `brief` from the CLI (§6.1). |
| A2 | **Spawn preflight for non-pi hosts**: register a `registerSpawnPreflightCheck` backend in `accord-cli` and `accord-mcp` | Credentials/model/agent-file checks already exist for pi (§6.3). Closes G2. |

### B. Skills (interim, host-agnostic)

| # | Skill | New/change | Behaviour |
|---|-------|-----------|-----------|
| B1 | `verify` | change | **Done:** `scripts/green.sh mark|check|show` records a content-based fingerprint of the working tree after a full green run; commit and PR skills call `check`. Tests in `packages/pi-skills/tests/green.test.ts`. |
| B2 | `commit` | change | **Phase 1 done.** **Gate only until `commit-evidence` ships:** refuse if edits since last green verify (B1). No trailer or subject-format changes. Phase 2 (after `commit/commit-grammar.ts` lands): emit the ASDLC-1 subject and `Accord:` trailer; defer to the orchestrator when `stack.commits` is on. |
| B3 | `pr` | change | **Phase 1 done.** `green.sh <mark|check> review` added; `review` marks on completion, `pr` checks verify and review and reports CI after every submit. **Gates only until `stack-compute`/`trunk-hardening` ship:** require recorded review for HEAD SHA (or explicit skip reason) and queue a CI check after submit. Phase 2: stack-aware base and retarget per §6.2 (record parent head SHA; merge main with auto-resolve rule; verify net diff; `gh pr edit --base`), aligned with ASDLC-1 task 37. |
| B4 | `evidence-check` | new, interim | **Deferred.** Would parse a trailer format that is not built. Build only if `accord evidence` (ASDLC-1 task 9) slips; otherwise skip. |
| B5 | `brief` | new | **Done.** Harness mode (`accord bootstrap --adhoc` then `accord align`) and inline mode; `template.md` extends the `phase-align` shape with Done-means, Non-goals, Appetite, Failure behaviour, Existing patterns, Repo facts and a decision ledger; `scripts/adhoc-id.sh`. |
| B6 | `reuse-scout` | new | **Done.** Repo and sibling-repo search, fit labels, liveness check, records what was searched; output matches `phase-explore`. |
| B7 | `risk-checklist` | new | **Done.** `checklist.md` (9 domains), risk register, executive go/no-go summary. Regulation names are prompts; compliance owners confirm. |
| B8 | `doc-verify` | new | **Done.** `scripts/doc-verify.py` (python3 stdlib): links, anchors, fences, dates, `verified-against`/`verified-paths` staleness, provenance tags, mermaid via `mmdc` when installed. It already caught a broken link in this plan. |
| B9 | `review` / `pr-review` | change | Reuse compliance when a brief exists; stack-aware "mitigated by a later PR?" pass; apply ASDLC-1 `feature-knowledge` invariants once available. |
| B10 | `worktree` | change | **Done:** pin step plus `scripts/wt-guard.sh where|inside|find`; tests in `packages/pi-skills/tests/wt-guard.test.ts`. Original intent: resolve worktree at session start and state CWD/ticket; confirm before edits outside it (G5). |

### C. Hooks (host-specific, call one script)

| # | Item | Notes |
|---|------|-------|
| C2 | `accord check-commit` / `check-pr` | **Deferred.** Overlaps the `accord/evidence` CI check (ASDLC-1 task 4). Decide after the pilot and after that check ships; reuse it rather than add a second one. |
| C3 | Path/ENOENT preflight | Suggest `rg -l` when a path is absent; read before edit. Low priority. |

### Overlap with ASDLC-1

| Class | Items | Handling |
|-------|-------|----------|
| **No shared code** | A2, B1, B5 (inline), B6, B7, B8, B9 (reuse compliance), B10, pilot instrumentation | Start now |
| **Minor merge friction** | A3 (CLI dispatch/help also gain `stack`, `evidence`, `feature`); A1 (orchestration handlers: tasks 7, 15, 35); `docs/plans/README.md` | Keep changes small; put A1 in its own module (`orchestration/budget/`) with one call site; sequence behind task 7 or rebase on it |
| **Defer (would conflict or duplicate)** | B2 trailer/format, B3 stack/retarget, B4, C2, schema and `phase-plan` edits | Gate-only versions now; phase 2 after the owning ASDLC-1 feature ships |

## 6. Decisions and findings

| # | Item | Outcome |
|---|------|---------|
| D1 | Ad-hoc work ID | **Decided:** the `brief` skill generates a synthetic ID `ADHOC-<YYYYMMDD><NN>` (NN 01–99), for example `ADHOC-2026102901`. A hyphenated counter (`-2`) would fail the anchored `DEV_WORK_ITEM_ID_PATTERN` and `WORK_ITEM_FILE_PATTERN`, so the counter is appended to the date. Matches `phase-align`'s own no-ticket convention (`AUTH-REFRESH-1`). |
| D2 | `phase-align` outside `dev_*` | **Verified, partly.** See 6.1. |
| D3 | Loop budget (A1) | **Decided:** separate ticket (ASDLC-1 brief is locked). |
| D4 | Close PR #18 open items | **Decided:** handled inside the ASDLC-1 ticket. Not in this plan. |
| D5 | `gh` retarget after parent squash | **Investigated.** See 6.2. |

### 6.3 Corrections after reading `main` (A1, A2)

I earlier reported no loop cap. That was wrong. Code on `main` (PRs #11, #12, #13) has:

- **Loop caps:** `review_loop.max_critical_retries` (default 3), `review_test.max_retries`,
  `review_code.max_retries`, `max_rgr_respawns` (default 3), and a **lifetime** ceiling
  `max_lifetime_retries` that `unblock` never resets, plus `max_unblocks_per_task` (default 1).
- **Spawn safety:** `agents/config.ts` refuses to silently substitute a cursor profile for
  anthropic; `cursor-agent-exec.ts` passes the prompt after `--`; `subagent/result/process.ts`
  reports empty responses and stops the pipeline; `runSubagentSpawnPreflightCheck` is called
  in `resume.ts`.

Not found: a **cost cap** per task or work item, a **no-progress detector** (same diff or same
findings repeated), and a **preflight backend for CLI/MCP hosts** (`registerSpawnPreflightCheck`
is called only from `pi-accord`; elsewhere it returns the permissive default).
The incident ran accord against a worktree of another repository (`<other-repo>/.worktrees/<TICKET>`, a
non-accord ticket). Its `.tasks/<TICKET>-task-1.json` is now schema 2.0,
`status: done`, `retries.test_review {used:1, lifetime:1}`: the stuck state is not preserved, and the
v2.0 format post-dates the loop fixes, so this file cannot show whether the old loop was fixed.
Reproduce with a forced non-converging test↔review loop before opening the A1 ticket.

A1 therefore shrinks to: cost cap + no-progress detection. A2 shrinks to: register a real
preflight for `accord-cli`/`accord-mcp`.

### 6.1 `phase-align` outside the orchestrator (D2)

Checked against `phase-align.md`, `align-task.ts`, `classify-dispatch.ts`, `lifecycle.ts`
and a scratch run of `classifyPreflight` in an empty repo.

- **Prompt is portable.** `phase-align.md` is plain markdown; it already says
  `work_item_id` may be a "keyword slug for no-ticket flows". Its output (a brief with
  10 coverage dimensions and alignment markers) needs no tools beyond read/grep/write.
- **Orchestrator provides**: injected schemas, multi-turn checkpoint (`draft`, `answered`),
  the gather sub-step, return-packet validation, and `applyPhaseAlignPostResult`
  (verifies `docs/dev/<ID>/brief.md` is complete, records it on the work item, advances
  phase to `speccing`). A skill run without it has none of these.
- **Synthetic ID works** (`ADHOC-20261029` bootstrapped: `.tasks/ADHOC-20261029.json`, `implement/standard`).
- **Two traps found** (both closed by A3, see below):
  1. `classifyPreflight("ADHOC-… <title>")` **skips bootstrap** when the intent has
     `needs_confirmation` (it was true for both sample sentences). `accord run <free text>`
     then blocks: "include a ticket id … or run dev_bootstrap via MCP". At the time the CLI had
     no `bootstrap` command; only `dev_bootstrap` (MCP / pi tool). Now: `accord bootstrap`.
  2. Bootstrapping with the ID alone (`ticketOnly`) sets `title = ID`. The align task's
     `description` then equals the ID, which matches the ticket pattern, so align asks for
     `phase-gather` against the tracker for a ticket that does not exist.
- **Hand-off is possible.** `accord plan resume <ID>` recovers from an existing
  `docs/dev/<ID>/brief.md` ("expected at least brief.md or spec.json on disk").
  So an inline brief can enter the harness later.

**Resulting design for `brief`:**

| Mode | When | How |
|------|------|-----|
| Harness | `accord` CLI installed (or `dev_bootstrap` via MCP/pi) | `accord bootstrap --adhoc -- '<real title>'` (or `dev_bootstrap(id, <real title>, implement, standard)`); then `accord align <ID>`. Title must not match the ticket pattern. |
| Inline | CLI only | Skill follows `phase-align` rules directly, writes `docs/dev/<ID>/brief.md` in the same shape, and tells the user to run `accord plan resume <ID>` to continue. |

**Core item A3 (done):** `accord bootstrap <ID> <title> [--pattern …]` and `accord bootstrap --adhoc <title>` (core module `accord-core/src/work-items/bootstrap.ts`; the CLI only parses and prints),
so CLI-only hosts get harness mode. Also make the gather trigger ignore IDs with an `ADHOC-` prefix.

### 6.2 `gh` retarget after a parent squash-merge (D5)

Repo settings (`cshirley/accord`): squash and rebase merges allowed, merge commits
**not** allowed, `delete_branch_on_merge: false`. `gh` 2.103.3 has `gh pr edit --base`.
Git behaviour tested on a scratch repo with a local bare remote that simulated a squash
merge of parent `A` into `main`, then retargeted child `B` (2 commits, one touching a file
also changed in `A`):

| Method | Result |
|--------|--------|
| `git rebase main` | **Fails.** Replays the parent's original commits on top of its own squash: add/add conflict at commit 1 |
| `git merge main` | **Conflicts** (add/add on files the parent introduced) |
| `git merge -X ours main` | Clean, correct here, but silently wins on *real* conflicts too. Unsafe as a default |
| `git rebase --onto main <old-parent-tip> B` | **Clean**; child keeps only its 2 own commits. Rewrites child history |
| `git merge main` + auto-resolve rule (below) | **Clean**; no history rewrite; net diff verified identical |

**Auto-resolve rule** (no rewrite, deterministic): after `git merge main`, for each
conflicted path, if `main:<path>` == `<old-parent-tip>:<path>` take the child's version
(main only holds the parent's own squashed content); otherwise it is a real conflict, stop.
Then check `git diff main HEAD` is identical to `git diff <old-parent-tip> <child>`
(when `main` has no other changes); else report the difference.

**Findings for the plan:**
- The **old parent tip SHA is required** and disappears if the parent branch is deleted.
  Record it in the stack map / evidence asset, or read it with
  `gh pr view <parent> --json headRefOid`.
- ASDLC-1 says "no force-push or amend of evidence commits" and plans "retarget by merging
  main". Merge is consistent with that; `rebase --onto` is not. Use merge + the rule above
  for evidence-stack PRs; allow `rebase --onto` + `--force-with-lease` only for non-evidence
  branches.
- Sequence for the `pr` skill: parent merged (squash) → fetch → merge `main` into child with
  the rule → verify net diff → push → `gh pr edit <child> --base main`.
- **Not verified:** whether GitHub auto-retargets child PRs when the parent branch is
  deleted on merge. Testing needs a real scratch GitHub repo; ask before creating one.
- Feed this into ASDLC-1 `trunk-hardening` task 37 ("Bottom-up merge: retarget next PR by
  merging main"): that task must handle the squash add/add conflict, which plain
  `git merge main` does not.

### 6.4 Review of the first six commits

A standalone review of the branch (code, security, test) found one Critical and several Warnings. All were fixed in a follow-up commit; the review mark is re-recorded after the re-review.

| Finding | Fix |
|---------|-----|
| ADHOC `needs_gather` re-ran align without spending the gather budget, so the cap never escalated; the hint's real ticket was ignored | Follow-up plan carries `consumesGatherBudget`; a real ticket in the hint still gathers; loop test fails without the fix |
| `green.sh` failed open when `git add` failed or a directory was unreadable | Explicit failure (exit 4); temp index and object dir; no stat-cache seeding (racy-git) |
| Review mark attested the whole tree for a `local` review and ignored open Criticals | `fingerprint` at capture, `mark review --tree/--source/--critical/--accepted`, `check review` enforces them |
| `wt-guard.sh` `inside` bypass via `..` and symlinks; `find` truncated paths with spaces | Physical path walk; tab-separated `find`; tests for each |
| `doc-verify.py` front matter, nested fences, unvalidated `verified-repo`/`verified-against`, mermaid environment errors | Parser, fence and validation fixes; `--allow-repo`; new codes documented in the skill |
| `bootstrap` printed `accord align` for non-aligning phases; `--adhoc <ID>` folded the ID into the title | `Next:` from phase; parse error with guidance; `--` terminator |
| Tests: clock dependence, crash-as-pass helper, missing boundaries | Fixed clocks and shims, strict helpers, boundary and side-effect tests |
| `session-retro` regexes matched mentions and ignored failures | Segment-anchored patterns, in-order `&&` handling, failed verify keeps edits dirty, `--until` added |

## 7. Order

1. **No-conflict core and skills:** A2 (open), B1 and B10 (done).
2. **Shift-left and research quality:** B8, B7, B6, B5 and A3 (all done).
3. **A1** loop budget (separate ticket), attached to ASDLC-1's task-7 handlers.
4. **Gate-only** B2 and B3 (phase 1, done). B9 reuse compliance (open).
5. **Pilot** (below). Instrument skipped checks via `session-retro`.
6. **Phase 2, per ASDLC-1 feature as it ships:**
   - `commit-evidence` → B2 trailer and subject format.
   - `stack-compute` / `trunk-hardening` → B3 stack base and retarget (§6.2); feed §6.2 findings into task 37.
   - `evidence-asset` + `accord evidence` → drop B4 (never built).
   - `accord/evidence` CI check → decide the §5 C2 hooks.
   - Delete or thin any interim skill the harness replaces.

D4 (closing PR #18) proceeds in the ASDLC-1 ticket, not here.

## 8. Pilot and exit criteria

**Measure with** `bun packages/pi-skills/scripts/session-retro.ts [--since YYYY-MM-DD]` (gates and adoption sections; order-aware per session).

**Baseline** (460 sessions dated before 2026-10-29; `session-retro.ts --until 2026-10-29`, before any of these skills were used):

| Gate | Baseline |
|------|----------|
| Sessions that edited files and never ran a verify | 110 / 233 (47%) |
| Commits made with edits since the last verify | 97 / 245 (40%) |
| Commits made before any review in the session | 214 / 245 (87%) |
| Sessions with a PR submit and no CI check afterwards | 39 (PR submits: 101) |
| First prompts under 100 characters | 142 / 460 (31%) |
| Prompts with rework signals ("wrong", "revert", "still not…") | 27 |

These differ from the earlier regex figures in §1 because the new measure follows tool-call order and counts commits, not only sessions. Compare the pilot window (`--since <pilot start>`) against this baseline. The measure is heuristic: it reads command text and tool order, and treats a failed verify (error result) as not verifying; it cannot see test outcomes.

Pilot on one real ticket (2–3 PRs) and one non-harness research doc. Record skipped checks.

Exit when, over the pilot:
- no commit without a verify since the last edit;
- no PR without a recorded review and CI result;
- no loop exceeds its budget without a blocked state;
- zero "forgot X" corrections that a skill or check would have caught;
- the research doc passes `doc-verify` with no unverified dates or links.

Skipped despite the skill → promote to the §5 C2 hooks or core.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Divergence from ASDLC-1 formats | Reuse its trailer and asset; review this plan against ASDLC-1 before each skill ships |
| Interim skills linger after ASDLC-1 ships | `interim: true` marker; removal step in §7 |
| Skills are advisory | Pilot measures skips; the §5 C2 hooks promote them |
| ASDLC-1 changes under review | Depend only on stable parts (trailer key names, asset path); recheck after C4 |
| Pi-specific tool names in skills | Host-agnostic wording; pi tools as optional shortcuts |
