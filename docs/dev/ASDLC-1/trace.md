# Implementation trace: ASDLC-1

- Generated: 2026-11-02T12:16:32.459Z (harness-generated from `.tasks/`; regenerate, don't edit)
- Pattern: implement

## Tasks

| Task | Title | Status | Commits | Rounds T/C/V | Findings | Unblocks |
| ---: | --- | --- | --- | --- | --- | ---: |
| 1 | [flags] Stack and knowledge switch resolver with default-off values | done | `0e9ed2e` | 1/1/1 | 8 (open 8) | 0 |
| 2 | [infra] Temp git repo, fake gh helpers and import-boundary test | done | `a018167` | 4/4/1 | 21 (verified 15, wont_fix_accepted 1, waived 2, open 3) | 0 |
| 3 | [telemetry] Stack event catalogue and emitter on the shared logger | done | `fcd446c` | 1/1/1 | 9 (open 9) | 0 |
| 4 | [infra] accord/evidence check runner and workflow | done | `fd02108` | 2/1/1 | 21 (verified 9, reraised 1, wont_fix_accepted 1, open 10) | 0 |
| 5 | [commit-evidence] Commit grammar: Accord trailer build, parse, validate | done | `2194f4d` | 2/1/1 | 13 (verified 10, open 3) | 0 |
| 6 | [commit-evidence] Commit guard and content redaction | done | `619a27f` | 2/1/1 | 21 (verified 8, reraised 3, open 8, wont_fix_accepted 2) | 0 |
| 7 | [commit-evidence] Orchestrator-only per-phase commits behind stack.commits phase | done | `dfcd785` | 5/3/1 | 28 (waived 1, verified 22, wont_fix_accepted 1, reraised 3, open 1) | 0 |
| 8 | [commit-evidence] Evidence timeline from git trailers | done | `2a2e877` | 3/1/1 | 16 (verified 10, reraised 1, open 5) | 0 |
| 9 | [commit-evidence] accord evidence CLI command | done | `831cf8e` | 1/1/1 | 11 (open 11) | 0 |
| 10 | [commit-evidence] OKF docs and docs validation test | done | `cfb68a8` | 2/1/1 | 13 (verified 5, wont_fix_accepted 1, open 7) | 0 |
| 11 | [evidence-asset] Work-item-qualified AC refs, trace.json qualification behind stack.enabled | done | `58b8d41` | 2/1/1 | 15 (verified 8, open 6, wont_fix_accepted 1) | 0 |
| 12 | [evidence-asset] Evidence asset writer (task-<N>.md and .json) | done | `96e4fcd` | 2/1/1 | 24 (verified 14, open 10) | 0 |
| 13 | [evidence-asset] Final evidence(task-<N>) commit | done | `b946982` | 2/1/1 | 22 (verified 10, open 12) | 0 |
| 14 | [evidence-asset] OKF docs for the evidence asset | done | `96f2bbd` | 2/1/1 | 12 (verified 4, wont_fix_accepted 1, open 7) | 0 |
| 15 | [security-gate] review-security gating inside the C loop | done | `3e86b17` | 2/1/1 | 12 (verified 7, open 5) | 0 |
| 16 | [security-gate] Route open or disputed gating security findings back to review-security | done | `e8393f1` | 2/1/1 | 11 (verified 7, open 4) | 0 |
| 17 | [security-gate] Schema description and OKF docs | done | `68d3fe7` | 2/1/1 | 13 (verified 6, dispute_upheld 1, open 6) | 0 |
| 18 | [contract-lock] contract.lock.json writer, verifier and schema | done | `3d58371` | 3/3/2 | 16 (verified 14, wont_fix_accepted 2) | 0 |
| 19 | [contract-lock] PR0 contract commit, tag and contract-amend | done | `fea6e0a` | 2/1/1 | 24 (reraised 1, verified 12, open 11) | 0 |
| 20 | [contract-lock] Pre-write lock guard in the tool_call hook | done | `a076d02` | 2/2/2 | 13 (verified 9, open 3, wont_fix_accepted 1) | 0 |
| 21 | [contract-lock] Post-spawn lock verification, restore and amend-only commits | done | `7e4b1c0` | 4/2/1 | 24 (verified 17, open 7) | 0 |
| 22 | [contract-lock] Connect /dev amend-spec to contract-amend, amend marker and blocked downstream tasks | done | `f98ce01` | 2/1/1 | 29 (verified 12, wont_fix_accepted 2, open 15) | 0 |
| 23 | [contract-lock] Contract-lock rule in the accord/evidence CI check | done | `e448106` | 2/1/1 | 24 (verified 12, reraised 1, wont_fix_accepted 1, open 10) | 0 |
| 24 | [contract-lock] OKF docs for contract PR0 and amendment | done | `7940f3b` | 1/2/2 | 10 (open 5, verified 5) | 0 |
| 25 | [stack-compute] Plan schema fields, phase-plan prompt and alignment test | done | `50242d8` | 1/4/5 | 15 (open 8, verified 7) | 1 |
| 26 | [stack-compute] computeStack: deterministic pack, flag and order | done | `89b79ee` | 3/3/2 | 23 (verified 20, wont_fix_accepted 3) | 0 |
| 27 | [stack-compute] PR brief, stack map, stack table and report renderers | done | `c6f34b7` | 2/1/1 | 16 (verified 13, reraised 1, open 2) | 0 |
| 28 | [stack-compute] StackProvider port and gh provider | done | `eb2f03d` | 2/1/1 | 23 (verified 12, open 11) | 0 |
| 29 | [stack-compute] Stack service and dev_stack_* MCP tools | done | `3a7bfc8` | 2/1/1 | 26 (verified 12, wont_fix_accepted 3, open 11) | 0 |
| 30 | [stack-compute] Per-PR branch lifecycle in the spawn preflight | done | — | 2/1/1 | 25 (verified 10, wont_fix_accepted 1, reraised 2, open 12) | 0 |
| 31 | [stack-compute] accord stack CLI command | pending | — | 0/0/0 | 0 | 0 |
| 32 | [stack-compute] Schema description and OKF docs for the stack | pending | — | 0/0/0 | 0 | 0 |
| 33 | [tree-state] State size cap and task-file redaction | pending | — | 0/0/0 | 0 | 0 |
| 34 | [tree-state] State snapshot writer staged with every typed commit | pending | — | 0/0/0 | 0 | 0 |
| 35 | [tree-state] Stateless resume from committed state | pending | — | 0/0/0 | 0 | 0 |
| 36 | [tree-state] Closeout commit builds artifacts then removes state | pending | — | 0/0/0 | 0 | 0 |
| 37 | [tree-state] Leftover-state rule in the accord/evidence check | pending | — | 0/0/0 | 0 | 0 |
| 38 | [tree-state] OKF docs for committed state and closeout | pending | — | 0/0/0 | 0 | 0 |
| 39 | [trunk-hardening] Overrun measurement and re-plan decision | pending | — | 0/0/0 | 0 | 0 |
| 40 | [trunk-hardening] Open-PR depth cap and flag validation | pending | — | 0/0/0 | 0 | 0 |
| 41 | [trunk-hardening] Bottom-up merge: retarget next PR by merging main | pending | — | 0/0/0 | 0 | 0 |
| 42 | [trunk-hardening] OKF docs for depth cap, merge order and overrun | pending | — | 0/0/0 | 0 | 0 |
| 43 | [feature-knowledge] Feature doc schema, parser and index generator | pending | — | 0/0/0 | 0 | 0 |
| 44 | [feature-knowledge] validate:features script and Dev Harness entry | pending | — | 0/0/0 | 0 | 0 |
| 45 | [feature-knowledge] spec features[] and PR0 impact analysis | pending | — | 0/0/0 | 0 | 0 |
| 46 | [feature-knowledge] Closeout feature-doc update and drift check | pending | — | 0/0/0 | 0 | 0 |
| 47 | [feature-knowledge] Review invariants and CI drift rule | pending | — | 0/0/0 | 0 | 0 |
| 48 | [feature-knowledge] Feature find/impact query and dev_feature_* tools | pending | — | 0/0/0 | 0 | 0 |
| 49 | [feature-knowledge] accord feature CLI command | pending | — | 0/0/0 | 0 | 0 |
| 50 | [feature-knowledge] Schema description and OKF docs for feature knowledge | pending | — | 0/0/0 | 0 | 0 |
| 51 | [ci-driven-mode] Startup push-token check and cost cap key | pending | — | 0/0/0 | 0 | 0 |
| 52 | [ci-driven-mode] CI builds PR0 from brief and spec | pending | — | 0/0/0 | 0 | 0 |
| 53 | [ci-driven-mode] Idempotent resume, concurrency lock, gates and cost-cap alert | pending | — | 0/0/0 | 0 | 0 |
| 54 | [ci-driven-mode] OKF and CI docs for CI-driven mode | pending | — | 0/0/0 | 0 | 0 |

## Acceptance criteria

### AC-1 — satisfied

> Then the orchestrator makes one commit per phase completion, each subject names its ref (T1/phase-test, C1/review-security, V1/phase-verify-task), agents never commit, and each review commit holds its findings before …

- Tasks: 7 (satisfied)
- Files: `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/src/subagent/result/process.ts`
- Tests verified (3):
  - phase-commits.test.ts › ASDLC-1/AC-1 one orchestrator commit per phase, in order, with ref subjects, trailers and review findings
  - ASDLC-1/AC-1 a commit made during a spawn without a trailer is reported as agent-commit, not accepted
  - ASDLC-1/AC-12 secret in finding evidence is masked in the committed review markdown

### AC-2 — satisfied

> Then it is one line of key=value pairs, required keys are present, counts equal the staged findings and tests, unknown x_ keys are ignored, and the documented awk extraction over git log returns the same values

- Tasks: 5 (satisfied)
- Files: `packages/accord-core/tests/commit-grammar.test.ts`, `packages/accord-core/tests/fixtures/commit-grammar/messages.golden.txt`, `packages/accord-core/tests/fixtures/commit-grammar/awk-extract.golden.txt`, `packages/accord-core/src/commit/commit-grammar.ts`
- Tests verified (8):
  - commit-grammar.test.ts: 512 pass, 0 fail
  - ASDLC-1/AC-2 buildCommitMessage equals golden
  - ASDLC-1/AC-2 parseAccordTrailer round-trips golden
  - ASDLC-1/AC-2 missing required key fails validation
  - ASDLC-1/AC-2 crit+warn+sugg vs staged findings
  - ASDLC-1/AC-2 t_pass/t_fail vs recorded tests
  - ASDLC-1/AC-2 unknown x_ keys are ignored by validation and by counts
  - ASDLC-1/AC-2 awk extraction equals awk-extract.golden.txt and parseAccordTrailer sums

### AC-3 — satisfied

> Then the out-of-scope path is not committed, a stack.guard.rejected log event is emitted, and a test edit respawns phase-test

- Tasks: 6 (satisfied), 7 (satisfied)
- Files: `packages/accord-core/tests/commit-guard.test.ts`, `packages/accord-core/tests/redact.test.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/src/state/redact.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/src/subagent/result/process.ts`
- Tests verified (6):
  - commit-guard.test.ts › ASDLC-1/AC-3 guardStagedPaths — review commits keep only reviews/** and state/**
  - commit-guard.test.ts › ASDLC-1/AC-3 guardStagedPaths — code loop
  - commit-guard.test.ts › ASDLC-1/AC-3 guardStagedPaths — state and evidence commits
  - commit-guard.test.ts › ASDLC-1/AC-3 guardTrailer — trailer-counts
  - ASDLC-1/AC-3 phase-code result touching a test file: test path not committed, rejection logged, phase-test respawn requested
  - ASDLC-1/AC-3 phase mode: test edit by phase-code respawns phase-test (RGR)

### AC-4 — satisfied

> Then a timeline is rendered from git trailers only (ref, outcome, counts, tokens, cost) and the tsv columns match the documented awk extraction

- Tasks: 8 (satisfied), 9 (satisfied)
- Files: `packages/accord-core/tests/evidence-timeline.test.ts`, `packages/accord-core/src/evidence/timeline.ts`, `packages/accord-cli/tests/evidence-cli.test.ts`, `packages/accord-cli/src/commands/evidence.ts`, `packages/accord-cli/src/cli.ts`, `packages/accord-cli/src/dispatch.ts`, `packages/accord-cli/src/commands/index.ts`
- Tests verified (8):
  - evidence-timeline.test.ts: 17/17 pass (ASDLC-1/AC-4 readTimeline, renderers, trailer-only selection, tsv/awk column agreement)
  - bun run check:types
  - bun test (full suite)
  - evidence-cli.test.ts › ASDLC-1/TC-4 default format is md
  - evidence-cli.test.ts › ASDLC-1/TC-4 --format tsv prints header plus one tab-separated line per commit
  - evidence-cli.test.ts › ASDLC-1/TC-4 task-2 filters to that task (md)
  - evidence-cli.test.ts › ASDLC-1/TC-4 tsv columns match the documented awk extraction (sum usd_u by task)
  - evidence-cli.test.ts › ASDLC-1/TC-4 unknown format exits non-zero naming the format and the valid values

### AC-5 — satisfied

> Then it is evidence(task-<N>) (evidence(task-<N>,<M>) for a merged PR), writes docs/dev/<ID>/evidence/task-<N>.{md,json} per task from commits and trailers (red and green excerpts, findings, review-to-fix patches, pla…

- Tasks: 12 (satisfied), 13 (satisfied)
- Files: `packages/accord-core/tests/evidence-asset.test.ts`, `packages/accord-core/src/evidence/asset.ts`, `packages/accord-core/src/evidence/lines.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/commit/evidence-commit.ts`, `packages/accord-core/src/commit/hooks.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/subagent/result/process.ts`
- Tests verified (4):
  - evidence-asset.test.ts: ASDLC-1/AC-5 evidence asset content (ASDLC-1/TC-5) (json roll-up, md excerpts, merged PR one asset per task, byte-identical output, squash simulation, include_diffs)
  - evidence-asset.test.ts: ASDLC-1/AC-5 measureActualLines (ASDLC-1/TC-5)
  - evidence-commit.test.ts: ASDLC-1/AC-5 single task, merged PR, state dir removal, outcome=done trailer, commit log entry, staging guards, resolver registry
  - phase-commits.test.ts: ASDLC-1/AC-5 wiring A/B/C

### AC-6 — satisfied

> Every AC or TC reference outside spec.json (evidence asset .md and .json, trace.json, the PR brief and the stack map) MUST be work-item-qualified as <work_item_id>/AC-<n>, never a bare AC-<n>, so it resolves once many…

- Tasks: 11 (satisfied), 12 (satisfied), 27 (satisfied)
- Files: `packages/accord-core/tests/qualified-ac-refs.test.ts`, `packages/accord-core/src/evidence/qualify-ac.ts`, `packages/accord-core/src/artifacts/trace-artifact.ts`, `packages/accord-core/schemas/trace-schema.json`, `packages/accord-core/src/queries/verify-summary.ts`, `packages/accord-core/tests/evidence-asset.test.ts`, `packages/accord-core/src/evidence/asset.ts`, `packages/accord-core/tests/stack-render.test.ts`, `packages/accord-core/src/stack/render.ts`
- Tests verified (10):
  - qualified-ac-refs.test.ts: ASDLC-1/AC-6 qualifyAcRef, qualifyTcRef, normalizeAcId, findBareAcRefs
  - ASDLC-1/AC-6 written trace.json is qualified and schema-valid
  - ASDLC-1/AC-26 bare/qualified verify-summary and renderAcTrace cases
  - trace-artifact.test.ts
  - evidence-asset.test.ts: ASDLC-1/AC-6 qualified AC references (ASDLC-1/TC-6) every AC/TC reference in md and json is ASDLC-1/AC-<n>
  - evidence-asset.test.ts: ASDLC-1/AC-6 qualified AC references (ASDLC-1/TC-6) a bare reference is detected
  - stack-render.test.ts: ASDLC-1/AC-6 qualifies bare and already-qualified AC ids, no bare refs
  - stack-render.test.ts: ASDLC-1/AC-6 stack map has no bare AC refs
  - stack-render.test.ts: ASDLC-1/AC-6 table has no bare AC refs
  - stack-render.test.ts: ASDLC-1/AC-6 report has no bare AC refs even when trailers carry ac=

### AC-7 — satisfied

> Then they stay advisory exactly as today and no round is gated

- Tasks: 15 (satisfied)
- Files: `packages/accord-core/tests/review-security-gate.test.ts`, `packages/accord-core/tests/helpers/security-gate-fixture.ts`, `packages/accord-core/src/tasks/record.ts`, `packages/accord-core/src/orchestration/post-result/review-security.ts`
- Tests verified (3):
  - review-security-gate.test.ts: ASDLC-1/AC-7 default review-security is advisory (config variants)
  - review-security-gate.test.ts: ASDLC-1/AC-7 repeated critical security findings never block under defaults
  - review-security-gate.test.ts: ASDLC-1/AC-7 default note reports advisory counts and no gating

### AC-8 — satisfied

> Then findings at or above the gate severity gate the round (block: critical; warn: critical and warning; none: any), suggestions stay advisory under warn and block, the next C round phase-code fixes security and code …

- Tasks: 15 (satisfied), 16 (satisfied)
- Files: `packages/accord-core/tests/review-security-gate-stack.test.ts`, `packages/accord-core/tests/helpers/security-gate-fixture.ts`, `packages/accord-core/src/tasks/record.ts`, `packages/accord-core/src/orchestration/post-result/review-security.ts`, `packages/accord-core/src/orchestration/post-result/review-code.ts`, `packages/accord-core/tests/review-security-routing.test.ts`, `packages/accord-core/src/orchestration/review-paths.ts`, `packages/accord-core/src/orchestration/post-result/phase-code.ts`
- Tests verified (11):
  - review-security-gate-stack.test.ts: ASDLC-1/AC-8 gate severity table
  - review-security-gate-stack.test.ts: ASDLC-1/AC-8 next C round goes to phase-code with security and code findings together
  - review-security-gate-stack.test.ts: ASDLC-1/AC-8 review-code re-reviews the fix
  - review-security-gate-stack.test.ts: ASDLC-1/AC-8 at the code_review retry cap the task blocks for a human
  - review-security-gate-stack.test.ts: ASDLC-1/AC-8 configured code_review cap governs security-driven rounds
  - review-security-routing.test.ts: ASDLC-1/AC-8 phase-code routes gating security findings to review-security
  - review-security-routing.test.ts: ASDLC-1/AC-8 severity gate decides which security findings route back
  - review-security-routing.test.ts: ASDLC-1/AC-8 review-security owns closing its findings
  - review-security-routing.test.ts: ASDLC-1/AC-26 default advisory gate leaves routing unchanged
  - review-security-gate-stack.test.ts (TC-8)
  - loop-caps.test.ts: max_retries 1: second security→review-code round blocks and lists the security finding

### AC-9 — satisfied

> Then PR0 contains docs/dev/<ID>/{brief.md,spec.json,plan.json}, state/work-item.json and contract.lock.json with sha256 of each of brief.md, spec.json and plan.json (state/work-item.json is not locked because closeout…

- Tasks: 18 (satisfied), 19 (satisfied), 20 (satisfied), 21 (satisfied), 22 (satisfied), 23 (satisfied)
- Files: `packages/accord-core/tests/contract-lock.test.ts`, `packages/accord-core/src/contract/lock.ts`, `packages/accord-core/schemas/contract-lock-schema.json`, `packages/accord-core/src/artifacts/validation.ts`, `packages/accord-core/tests/contract-pr0.test.ts`, `packages/accord-core/tests/contract-amend.test.ts`, `packages/accord-core/src/contract/pr0.ts`, `packages/accord-core/src/contract/amend.ts`, `packages/accord-core/src/subagent/result/process.ts`, `packages/accord-core/tests/contract-lock-guard.test.ts`, `packages/accord-core/src/contract/lock-guard.ts`, `packages/pi-accord/tests/pi-contract-lock-hook.test.ts`, `packages/pi-accord/src/pi-hook-listeners.ts`, `okf/architecture/hooks.md`, `packages/accord-core/tests/contract-lock-restore.test.ts`, `packages/accord-core/src/contract/lock-verify.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/tests/contract-amend-session.test.ts`, `packages/accord-core/src/contract/amend-session.ts`, `packages/accord-core/src/orchestration/resolve/subcommand.ts`, `packages/accord-ci/tests/contract-lock-check.test.ts`, `packages/accord-ci/tests/evidence-check-runner.test.ts`, `packages/accord-ci/src/checks/contract-lock.ts`, `packages/accord-ci/src/evidence-check.ts`, `docs/ci/pre-merge-smoke.md`
- Tests verified (30):
  - ASDLC-1/AC-9 contract lock writer
  - ASDLC-1/AC-9 contract lock verifier
  - ASDLC-1/AC-9 amend marker
  - contract-pr0.test.ts: ASDLC-1/AC-9 builds one commit with exactly brief, spec, plan, state/work-item.json and contract.lock.json
  - contract-pr0.test.ts: ASDLC-1/AC-9 lock holds sha256 of brief/spec/plan (not work-item.json) and the preceding commit sha
  - contract-pr0.test.ts: ASDLC-1/AC-9 tags the lock commit accord/<ID>/contract pointing at HEAD
  - contract-pr0.test.ts: ASDLC-1/AC-9 hooks run before writeContractLock so the lock matches the final files
  - contract-pr0.test.ts: ASDLC-1/AC-9 a failing commit or tag is reported, never swallowed
  - contract-amend.test.ts: ASDLC-1/AC-9 commits as one orchestrator commit with Accord trailer outcome=amend
  - contract-amend.test.ts: ASDLC-1/AC-9 stale_task_ids covers only tasks covering the affected ACs
  - contract-amend.test.ts: ASDLC-1/AC-9 missing, empty and whitespace-only reasons are rejected
  - contract-lock-guard.test.ts › ASDLC-1/AC-9 lock guard blocks without open amend
  - contract-lock-guard.test.ts › ASDLC-1/AC-9 lock guard with an open amend
  - contract-lock-guard.test.ts › ASDLC-1/AC-9 lock guard pass-through
  - contract-lock-guard.test.ts › ASDLC-1/AC-26 no lock file means every write passes
  - contract-lock-guard.test.ts › ASDLC-1/AC-9 lock guard path shapes and lock states
  - pi-contract-lock-hook.test.ts › ASDLC-1/AC-9 write of locked spec.json is blocked
  - pi-contract-lock-hook.test.ts › ASDLC-1/AC-9 edit of locked spec.json is blocked
  - pi-contract-lock-hook.test.ts › ASDLC-1/AC-9 non-locked spec.md passes
  - pi-contract-lock-hook.test.ts › ASDLC-1/AC-26 without contract.lock.json spec.json passes
  - contract-lock-restore.test.ts: ASDLC-1/AC-9 (restore, open amend, nonce, guidance-only, guardStagedPaths locked-path, forged lock, processSubagentToolResult wiring)
  - contract-lock-guard.test.ts
  - commit-guard.test.ts
  - contract-amend-session.test.ts: ASDLC-1/AC-9 openAmend / closeAmend / cancelAmend
  - contract-amend-session.test.ts: ASDLC-1/AC-9 affectedAcsFromSpecDiff
  - contract-amend-session.test.ts: ASDLC-1/AC-9 /dev amend-spec routing
  - contract-amend-session.test.ts: ASDLC-1/AC-9 amend completion via processSubagentToolResult
  - contract-amend.test.ts
  - packages/accord-ci/tests/contract-lock-check.test.ts (all ASDLC-1/AC-9 cases: non-amend edit fails, amend passes, forged lock fails, PR0 passes, squash amend trusted, tag informational, no-lock passes, fail-closed refs)
  - packages/accord-ci/tests/evidence-check-runner.test.ts

### AC-10 — satisfied

> Then the output is byte-identical, adjacent same-concern tasks below min_pr_lines merge within the budget, a task above max_pr_lines or max_files is flagged for re-plan and never split, independent tasks are siblings,…

- Tasks: 25 (satisfied), 26 (satisfied)
- Files: `packages/accord-core/tests/alignment.test.ts`, `packages/accord-core/schemas/plan-schema.json`, `packages/accord-assets/agents/accord/phase-plan.md`, `packages/accord-core/src/orchestration/resolve/interview-task.ts`, `packages/accord-core/src/orchestration/resolve/forced.ts`, `packages/accord-core/src/orchestration/resolve/resume.ts`, `packages/accord-core/tests/compute-stack.test.ts`, `packages/accord-core/tests/fixtures/stack/compute-stack.golden.json`, `packages/accord-core/src/stack/types.ts`, `packages/accord-core/src/stack/compute-stack.ts`
- Tests verified (6):
  - alignment.test.ts: ASDLC-1/AC-30 est_lines, concern, flag and kind validate together with depends_on
  - alignment.test.ts: ASDLC-1/AC-30 kind %s is accepted / unknown kind %j fails
  - bun test (full, preflight exit 0)
  - packages/accord-core/tests/compute-stack.test.ts (40 pass, 0 fail; ASDLC-1/AC-10 golden, determinism, merge, flag, order, PR count)
  - bun run check:types (exit 0)
  - bunx biome check on task files (src/stack, compute-stack.test.ts, fixtures/stack): clean

### AC-11 — pending (not verified)

> Then PRs are created or updated with a stack map comment and a generated PR brief (contract link first, ACs and proving tests, process summary, reading order), one accord/evidence status check replaces bot comments, a…

- Tasks: 27 (satisfied), 28 (satisfied), 29 (satisfied), 30 (satisfied), 31 (pending)
- Files: `packages/accord-core/tests/stack-render.test.ts`, `packages/accord-core/src/stack/render.ts`, `packages/accord-core/tests/stack-provider-gh.test.ts`, `packages/accord-core/src/stack/provider.ts`, `packages/accord-core/src/stack/gh-provider.ts`, `packages/accord-core/tests/stack-service.test.ts`, `packages/accord-core/src/stack/service.ts`, `packages/accord-core/src/tools/registry.ts`, `packages/accord-core/src/index.ts`, `packages/accord-core/tests/stack-branches.test.ts`, `packages/accord-core/src/stack/branches.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/subagent/preflight-runner.ts`
- Tests verified (22):
  - stack-render.test.ts: ASDLC-1/AC-11 section order: contract link, ACs, summary, risks, reading order
  - stack-render.test.ts: ASDLC-1/AC-11 header columns are exactly PR, Tasks, Concern, ACs, Est. LOC, Depends on
  - stack-render.test.ts: ASDLC-1/AC-11 one row per PR and loop with rolled-up values from trailers
  - stack-render.test.ts: ASDLC-1/AC-11 lists position, PR link and qualified AC coverage per PR in order
  - bun test packages/accord-core/tests/stack-provider-gh.test.ts (30 pass, 0 fail; covers createOrUpdatePr create/edit, upsertStackMapComment in place, setEvidenceStatus never replacing failure, listPrs, resolveStackProvider unsupported error, no secret leakage, ensureBranch/pushBranch non-force)
  - bun run check:types
  - bun run check:bundle
  - grep -rEn 'GH_TOKEN|GITHUB_TOKEN|process\.env' packages/accord-core/src/stack/ (no match)
  - biome check on packages/accord-core/src/stack and stack-provider-gh.test.ts (clean)
  - stack-service.test.ts › ASDLC-1/AC-11 returns the computed stack table for the plan
  - stack-service.test.ts › ASDLC-1/AC-11 creates a PR per task with brief, stack map comment and evidence status
  - stack-service.test.ts › ASDLC-1/AC-11 pushes every branch with only the branch (no force) and is idempotent on rerun
  - stack-service.test.ts › ASDLC-1/AC-11 never overwrites a failing accord/evidence status (real gh provider)
  - stack-service.test.ts › ASDLC-1/AC-11 refreshes PR numbers and states from the provider
  - stack-service.test.ts › ASDLC-1/AC-11 unsupported provider fails with a clear error
  - stack-service.test.ts › ASDLC-1/AC-11 renders a per-PR roll-up row per loop from commit trailers
  - stack-service.test.ts › ASDLC-1/AC-11 each dev_stack* tool returns the disabled service text
  - stack-service.test.ts › ASDLC-1/AC-11 importing src/index.ts registers the computeStack resolver: merged tasks share a group
  - stack-branches.test.ts: ASDLC-1/AC-11 (task branch from PR0/main/parent, dirty-tree blockReason, disabled no-op, read-only status, closeout branch + hook registration)
  - stack-service.test.ts
  - evidence-commit.test.ts: closeout branch hook
  - bun run check:runtime

### AC-12 — pending (not verified)

> Then docs/dev/<ID>/state/task-<N>/ in the same commit holds STATE.md (the accord trace rendering) and a redacted task.json valid against task-schema.json with in_flight null, test output is redacted (secrets and token…

- Tasks: 33 (pending), 34 (pending)

### AC-13 — pending (not verified)

> Then state is rebuilt from docs/dev/<ID>/state/ and the other artifacts, the next ref is the same as in the original run, findings are read from the tree with no review re-run, and the evidence asset regenerated from …

- Tasks: 35 (pending)

### AC-14 — pending (not verified)

> Then it passes while the work item is open (state/work-item.json from PR0 and in-flight task state are allowed on PR heads before their evidence commit), and it fails if docs/dev/<ID>/state/task-* remains at a PR head…

- Tasks: 37 (pending)

### AC-15 — pending (not verified)

> Then verify.*, trace.* and workflow-cost.* are built, the remaining docs/dev/<ID>/state/ (including work-item.json) is deleted after they are built, and the closeout PR is the last PR of the stack

- Tasks: 36 (pending)

### AC-16 — pending (not verified)

> Then a decisions[] entry is raised with the options to re-plan through contract-amend or accept with a reason, a stack.overrun.detected log event is emitted, and planned vs actual size (production and test lines separ…

- Tasks: 39 (pending)

### AC-17 — pending (not verified)

> Then at most max_depth PRs of the chain are open, the next opens after its base merges, every non-final task PR leaves main green with the feature unreachable behind a flag, and only the last task flips the flag

- Tasks: 40 (pending), 41 (pending)

### AC-18 — pending (not verified)

> Then index.md and index.json are regenerated, links, anchors and test references resolve, every feature AC has a test, and a feature above max_acs_per_feature is reported

- Tasks: 43 (pending), 44 (pending)

### AC-19 — pending (not verified)

> Then an Impacted features table lists the feature with its relation (new, extends, modifies, deprecates, depends_on), depends_on and related traversal is included, and overlaps or contradicting ACs become decisions[]

- Tasks: 45 (pending)

### AC-20 — pending (not verified)

> Then the feature doc is updated with the AC delta and a changes[] entry linking the work item, PR, evidence and contract sha, the mapping from each work-item AC (<ID>/AC-<n>) to its feature AC id is recorded, the feat…

- Tasks: 46 (pending)

### AC-21 — pending (not verified)

> Then results come from index.json (index, then feature, then change record, then evidence) and the same logic is available as dev_feature_* MCP tools

- Tasks: 48 (pending), 49 (pending)

### AC-22 — pending (not verified)

> Then review agents receive the impacted feature docs as invariants and a regression against an existing feature AC is a finding, and the same drift check runs in CI so a manual edit cannot invalidate a feature doc unn…

- Tasks: 47 (pending)

### AC-23 — pending (not verified)

> Then it commits plan.json and the proposed stack table to PR0 and stops at the human gate, with no local session

- Tasks: 52 (pending)

### AC-24 — pending (not verified)

> Then it resumes idempotently from the last typed commit, one concurrency lock per <ID> prevents parallel runs, gates (PR0 approval, blocked task, closeout) are signalled by PR comments or commits, and the per-work-ite…

- Tasks: 53 (pending)

### AC-25 — pending (not verified)

> CI-driven mode treat ACCORD_CI_PUSH_TOKEN (a GitHub App token or PAT) as a required env var with no default, and MUST fail to start, before any step, when it is absent, because commits made with GITHUB_TOKEN do not tr…

- Tasks: 51 (pending)

### AC-26 — satisfied

> With stack.enabled and knowledge.enabled unset or false and stack.commits unset or "task", the existing single-branch, single-PR flow, per-task commits (orchestration.commit.on_task_done), and review-security advisory…

- Tasks: 1 (satisfied), 7 (satisfied), 15 (satisfied)
- Files: `packages/accord-core/tests/stack-flags.test.ts`, `packages/accord-core/src/config/stack-flags.ts`, `packages/accord-core/src/config/types.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/pi-accord/scripts/runtime-smoke.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/src/subagent/result/process.ts`, `okf/architecture/orchestration.md`, `okf/references/orchestration-policy.md`, `okf/log.md`, `packages/accord-core/tests/review-security-gate.test.ts`, `packages/accord-core/src/tasks/record.ts`, `packages/accord-core/src/orchestration/post-result/review-security.ts`
- Tests verified (12):
  - packages/accord-core/tests/stack-flags.test.ts: ASDLC-1/AC-26 resolveStackConfig defaults, resolveKnowledgeConfig defaults, resolveReviewSecurityGate (35 pass)
  - bun test (full suite, exit 0)
  - bun run check:runtime (TC-27 runtime smoke, exit 0)
  - bun run check:types, check:bundle, check:biome, validate:schemas, validate:assets, validate:okf, validate:ste (all exit 0)
  - ASDLC-1/AC-26 default config rows: no phase commit, tree and index untouched, no stack.* log
  - ASDLC-1/AC-26 stack.commits unset/task/no config: done task still gets the per-task commit
  - commit-on-task-done.test.ts
  - bun run check:runtime
  - review-security-gate.test.ts: ASDLC-1/AC-26 default config produces no stack or knowledge artifacts
  - review-security-gate.test.ts: ASDLC-1/AC-26 default security→review-code→verify cycle creates no stack or knowledge artifacts
  - bun run check:runtime (exit 0)
  - bun test full suite: 2174 pass, 1 unrelated fail (AC-31 check:biome, trace.json format)

### AC-27 — pending (not verified)

> Evidence commits are append-only: the harness MUST NOT amend or force-push them, and a failed round adds commits and never rewrites them

- Tasks: 7 (satisfied), 13 (satisfied), 19 (satisfied), 41 (pending), 53 (pending)
- Files: `packages/accord-core/tests/append-only.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/commit/evidence-commit.ts`, `packages/accord-core/tests/contract-pr0.test.ts`, `packages/accord-core/tests/contract-amend.test.ts`, `packages/accord-core/src/contract/pr0.ts`, `packages/accord-core/src/contract/amend.ts`
- Tests verified (6):
  - append-only.test.ts › failed review round then retry only appends commits; earlier shas stay ancestors of HEAD
  - an unchanged tree never rewrites the previous commit (no amend on empty round)
  - ASDLC-1/AC-27 rerun adds no commit, no amend: evidence sha stays HEAD and reachable
  - ASDLC-1/AC-27 a later phase commit goes on top; evidence commit is never rewritten
  - contract-pr0.test.ts: ASDLC-1/AC-27 existing tag is left as is (not forced) and PR0 still commits
  - contract-amend.test.ts: ASDLC-1/AC-27 amend adds a commit and never rewrites history

### AC-28 — pending (not verified)

> Orchestration and domain logic (commit grammar, computeStack, evidence, state, feature knowledge) MUST live in packages/accord-core; pi-accord, accord-cli and accord-mcp stay thin adapters and Pi APIs never enter acco…

- Tasks: 2 (satisfied), 9 (satisfied), 29 (satisfied), 31 (pending), 49 (pending)
- Files: `packages/accord-core/tests/helpers-git.test.ts`, `packages/accord-core/tests/layering.test.ts`, `packages/accord-core/tests/helpers/temp-git-repo.ts`, `packages/accord-core/tests/helpers/fake-gh.ts`, `packages/accord-cli/tests/evidence-cli.test.ts`, `packages/accord-cli/src/commands/evidence.ts`, `packages/accord-core/tests/stack-service.test.ts`, `packages/accord-core/src/stack/service.ts`, `packages/accord-core/src/tools/registry.ts`, `packages/accord-core/src/index.ts`
- Tests verified (9):
  - packages/accord-core/tests/layering.test.ts › ASDLC-1/AC-28 no accord-core src import resolves to @earendil-works/* or packages/pi-*
  - packages/accord-core/tests/helpers-git.test.ts › ASDLC-1/AC-28 (temp git repo and fake gh)
  - bun run check:types
  - bun run check:bundle
  - evidence-cli.test.ts › ASDLC-1/AC-28 commands/evidence.ts delegates to accord-core timeline and renderers
  - evidence-cli.test.ts › ASDLC-1/AC-28 adapter does not shell out to git or parse trailers itself
  - no-pi-dep.test.ts › does not depend on pi-accord or pi-subagent
  - stack-service.test.ts › ASDLC-1/AC-28 service.ts imports no Pi package and not tools/registry
  - stack-service.test.ts › ASDLC-1/AC-28 registry delegates dev_stack* tools to the stack service

### AC-29 — pending (not verified)

> The telemetry events stack.commit.created, stack.guard.rejected, stack.state.snapshot and stack.overrun.detected MUST be emitted through the shared accord-core logger (logging.ts) at, respectively, the orchestrator co…

- Tasks: 3 (satisfied), 6 (satisfied), 7 (satisfied), 13 (satisfied), 34 (pending), 39 (pending)
- Files: `packages/accord-core/tests/stack-telemetry.test.ts`, `packages/accord-core/src/telemetry/stack-events.ts`, `packages/accord-core/tests/commit-guard.test.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/commit/evidence-commit.ts`
- Tests verified (14):
  - packages/accord-core/tests/stack-telemetry.test.ts: ASDLC-1/AC-29 <event> emits once at <level> with declared fields
  - ASDLC-1/AC-29 <event> catalogue entry declares exact level and fields
  - ASDLC-1/AC-29 <event> rejects an unknown field
  - ASDLC-1/AC-29 <event> rejects missing field <field>
  - ASDLC-1/AC-29 rejects non-numeric <key>=<value>
  - ASDLC-1/AC-29 emits through createLogger('stack') at debug level
  - bun run check:types
  - bunx biome check (task files)
  - commit-guard.test.ts › ASDLC-1/AC-29 guard rejection telemetry
  - commit-guard.test.ts › ASDLC-1/AC-3 guardTrailer — trailer-counts > ASDLC-1/AC-29 trailer rejection emits stack.guard.rejected at warn
  - phase-commits.test.ts › ASDLC-1/AC-29 emits info stack.commit.created with work_item_id, ref, outcome and sha for each commit
  - ASDLC-1/AC-3 rejection logged (stack.guard.rejected)
  - ASDLC-1/AC-29 emits info event with work_item_id, ref, outcome=done and sha
  - ASDLC-1/AC-29 no event on idempotent rerun

### AC-30 — pending (not verified)

> New agents, schemas and config keys MUST stay aligned across manifest.json, registry.ts and schemas/ (plan fields est_lines, concern, depends_on, flag, kind; spec features[]; stack and knowledge keys)

- Tasks: 11 (satisfied), 17 (satisfied), 18 (satisfied), 25 (satisfied), 32 (pending), 39 (pending), 43 (pending), 45 (pending), 50 (pending), 51 (pending)
- Files: `packages/accord-core/tests/qualified-ac-refs.test.ts`, `packages/accord-core/src/evidence/qualify-ac.ts`, `packages/accord-core/schemas/trace-schema.json`, `packages/accord-core/tests/alignment.test.ts`, `packages/accord-core/schemas/accord-schema.json`, `packages/accord-core/tests/contract-lock.test.ts`, `packages/accord-core/schemas/contract-lock-schema.json`, `packages/accord-core/src/artifacts/validation.ts`, `packages/accord-core/schemas/plan-schema.json`, `packages/accord-assets/agents/accord/phase-plan.md`, `packages/accord-core/src/orchestration/resolve/interview-task.ts`
- Tests verified (14):
  - ASDLC-1/AC-30 accepts ac_id (table)
  - ASDLC-1/AC-30 rejects ac_id (table)
  - ASDLC-1/AC-30 multi-segment work item ids qualify and normalise
  - bun run validate:schemas (30 passed, 0 failed)
  - bun run validate:assets (exit 0)
  - bun run check:types (exit 0)
  - packages/accord-core/tests/alignment.test.ts (all ASDLC-1/AC-30 cases, via bun test exit 0)
  - bun run validate:schemas
  - bun run validate:assets
  - ASDLC-1/AC-30 schema alignment for contract.lock.json
  - bun run check:types
  - alignment.test.ts: ASDLC-1/AC-30 manifest agent absent from registry.ts makes validate:assets fail
  - alignment.test.ts: ASDLC-1/AC-30 plan field schema tests
  - bun run validate:schemas (exit 0)

### AC-31 — pending (not verified)

> Each feature MUST update the affected okf/ concepts and append a dated entry to okf/log.md; procedure text in files marked style: ste follows ASD-STE100; changes under packages/accord-ci/ also update docs/ci/pre-merge…

- Tasks: 4 (satisfied), 10 (satisfied), 14 (satisfied), 17 (satisfied), 20 (satisfied), 22 (satisfied), 23 (satisfied), 24 (satisfied), 25 (satisfied), 31 (pending), 32 (pending), 37 (pending), 38 (pending), 42 (pending), 44 (pending), 47 (pending), 49 (pending), 50 (pending), 51 (pending), 52 (pending), 53 (pending), 54 (pending)
- Files: `packages/accord-ci/tests/evidence-check-runner.test.ts`, `packages/accord-ci/src/evidence-check.ts`, `.github/workflows/accord-evidence.yml`, `docs/ci/pre-merge-smoke.md`, `okf/log.md`, `okf/architecture/monorepo-packages.md`, `packages/accord-core/tests/docs-validation.test.ts`, `okf/references/commit-format.md`, `okf/architecture/evidence-stack.md`, `okf/references/accord-cli.md`, `okf/references/artifacts-and-state.md`, `okf/references/orchestration-policy.md`, `okf/references/stack-config.md`, `okf/architecture/agents.md`, `okf/architecture/crucible-verification.md`, `okf/references/task-file.md`, `okf/architecture/hooks.md`, `packages/accord-core/tests/contract-amend-session.test.ts`, `packages/accord-ci/tests/contract-lock-check.test.ts`, `okf/references/dev-command.md`, `packages/accord-core/tests/alignment.test.ts`, `okf/references/schemas.md`
- Tests verified (31):
  - bun test packages/accord-ci/tests/evidence-check-runner.test.ts (26 pass)
  - bun run validate:okf
  - bun run validate:ste
  - bun run check:types
  - grep fetch-depth: 0 / pull_request.head.sha / secrets in accord-evidence.yml
  - docs-validation.test.ts › ASDLC-1/AC-31 validate:okf exits 0
  - docs-validation.test.ts › ASDLC-1/AC-31 validate:ste exits 0
  - docs-validation.test.ts › ASDLC-1/AC-31 check:biome exits 0
  - docs-validation.test.ts › ASDLC-1/AC-31 okf/log.md has a dated entry naming ASDLC-1, the evidence command and the updated concepts
  - docs-validation.test.ts › ASDLC-1/AC-31 accord-cli.md has an evidence Commands row with real syntax
  - docs-validation.test.ts › ASDLC-1/AC-31 evidence-stack.md documents the implemented stack.commits phase mode
  - docs-validation.test.ts › ASDLC-1/AC-31 commit-format.md is bound to the implemented commit code
  - bun run check:biome
  - packages/accord-core/tests/docs-validation.test.ts (11 pass, 0 fail)
  - packages/accord-core/tests/docs-validation.test.ts (all ASDLC-1/AC-31 cases, via bun test exit 0)
  - bunx biome check on task-changed files (okf, accord-schema.json, both test files)
  - docs-validation.test.ts › ASDLC-1/AC-31 hooks.md has exactly one Hook-table row for the pre-write lock guard
  - docs-validation.test.ts › ASDLC-1/AC-31 hooks.md sources the lock guard module
  - docs-validation.test.ts › ASDLC-1/AC-31 okf/log.md has a dated entry for the lock guard docs
  - bun run check:runtime
  - biome check on task files
  - ASDLC-1/AC-31 pre-merge-smoke.md accord/evidence section documents the contract-lock rule
  - ASDLC-1/AC-31 okf/log.md has a dated entry naming contract-lock and accord/evidence
  - ASDLC-1/AC-31 an okf concept listing evidence-check.ts as a source describes contract-lock
  - bunx biome check packages/accord-ci okf docs/ci
  - packages/accord-core/tests/docs-validation.test.ts (25 pass, incl. ASDLC-1/AC-31 cases)
  - bun run check:biome (task files clean)
  - alignment.test.ts: ASDLC-1/AC-31 okf/references/schemas.md documents the plan stack fields
  - bun run validate:okf (exit 0)
  - bun run validate:ste (exit 0)
  - bun run check:biome (exit 0)

## Accepted risks and unresolved findings

| Task | Req | Finding | Kind | State | Severity | Issue | Location | Resolution |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | AC-26 | F-001 | unresolved (advisory) | open | warning | The required config/types.ts change (typed DevHarnessConfig.stack, .knowledge and orchestration.review_loop.review_security) is not checked by anything. Every fixture is cast with `as unknown as DevHarnessConfig`, every result is cast to Record<string, unknown>, and the stub returns `unknown`. | packages/accord-core/tests/stack-flags.test.ts:16 |  |
| 1 | AC-26 | F-002 | unresolved (advisory) | open | warning | The default assertions do not match the impl step's 'filling every default'. (a) The sizing toEqual (lines 34, 42, 62, 105) uses only 5 keys, so a correct resolver that also fills the schema defaults split_on and merge_small_same_concern fails. Phase-code cannot edit tests, so this causes an RGR respawn. (b) The other defaults are never asserted: top-level merge_strategy, evidence, contract and require_flag, plus knowledge.impact_analysis. The null-config tests (lines 45, 133) check only enabled/commits, and an undefined config (allowed by the signature) is never tested. | packages/accord-core/tests/stack-flags.test.ts:19 |  |
| 1 | AC-26 | F-003 | unresolved (advisory) | open | warning | The switch inputs are tested only with valid literal values. loadDevHarnessConfig (config/agents-md.ts parseAndValidateConfig) does not check stack or knowledge against accord-schema.json, so non-boolean or out-of-enum values reach the resolver. The dark-deploy guard can then turn the stack on, or change the security gate, when the user meant off. | packages/accord-core/tests/stack-flags.test.ts:51 |  |
| 1 | AC-26 | F-004 | unresolved (advisory) | open | warning | Overwritten shared defaults go undetected because of test order. Every default state/sizing assertion runs before the partial-override test (line 88). After it, nothing re-resolves defaults and checks state or sizing. The input-mutation test (line 108) uses an input with no nested state or sizing object, and nothing checks that returned objects are fresh. | packages/accord-core/tests/stack-flags.test.ts:88 |  |
| 1 | AC-26 | F-005 | unresolved (advisory) | open | warning | Knowledge defaults are not checked when a partial knowledge object is present. The drift_check test.each asserts only drift_check, and there is no `knowledge: {}` test. A resolver that returns the user object as-is passes every knowledge test. | packages/accord-core/tests/stack-flags.test.ts:159 |  |
| 1 | AC-26 | F-006 | unresolved (advisory) | open | suggestion | The 'stack enabled means warn' default is tested only with an orchestration.review_loop object present. A stack-enabled config with no orchestration key is not tested. Neither is the case where knowledge.enabled alone must not change the gate. | packages/accord-core/tests/stack-flags.test.ts:194 |  |
| 1 | AC-26 | F-007 | unresolved (advisory) | open | suggestion | TC-27 (e2e regression: harness suite plus runtime-smoke with defaults produce no stack or knowledge files) has no test in this task. The plan assigns it to a later task that extends packages/pi-accord/scripts/runtime-smoke.ts (plan.json:500). Task 1 adds no consumers of the flags, so no files can be produced yet. |  |  |
| 1 | AC-26 | F-008 | unresolved (advisory) | open | suggestion | Resolvers leave other documented schema defaults unfilled, so later tasks will re-implement them. | packages/accord-core/src/config/stack-flags.ts:31 |  |
| 2 | AC-28 | F-010 | accepted (advisory) | wont_fix_accepted | suggestion | TC-29 also requires check:types and check:bundle on the change; unit test cannot prove them, and neither command actually enforces the core→Pi boundary | packages/accord-core/tests/layering.test.ts:38 | wont_fix_accepted by T2/review-test — A unit test cannot run check:types or check:bundle. phase-verify-task runs `bun run check:types && bun run check:bundle && bun test packages/accord-core/tests/layering.test.ts`. |
| 2 | AC-28 | F-012 | accepted | waived | critical | phase-code modified test file packages/accord-core/tests/helpers/temp-git-repo.ts (tests are owned by phase-test) | packages/accord-core/tests/helpers/temp-git-repo.ts | waived by human — Plan task 2 deliverable: phase-code implements stub helpers under tests/helpers/ (plan.json files list). Ownership guard false positive; 52 tests pass |
| 2 | AC-28 | F-013 | accepted | waived | critical | phase-code modified test file packages/accord-core/tests/helpers/fake-gh.ts (tests are owned by phase-test) | packages/accord-core/tests/helpers/fake-gh.ts | waived by human — Same as F-012 (fake-gh.ts helper implementation is the planned phase-code deliverable) |
| 2 | AC-28 | F-019 | unresolved (advisory) | open | suggestion | Shebang embeds `process.execPath` unquoted; a Bun path containing a space, or longer than the kernel shebang limit, makes the fake `gh` fail to exec. | packages/accord-core/tests/helpers/fake-gh.ts:37 |  |
| 2 | AC-28 | F-020 | unresolved (advisory) | open | suggestion | Monkey-patching of Bun.spawn/spawnSync restores correctly only in LIFO order, and PATH is restored to a snapshot. | packages/accord-core/tests/helpers/fake-gh.ts:60 |  |
| 2 | AC-28 | F-021 | unresolved (advisory) | open | suggestion | Temp dir leaks if `git init` or `git config` throws, and `GIT_CONFIG_COUNT`/`GIT_CONFIG_PARAMETERS`/`GIT_TEMPLATE_DIR` from the host env are not scrubbed. | packages/accord-core/tests/helpers/temp-git-repo.ts:37 |  |
| 3 | AC-29 | F-001 | unresolved (advisory) | open | warning | Unknown-field and missing-field tests only change the number of fields. A rename that keeps the same count, with one declared field swapped for an undeclared one, is never tested. 'Exactly the declared field names' is therefore not enforced. | packages/accord-core/tests/stack-telemetry.test.ts:65 |  |
| 3 | AC-29 | F-002 | unresolved (advisory) | open | suggestion | The counts-only test for stack.state.snapshot only tries string values. Numbers that are not valid counts are not rejected. | packages/accord-core/tests/stack-telemetry.test.ts:101 |  |
| 3 | AC-29 | F-003 | unresolved (advisory) | open | suggestion | Values are written into `key=value` with no escaping. A string field holding whitespace or a newline (stack.guard.rejected path, stack.commit.created ref) gives a log line that is ambiguous or forged. No test pins single-line output. | packages/accord-core/tests/stack-telemetry.test.ts:53 |  |
| 3 | AC-29 | F-004 | unresolved (advisory) | open | suggestion | AC-29 is architectural: events must go through the shared logging.ts. The console.error spy checks the format, but a deliberately bad emitter could write `[accord:stack:<level>]` directly and copy the getLogLevel() threshold. | packages/accord-core/tests/stack-telemetry.test.ts:135 |  |
| 3 | AC-29 | F-005 | unresolved (advisory) | open | suggestion | Values are interpolated raw, so a value containing whitespace, '=' or a newline makes the `key=value` line ambiguous or lets it split across lines. | packages/accord-core/src/telemetry/stack-events.ts:63 |  |
| 3 | AC-29 | F-006 | unresolved (advisory) | open | suggestion | `event` is a plain `string` and the field map is untyped, so a typo or wrong field at a call site is caught only at runtime. The emitter then throws, which could abort the commit or guard path it instruments. | packages/accord-core/src/telemetry/stack-events.ts:41 |  |
| 3 | AC-29 | F-007 | unresolved (advisory) | open | suggestion | Value validation is partial. task, est_lines and act_lines are unchecked, negative or fractional counts pass, and a runtime `undefined` value passes the presence check. | packages/accord-core/src/telemetry/stack-events.ts:14 |  |
| 3 | AC-29 | F-008 | unresolved (advisory) | open | suggestion | StackEventLevel duplicates LogLevel minus 'silent'. | packages/accord-core/src/telemetry/stack-events.ts:3 |  |
| 3 | AC-29 | F-009 | unresolved (advisory) | open | suggestion | The docs describe telemetry/ as 'Usage accounting', which is now stale. | docs/file-structure.md:26 |  |
| 4 | AC-31 | F-002 | unresolved (advisory) | reraised | warning | The trigger and sha wiring is checked by substring presence only. Statuses can be posted to the merge sha, and either trigger can lack the main branch filter. | packages/accord-ci/tests/evidence-check-runner.test.ts:110 | reraised by T2/review-test — Unmet part of the Done-when: 'the status step's statuses/ URL uses that variable'. The test checks only that env contains the expression and bans only the literal `statuses/${{ github.sha }}`. `statuses/$GITHUB_SHA`, `${GITHUB_SHA}` and `${{github.sha}}` still pass, and so does `--head "$GITHUB_SHA"`. The other rows (trigger filters, no pull_request_target, fetch-depth 0, the base no-HEAD~1 check) are verified. |
| 4 | AC-31 | F-011 | accepted (advisory) | wont_fix_accepted | suggestion | The tests pin the declarations (doc and log text). The tools that enforce AC-31 (validate:okf, validate:ste, check:biome) run outside the unit test. | packages/accord-ci/tests/evidence-check-runner.test.ts:106 | wont_fix_accepted by T2/review-test — Running validate:okf, validate:ste, check:biome and the grep checks belongs to phase-verify-task. The suite already asserts the parsed-YAML equivalents of the greps. |
| 4 | AC-31 | F-012 | unresolved (advisory) | open | suggestion | Later tasks will break these tests. The registry length is pinned to 0, and the subprocess run uses fake shas ('1'x40 and '2'x40). When a later task registers a git-backed rule, both tests fail, and that task's phase-code cannot edit them. | packages/accord-ci/tests/evidence-check-runner.test.ts:200 |  |
| 4 | AC-31 | F-013 | unresolved (advisory) | open | suggestion | Only one argv validation case (--head missing) is tested. An implementation that validates only --head and defaults the others passes. | packages/accord-ci/tests/evidence-check-runner.test.ts:186 |  |
| 4 | AC-31 | F-014 | unresolved (advisory) | open | warning | A05 — Security Misconfiguration: actions/checkout persists GITHUB_TOKEN (statuses: write) into .git/config before running PR-controlled code | .github/workflows/accord-evidence.yml:25 |  |
| 4 | AC-31 | F-015 | unresolved (advisory) | open | suggestion | A03 — Injection: --base/--head accepted unvalidated; later rules will pass them to git (argument/option injection) | packages/accord-ci/src/evidence-check.ts:86 |  |
| 4 | AC-31 | F-016 | unresolved (advisory) | open | suggestion | A08 — Software/Data Integrity: required check is self-attesting; PR-controlled workflow and runner decide their own accord/evidence status | .github/workflows/accord-evidence.yml:7 |  |
| 4 | AC-31 | F-017 | unresolved (advisory) | open | suggestion | Supply chain — third-party action tag-pinned and toolchain unpinned in a job holding statuses: write | .github/workflows/accord-evidence.yml:30 |  |
| 4 | AC-31 | F-018 | unresolved (advisory) | open | suggestion | Push base can be all-zero or unreachable, and the runner passes it to rules unchecked. | .github/workflows/accord-evidence.yml:24 |  |
| 4 | AC-31 | F-019 | unresolved (advisory) | open | suggestion | Trigger filter can leave a stacked PR without the required status after its base changes. | .github/workflows/accord-evidence.yml:8 |  |
| 4 | AC-31 | F-020 | unresolved (advisory) | open | suggestion | Job name and status context are both `accord/evidence`, and fork or Dependabot PRs get a read-only token. | .github/workflows/accord-evidence.yml:16 |  |
| 4 | AC-31 | F-021 | unresolved (advisory) | open | suggestion | Multi-line rule messages break the one-line `accord/evidence: <rule>: <message>` format and the status description. | packages/accord-ci/src/evidence-check.ts:44 |  |
| 5 | AC-2 | F-011 | unresolved (advisory) | open | suggestion | parseAccordTrailer takes the first 'Accord: ' line anywhere in the message; git's documented extraction reads only the final trailer block. | packages/accord-core/src/commit/commit-grammar.ts:212 |  |
| 5 | AC-2 | F-012 | unresolved (advisory) | open | suggestion | Parser accepts duplicate keys (last wins) and any digit string for integer keys, so a trailer can parse to different counts than a single-pass reader would see. | packages/accord-core/src/commit/commit-grammar.ts:224 |  |
| 5 | AC-2 | F-013 | unresolved (advisory) | open | suggestion | Single-letter callback parameter `l`; also INTEGER_KEYS and KEY_ORDER repeat the same ~40 names in two hand-kept lists. | packages/accord-core/src/commit/commit-grammar.ts:195 |  |
| 6 | AC-3 | F-005 | unresolved (advisory) | reraised | warning | For review, state and evidence rejections, `result.rule` is never asserted, and the logged rule= value is unchecked. Telemetry is asserted only for review-code with a single path. review-test, review-security, state and evidence rejections, and the per-path event count for multi-path review rejections, are untested. | packages/accord-core/tests/commit-guard.test.ts:189 | reraised by T2/review-test — Done-when unmet: phase-verify-task (now in the table with rejections) has no result.rule literal and no warn-line assertions; state lines (line 301) have no path check; evidence lines (line 312) have no [accord:stack:warn] check. |
| 6 | AC-3 | F-006 | unresolved (advisory) | reraised | warning | The boundaries of the environment-value and home-path rules are untested: an env value of exactly 8 characters (only 7 and 20 are used), env values containing regex metacharacters, and usernames containing '.' or '-'. | packages/accord-core/tests/redact.test.ts:101 | reraised by T2/review-test — Target changed: my original 'full username absent' oracle was too weak. A \w+ username regex leaks '.shirley' and '-last2' and still passes. The new Done-when requires each name segment to be absent. The 8-char and metacharacter env rows are fine. |
| 6 | AC-3 | F-010 | unresolved (advisory) | reraised | suggestion | guardTrailer asserts only `errors.length > 0`. Non-count validation failures (missing required key, v=2) have no pinned rule, so an impl that labels every validateTrailer failure 'trailer-counts', or logs 'ref=undefined' for a trailer missing ref, is green. | packages/accord-core/tests/commit-guard.test.ts:147 | reraised by T2/review-test — The exact errors text and the trailer-invalid rule are pinned, but the missing-ref 'no ref=undefined' loop is vacuous when no line is emitted, and neither trailer-invalid row asserts a stack.guard.rejected line exists. |
| 6 | AC-3 | F-014 | unresolved (advisory) | open | suggestion | MASK allows any label text inside [REDACTED…], and the per-case loop (line 83) no longer asserts the secret is absent. A redactor that keeps a 'hint' of the secret in the label, e.g. [REDACTED:ghp_A1b2A1b2…], passes every per-case row. The T1 not.toContain oracle was removed when the anchored shape was added. | packages/accord-core/tests/redact.test.ts:33 |  |
| 6 | AC-3 | F-015 | unresolved (advisory) | open | suggestion | The quoted KEY=value rows use a value with no spaces. A plausible impl =["']?[^\s"']+ masks only the first word of a quoted passphrase, e.g. API_KEY="correct horse battery staple", and leaks the rest. | packages/accord-core/tests/redact.test.ts:92 |  |
| 6 | AC-3 | F-016 | unresolved (advisory) | open | suggestion | The test-directory union is pinned only for a nested 'packages/…/tests/helpers' path. Reusing TEST_DIR_PATTERN (/\/(test\|__tests__\|tests\|spec)\//, which needs a leading slash) misses repo-root dirs such as 'tests/conftest.py' or 'test/fixtures/x.json', so phase-code can edit root test helpers without a phase-test respawn. The comment names isTestFilePath, but the 'src/contest_api.py' kept row forbids its filename regex, which misleads the implementer. | packages/accord-core/tests/commit-guard.test.ts:109 |  |
| 6 | AC-3 | F-017 | unresolved (advisory) | open | warning | HOME_RE matches `/home/<seg>/` and `/Users/<seg>/` anywhere in a path, so relative repo paths are corrupted and over-counted. | packages/accord-core/src/state/redact.ts:22 |  |
| 6 | AC-3 | F-018 | unresolved (advisory) | open | warning | ASSIGNMENT_RE is case-sensitive, so lowercase or camelCase secret names are not masked. The env-name rule on line 8 uses the `i` flag, so the two rules are inconsistent. | packages/accord-core/src/state/redact.ts:11 |  |
| 6 | AC-3 | F-019 | unresolved (advisory) | open | suggestion | BEARER_RE masks any word of 8 or more characters after `Bearer`, and matches only the exact casing `Bearer`. | packages/accord-core/src/state/redact.ts:15 |  |
| 6 | AC-3 | F-020 | unresolved (advisory) | open | suggestion | guardTrailer decides `trailer-counts` versus `trailer-invalid` by substring-matching the error text `does not equal` from validateTrailer. | packages/accord-core/src/commit/commit-guard.ts:123 |  |
| 6 | AC-29 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The telemetry tests pin `ref=phase-code` (the commit type) in the `ref` field. The stack event catalogue, the trailer path and AC-1 use the round ref (for example 'review-C1' or 'C1/phase-code'), so path-guard rejections cannot be correlated to a round. | packages/accord-core/tests/commit-guard.test.ts:182 | wont_fix_accepted by T2/review-test — Sound: the task signature guardStagedPaths(commitType, workItemId, paths, pattern) has no round ref; a round-ref argument can come later. |
| 6 | AC-29 | F-013 | accepted (advisory) | wont_fix_accepted | suggestion | The '[accord:stack:warn]' prefix assertion would also pass for a direct console.error call with a hand-formatted prefix, which bypasses emitStackEvent and the catalogue's field validation. Proving emission goes through logging.ts is an enforcement check, not a unit assertion. | packages/accord-core/tests/commit-guard.test.ts:175 | wont_fix_accepted by T2/review-test — This is an enforcement check for phase-verify-task (grep for no console. and for emitStackEvent in commit-guard.ts), not a unit assertion. |
| 6 | _task | F-021 | unresolved (advisory) | open | suggestion | isTestPath recompiles the glob for every staged path, and an unbalanced `{` in test.file_pattern produces an invalid RegExp that throws a raw SyntaxError. | packages/accord-core/src/commit/commit-guard.ts:68 |  |
| 7 | AC-1 | F-002 | accepted | waived | critical | Orchestrator wiring is untested. Every test calls tryCommitPhase directly with a test-supplied ref. Nothing drives processSubagentToolResult, so: (a) process.ts never calling tryCommitPhase, (b) a wrong ref derivation (e.g. always T1), (c) commitDoneTasks still sweeping in phase mode (sweeps the guard-rejected test file into a '[ID] Task 7:' commit), and (d) a truthy gate `if (devConfig.stack?.commits) skipSweep` that drops per-task commits for commits:"task" (AC-26) all leave every test green. runtime-smoke.ts:110 calls tryCommitOnTaskDone directly, which is untouched by design, so it cannot detect a regression in process.ts. | packages/accord-core/tests/phase-commits.test.ts:121 | waived by human — Wiring test gap after 3 review-test rounds; later rounds were nitpicking test mechanics. Proceed to phase-code; code review (C loop) must verify process.ts wiring and AC-26 per-task commits unchanged |
| 7 | AC-1 | F-023 | accepted (advisory) | wont_fix_accepted | warning | agent-commit reporting is anchored on the latest prior trailered commit, so it never fires for the first phase of a task branch and misreports any human commit between phases. | packages/accord-core/src/commit/phase-commit.ts:142 | wont_fix_accepted by C3/review-code — Detection gap limited to the first phase on a branch with no prior trailered commit; nothing is rewritten or lost. A baseline needs a new persisted task-control field, out of scope for task 7. Add a one-line comment on reportAgentCommits that detection anchors on the latest trailered commit. |
| 7 | AC-1 | F-024 | unresolved (advisory) | reraised | warning | In phase mode a missing task_id, missing ref, or a recovered packet silently produces no commit, and the done-task sweep is also disabled, so that phase's changes are never committed. | packages/accord-core/src/subagent/result/process.ts:559 | reraised by C3/review-code — Two Done-when parts remain unmet. (1) The missing task/ref skip uses log.warn, silent at the default `error` level, with no contentAppend notice, so the orchestrator never sees the skip. (2) The recovered-packet path (process.ts:500 -> recover-task-packet.ts recoverReturnedInFlight) re-applies state with no phase commit, and the sweep is disabled in phase mode, so that phase's files and review markdown are never committed. Done when: skipped commits append a visible `Phase commit skipped (<ref>)` line to the result, and the recovered-packet path makes its phase commit (or the done-task sweep runs as fallback for done tasks with no phase commit). |
| 7 | AC-1 | F-025 | unresolved (advisory) | reraised | suggestion | Commit ref comes from latestLogFor(task, agent), not from the packet just applied, so a no-op handler reuses the previous round's ref. | packages/accord-core/src/subagent/result/process.ts:59 | reraised by C3/review-code — Dispute does not hold: handlers do not always append a log entry. phase-test.ts:102-106 returns a guard no-op with `packet NOT applied`, and applyStuckPostResult (stuck.ts) writes only decisions[]. In both, latestLogFor(task, agent) returns the previous round's ref, so a stuck C2 phase-code commits as C1/phase-code and an unapplied phase-test packet commits under the old T ref. Skip the commit, or use a ref newly claimed for this packet. Done when: a stuck packet or guard no-op yields no commit or a non-duplicate ref. |
| 7 | AC-3 | F-020 | unresolved (advisory) | open | suggestion | The temp repo created in beforeEach still applies the developer's global core.excludesFile. The F-019 rename to .env.production avoids this machine's ignore list, but a global ignore with `.env*` or `.env.*` (GitHub's Node.gitignore template uses `.env.*`) hides .env.production. Then `expect(leftover).toContain('.env.production')` at line 455 fails because of environment, not behaviour. | packages/accord-core/tests/phase-commits.test.ts:84 |  |
| 7 | AC-3 | F-022 | unresolved (advisory) | reraised | suggestion | PhaseCommitResult.respawn is dropped by commitPhaseResult, so a guard-rejected test edit that phase-code did not report never respawns phase-test. | packages/accord-core/src/subagent/result/process.ts:71 | reraised by C3/review-code — Respawn is surfaced in the process.ts:71 note, but the note only says `phase-test respawn required (RGR)`; the Done-when's alternative requires naming the rejected test path too. PhaseCommitResult carries only `respawn`, not guarded.rejected. Add `rejected?: string[]` to the result and list the paths in the note. |
| 8 | AC-4 | F-010 | unresolved (advisory) | reraised | suggestion | The fixture trailers are minimal compared with the real section 3.2e trailer, and every trailer block holds only one Accord line. Three wrong implementations pass all tests: (a) counts built from every integer key outside identity, tokens and cost (real trailers would leak open_crit, files, spawns, ms and retry into counts; tokens would gain cache_r/cache_w); (b) `%(trailers:valueonly,unfold)` without key=Accord, which drops any commit that also carries Signed-off-by or Co-authored-by; (c) no `unfold`, which drops folded trailers. This is a round-1 miss in unchanged fixture design, so it stays a suggestion. | packages/accord-core/tests/evidence-timeline.test.ts:357 | reraised by T3/review-test — The literal Done-when (toEqual on three full rows) is met. Re-raised with a clarified target because the requested 'section 3.2e trailer verbatim' was not used: the fixture has cache_r/cache_w instead of tok_cache_r/tok_cache_w (line 602), so the tokens-leak adversary named in the original issue survives. Also missing: open_warn, findings/ac lists, harness, usage. Kept at suggestion (non-gating): the tsv/md output carries only tok_in/tok_out, so AC-4 is not violated. |
| 8 | AC-4 | F-012 | unresolved (advisory) | open | warning | Any `git log` failure is swallowed and returned as an empty timeline, so a real failure looks like 'no evidence'. | packages/accord-core/src/evidence/timeline.ts:95 |  |
| 8 | AC-4 | F-013 | unresolved (advisory) | open | warning | `toRow` coerces missing required trailer keys into the strings 'undefined' and the number NaN instead of rejecting the commit. | packages/accord-core/src/evidence/timeline.ts:70 |  |
| 8 | AC-4 | F-014 | unresolved (advisory) | open | suggestion | Relative imports omit the `.js` extension; every other accord-core src file includes it. | packages/accord-core/src/evidence/timeline.ts:1 |  |
| 8 | AC-4 | F-015 | unresolved (advisory) | open | suggestion | Every call scans and formats trailers for the entire history of HEAD, then filters by id in JS. | packages/accord-core/src/evidence/timeline.ts:91 |  |
| 8 | AC-4 | F-016 | unresolved (advisory) | open | suggestion | Markdown cells are not escaped, so a `\|` in a trailer value breaks the table. | packages/accord-core/src/evidence/timeline.ts:115 |  |
| 9 | AC-4 | F-001 | unresolved (advisory) | open | warning | Only one invalid format value ('xml') is tested. Missing or empty --format values are untested, so an implementation that defaults them to md passes. | packages/accord-cli/tests/evidence-cli.test.ts:267 |  |
| 9 | AC-4 | F-002 | unresolved (advisory) | open | warning | Task-selector and work-item-id parsing is the adapter's only real logic, and only valid single-digit selectors are tested. Bad selectors and stray positional arguments silently produce wrong output. | packages/accord-cli/tests/evidence-cli.test.ts:231 |  |
| 9 | AC-4 | F-003 | unresolved (advisory) | open | suggestion | The fixture's commit order (task-2, task-2, task-3) is the same as sorting by task. The 'in commit order' claim does not tell a timeline apart from a task-sorted table. | packages/accord-cli/tests/evidence-cli.test.ts:161 |  |
| 9 | AC-4 | F-004 | unresolved (advisory) | open | suggestion | The 'documented awk extraction' test simulates awk in JS and compares against fixed totals that repeat the golden. It never runs awk or compares against the documented `git log --format='%H%x09%(trailers:key=Accord,valueonly,unfold)' \| awk` extraction. | packages/accord-cli/tests/evidence-cli.test.ts:249 |  |
| 9 | AC-4 | F-007 | unresolved (advisory) | open | suggestion | `spawnSync` has no timeout, and the child process environment is not isolated from the user's git configuration. | packages/accord-cli/tests/evidence-cli.test.ts:208 |  |
| 9 | AC-4 | F-008 | unresolved (advisory) | open | warning | console.log appends a second newline to renderer output that already ends in \n, so tsv/md output ends with a blank line. | packages/accord-cli/src/commands/evidence.ts:36 |  |
| 9 | AC-4 | F-010 | unresolved (advisory) | open | suggestion | The global `--json` flag is accepted but silently ignored (`_options` is unused), so output is not JSON. | packages/accord-cli/src/commands/evidence.ts:12 |  |
| 9 | AC-4 | F-011 | unresolved (advisory) | open | suggestion | `evidence` is not registered in TOP_LEVEL_COMMANDS, so it is missing from help, shell completion and interactive mode, unlike `trace` and `unblock`. | packages/accord-cli/src/ui/command-catalog.ts:25 |  |
| 9 | AC-28 | F-005 | unresolved (advisory) | open | suggestion | The AC-28 source-text checks are loose. `toContain(symbol)` passes when the names appear only in a comment, and the deny list misses other ways to run git. Contrived bypasses only. | packages/accord-cli/tests/evidence-cli.test.ts:288 |  |
| 9 | AC-28 | F-006 | unresolved (advisory) | open | suggestion | The task's verify step runs check:types and check:biome but not check:bundle or the accord-core import-boundary test. AC-28 enforcement names check:types, check:bundle and an import-boundary test. | packages/accord-core/tests/layering.test.ts:1 |  |
| 9 | AC-28 | F-009 | unresolved (advisory) | open | suggestion | Flag and selector parsing plus format validation live in the adapter, but the plan step puts `evidence <ID> [task-<N>] [--format md\|tsv]` parsing in cli.ts and says the adapter has no logic. | packages/accord-cli/src/commands/evidence.ts:14 |  |
| 10 | AC-31 | F-006 | accepted (advisory) | wont_fix_accepted | suggestion | Two AC-31 clauses are not exercised by this test: 'changes under packages/accord-ci/ also update docs/ci/pre-merge-smoke.md' and 'style: ste procedure text follows ASD-STE100'. None of this task's four docs is marked style: ste, so validate:ste only re-checks okf/playbooks/write-in-ste.md. | packages/accord-core/tests/docs-validation.test.ts:29 | wont_fix_accepted by T2/review-test — The reason is sound. This task changes no packages/accord-ci/ path, a merge-base diff test is fragile in shallow clones, and the pairing is a phase-verify-task check (`git diff --name-only main...HEAD`). |
| 10 | AC-31 | F-007 | unresolved (advisory) | open | suggestion | The commit-format.md rule-id loop checks four guard rules. commit-guard.ts also emits state-only, evidence-only and trailer-invalid, so a doc that leaves out the verify, state and evidence path rules still passes. | packages/accord-core/tests/docs-validation.test.ts:81 |  |
| 10 | AC-31 | F-008 | unresolved (advisory) | open | warning | Reporting section presents `accord stack report` and the `evidence/task-<N>.json` roll-up as available under an 'Implemented' banner, but neither exists. | okf/references/commit-format.md:56 |  |
| 10 | AC-31 | F-009 | unresolved (advisory) | open | warning | Guard rule descriptions do not match the implementation: `trailer-counts` is not corrected; counts are checked against findings, not 'staged files'; `agent-commit` is log-only; `code-touches-test` only returns a respawn note. | okf/references/commit-format.md:66 |  |
| 10 | AC-31 | F-010 | unresolved (advisory) | open | warning | Concept still says the `stack` key is proposed and 'The harness does not read it yet', now false for `stack.commits`. | okf/references/stack-config.md:20 |  |
| 10 | AC-31 | F-011 | unresolved (advisory) | open | suggestion | Shape and Keys describe output the orchestrator does not emit, under `status: implemented`. | okf/references/commit-format.md:30 |  |
| 10 | AC-31 | F-012 | unresolved (advisory) | open | suggestion | Commit grammar paragraph repeats the evidence-commit description and contradicts commit-format.md on verify scope. | okf/architecture/evidence-stack.md:38 |  |
| 10 | AC-31 | F-013 | unresolved (advisory) | open | suggestion | `evidence` is documented as a command but is not in TOP_LEVEL_COMMANDS, so help and completion omit it; docs/accord-cli.md, the cited source of accord-cli.md, does not mention it either. | packages/accord-cli/src/ui/command-catalog.ts:76 |  |
| 11 | AC-6 | F-010 | unresolved (advisory) | open | suggestion | The verify.md tests check renderAcTrace only with a qualified trace and a bare verify.json. A qualified verify.json is never rendered through renderAcTrace, against either a qualified or a bare trace. That is the likely case under stack.enabled once agents follow AC-6. | packages/accord-core/tests/qualified-ac-refs.test.ts:416 |  |
| 11 | AC-6 | F-011 | unresolved (advisory) | open | suggestion | The findBareAcRefs table still lets two simple wrong detectors pass. One skips every line that contains 'ac='. The other skips any ref that follows a comma. Both match every current row because no row has a bare ref on the same line as an ac= value, and no plain-text row is comma-separated. | packages/accord-core/tests/qualified-ac-refs.test.ts:143 |  |
| 11 | AC-6 | F-012 | unresolved (advisory) | open | suggestion | Requirements that are not ACs (_task) are never exercised under stack.enabled. In the fixture, _task has no changes or findings, so projectTask filters it out of requirements[] and it produces no accepted_risks entry. | packages/accord-core/tests/qualified-ac-refs.test.ts:157 |  |
| 11 | AC-6 | F-013 | unresolved (advisory) | open | warning | With stack.enabled only id fields are qualified; free-text fields copied into trace.json still contain bare AC-n/TC-n, so the trace does not satisfy 'contains no bare ref' (AC-6). | packages/accord-core/src/artifacts/trace-artifact.ts:402 |  |
| 11 | AC-6 | F-014 | unresolved (advisory) | open | suggestion | OKF concept lists trace-artifact.ts and verify-summary.ts as sources but does not mention qualified ids in trace.json under stack.enabled; no okf/log.md entry found for this change. | okf/references/artifacts-and-state.md:39 |  |
| 11 | AC-6 | F-015 | unresolved (advisory) | open | suggestion | Terse names and a redundant check in the qualification block. | packages/accord-core/src/artifacts/trace-artifact.ts:403 |  |
| 11 | AC-30 | F-007 | accepted (advisory) | wont_fix_accepted | suggestion | Unit tests here cannot prove AC-30 enforcement, and TC-31 (alignment.test.ts) belongs to the stack-compute plan task, not this one. schemas/examples/trace.json has no qualified ac_id example, so validate:schemas never exercises the widened pattern. | packages/accord-core/tests/qualified-ac-refs.test.ts:1 | wont_fix_accepted by T2/review-test — Enforcement belongs to phase-verify-task (bun run validate:schemas && bun run validate:assets). TC-31 belongs to another task. schemas/examples/trace.json is not in task.files. |
| 12 | AC-5 | F-015 | unresolved (advisory) | open | suggestion | Multi-round test cannot tell 'render every review-to-fix patch' from 'render only the last patch per loop'. The T2-review..T3-phase diff carries the line '+R2-FIX' as unified-diff context (' +R2-FIX'), so toContain("R2-FIX") holds even when the T1-review..T2-phase patch is dropped. | packages/accord-core/tests/evidence-asset.test.ts:457 |  |
| 12 | AC-5 | F-016 | unresolved (advisory) | open | suggestion | The 'default cap' row never proves its seed renders more than 262144 bytes uncapped. An impl that shortens each excerpt (e.g. last 200 lines) and applies no cap when stack.state.max_bytes is unset (`if (cfg.stack?.state?.max_bytes) truncate(...)`) produces about 110 KB and passes, although the default should be 262144 from resolveStackConfig. | packages/accord-core/tests/evidence-asset.test.ts:806 |  |
| 12 | AC-5 | F-017 | unresolved (advisory) | open | warning | Test-file classification uses a private globToRegExp with no brace support and no basename matching, so it misclassifies under the shipped default test pattern. | packages/accord-core/src/evidence/lines.ts:77 |  |
| 12 | AC-5 | F-018 | unresolved (advisory) | open | warning | Review-to-fix patches are emitted for every review commit, including clean reviews, and pair it with the next non-review commit of any loop. | packages/accord-core/src/evidence/asset.ts:199 |  |
| 12 | AC-5 | F-019 | unresolved (advisory) | open | warning | Git failures are swallowed, so the writer can commit a hollow evidence asset with no signal. | packages/accord-core/src/evidence/asset.ts:72 |  |
| 12 | AC-5 | F-020 | unresolved (advisory) | open | warning | Red/green excerpts, test counts, responses and acs depend on trailer keys and commit bodies that the only in-repo producer never emits. | packages/accord-core/src/evidence/asset.ts:161 |  |
| 12 | AC-5 | F-021 | unresolved (advisory) | open | suggestion | plan.json is read from the working tree while commits and review files come from git, so planned size can change on regeneration. | packages/accord-core/src/evidence/asset.ts:172 |  |
| 12 | AC-5 | F-023 | unresolved (advisory) | open | suggestion | The excluded state/reviews/evidence paths are defined twice (PATCH_EXCLUDES here, STATE_PATH_RE in lines.ts) and ignore a configured stack.state.path. | packages/accord-core/src/evidence/asset.ts:53 |  |
| 12 | AC-5 | F-024 | unresolved (advisory) | open | suggestion | Math.max(2, ...runs) spreads an unbounded array and can throw RangeError on large inputs. | packages/accord-core/src/evidence/asset.ts:116 |  |
| 12 | AC-6 | F-022 | unresolved (advisory) | open | suggestion | BARE_REF and qualifyText duplicate the regex already in evidence/qualify-ac.ts, so the two can drift apart. | packages/accord-core/src/evidence/asset.ts:51 |  |
| 13 | AC-5 | F-011 | unresolved (advisory) | open | warning | The process.ts evidence wiring is tested only for a task that reaches done through a phase-verify-task result. In phase mode the per-task sweep is skipped (process.ts:572), so an implementation that calls commitTaskEvidence only when agentName === 'phase-verify-task' passes cases A-C. A task that reaches done through review-code with orchestration.verify_loop.enabled=false (review-code.ts:131) then gets neither the per-task commit nor an evidence commit, so the task PR is never closed. | packages/accord-core/tests/phase-commits.test.ts:850 |  |
| 13 | AC-5 | F-012 | unresolved (advisory) | open | suggestion | The pre-staged test checks only that `git status --porcelain` lists src/staged.ts. This is also true if the implementation unstages the user's file, because it then appears as '?? src/staged.ts'. So an implementation that runs `git restore --staged .` or `git reset -- .` before staging evidence paths passes, and the user's index is lost. The pathspec reset form writes no reflog entry, so the reflog checks in the AC-27 tests do not catch it. | packages/accord-core/tests/evidence-commit.test.ts:229 |  |
| 13 | AC-5 | F-013 | unresolved (advisory) | open | suggestion | Missed in round 1. No test covers a failed evidence commit. Suppose the implementation appends the commit/committed log entry or emits stack.commit.created before commitWithMessage succeeds. A failed commit then marks the task as committed. The idempotency check and commitDoneTasks then skip it forever, and the telemetry reports a commit that does not exist. | packages/accord-core/tests/evidence-commit.test.ts:395 |  |
| 13 | AC-5 | F-015 | unresolved (advisory) | open | warning | The roll-up trailer omits tok_in, tok_out and usd_u, which the plan includes in the evidence(task-N) trailer. | packages/accord-core/src/commit/evidence-commit.ts:47 |  |
| 13 | AC-5 | F-017 | unresolved (advisory) | open | warning | In phase mode the evidence commit is tried only for the task of the packet just processed, and the done-task sweep is off, so a failed or missed evidence commit is never retried. | packages/accord-core/src/subagent/result/process.ts:501 |  |
| 13 | AC-5 | F-018 | unresolved (advisory) | open | suggestion | The evidence commit's own trailer (task=first task, loop=evidence) is included by readCommits on any later rebuild, so the asset is no longer reproducible from the PR head. | packages/accord-core/src/commit/evidence-commit.ts:141 |  |
| 13 | AC-5 | F-021 | unresolved (advisory) | open | suggestion | CloseoutBranchHook is typed `(...args: unknown[]) => unknown`, so every consumer must cast. | packages/accord-core/src/commit/hooks.ts:14 |  |
| 13 | AC-27 | F-014 | unresolved (advisory) | open | warning | Failure after the git commit leaves no idempotency marker, so a rerun adds a second evidence commit and the stack.commit.created event is lost. | packages/accord-core/src/commit/evidence-commit.ts:153 |  |
| 13 | AC-29 | F-016 | unresolved (advisory) | open | warning | Stray pre-staged files are unstaged without emitting stack.guard.rejected, unlike phase-commit.ts. | packages/accord-core/src/commit/evidence-commit.ts:126 |  |
| 13 | _task | F-019 | unresolved (advisory) | open | suggestion | Assets are built twice: buildEvidenceAsset, then writeEvidenceAssets builds them again internally. | packages/accord-core/src/commit/evidence-commit.ts:99 |  |
| 13 | _task | F-020 | unresolved (advisory) | open | suggestion | nextSeq duplicates phase-commit's priorTrailers scan, is unbounded, and swallows errors. | packages/accord-core/src/commit/evidence-commit.ts:31 |  |
| 13 | _task | F-022 | unresolved (advisory) | open | suggestion | OKF docs still say phase mode only skips the done-task sweep; they do not mention the final evidence(task-N) commit that process.ts now makes. | okf/architecture/orchestration.md:52 |  |
| 14 | AC-31 | F-003 | accepted (advisory) | wont_fix_accepted | warning | The check:biome test fails on errors that existed before this task, in files outside task.files. A correct task-14 change cannot make it GREEN, so phase-code will stall. The trace.json format error may also come back after each harness rewrite. Task 14 changes only markdown, which Biome likely does not check, so this gate says little about the change. | packages/accord-core/tests/docs-validation.test.ts:40 | wont_fix_accepted by T2/review-test — Reason is sound: TC-32 requires the check:biome test, and both failing files (scripts/update-model-pricing.ts, docs/dev/ASDLC-1/trace.json) are outside task 14 and outside phase-test's scope. phase-test named both files. biome.json formats JSON and does not exclude docs/dev, so the harness-written trace.json is likely to fail again after each rewrite. A human or harness fix to the baseline is needed before this test can go green. |
| 14 | AC-31 | F-006 | unresolved (advisory) | open | suggestion | The status-line check needs only the tokens 'evidence(task-<N>)' and 'evidence asset'. It passes when the line says the evidence asset is still proposed. The frontmatter 'status: proposed' is also unchecked. | packages/accord-core/tests/docs-validation.test.ts:96 |  |
| 14 | AC-31 | F-007 | unresolved (advisory) | open | warning | Doc says the evidence asset and evidence(task-<N>) commit depend on `stack.enabled`; source gates them on `stack.commits: phase`. | okf/references/artifacts-and-state.md:42 |  |
| 14 | AC-31 | F-008 | unresolved (advisory) | open | warning | Refs bullet says the asset uses qualified refs 'when `stack.enabled`'; the asset qualifies unconditionally, and only trace.json is gated on `stack.enabled`. | okf/architecture/evidence-stack.md:50 |  |
| 14 | AC-31 | F-009 | unresolved (advisory) | open | suggestion | Commit grammar paragraph states twice that evidence(task-<N>) is the last commit and writes the asset, and squash survival is repeated again in the Evidence asset section. | okf/architecture/evidence-stack.md:44 |  |
| 14 | AC-31 | F-010 | unresolved (advisory) | open | suggestion | Status paragraph: 'Without it, a work item is one branch...' now has no clear antecedent after the added evidence-asset sentences. Frontmatter still says `status: proposed` while the body says 'Partly implemented'. | okf/architecture/evidence-stack.md:29 |  |
| 14 | AC-31 | F-011 | unresolved (advisory) | open | suggestion | New bullet is inserted above the existing 2026-10-30 entry (log is append-only; other dates are in chronological order) and carries a redundant bare path in parentheses. | okf/log.md:5 |  |
| 14 | AC-31 | F-012 | unresolved (advisory) | open | suggestion | Still says the harness does not read the `stack` key; commits, state, redact, include_diffs and evidence behaviour are now read. Outside task files; pre-existing from earlier features. | okf/references/stack-config.md:20 |  |
| 15 | AC-7 | F-009 | unresolved (advisory) | open | suggestion | Under default config, no test covers review-code re-raising a security finding. Today review-code re-raises with its own gate (block, advisoryAll false), so a security critical it re-raises becomes gating and the task goes to phase-code. An implementation that applies the security gate to every security-raised finding (advisory under defaults) changes this and still passes every test. That conflicts with 'exactly as today' (AC-7) and 'review-security advisory behaviour unchanged' (AC-26). | packages/accord-core/tests/review-security-gate.test.ts:83 |  |
| 15 | AC-8 | F-008 | unresolved (advisory) | open | warning | The re-raise table never changes severity across the gate. In each row the finding is already gating (rows 1-4) or already advisory (row 5) before the re-raise, so an implementation that keeps the advisory flag unchanged on any re-raise of a security finding (for example, snapshot advisory before recordReview for review-code and restore it after) passes all tests. A security suggestion re-raised as a warning under warn then stays advisory forever, and a critical lowered to a warning under block keeps gating. | packages/accord-core/tests/review-security-gate-stack.test.ts:220 |  |
| 15 | AC-8 | F-010 | unresolved (advisory) | open | warning | review-code's findings brief is restricted to findings it raised itself, so a gated review-security finding fixed by phase-code is never rechecked by review-code (AC-8: 'review-code re-reviews it'). | packages/accord-core/src/tasks/render.ts:128 |  |
| 15 | AC-8 | F-011 | unresolved (advisory) | open | suggestion | Header comment says review-security findings are advisory and never gate, which is now false when the gate is not advisory. Agent-facing text has the same contradiction. | packages/accord-core/src/orchestration/post-result/review-security.ts:2 |  |
| 15 | AC-8 | F-012 | unresolved (advisory) | open | suggestion | review-code.ts (securityGate pass-through) is modified but not listed in task.files[]. | packages/accord-core/src/orchestration/post-result/review-code.ts:48 |  |
| 16 | AC-8 | F-008 | unresolved (advisory) | open | suggestion | Header doc says phase-code advances to review-security only for sensitive paths, and the nextPhaseAfterPhaseCode doc in review-paths.ts omits the new openGatingSecurityFindings option. | packages/accord-core/src/orchestration/post-result/phase-code.ts:6 |  |
| 16 | AC-8 | F-009 | unresolved (advisory) | open | suggestion | The gating-state predicate is built inline and duplicates GATING_STATES from tasks/model.ts. The plan step said to use the severity gate from resolveReviewSecurityGate. | packages/accord-core/src/orchestration/post-result/phase-code.ts:150 |  |
| 16 | AC-8 | F-010 | unresolved (advisory) | open | suggestion | When review-security is chosen only because of gating findings, the footer and decision log do not say why. | packages/accord-core/src/orchestration/post-result/phase-code.ts:158 |  |
| 16 | AC-8 | F-011 | unresolved (advisory) | open | suggestion | The brief text sent to review-security and phase-code still says security findings are advisory and never block, which contradicts the gate. | packages/accord-core/src/tasks/render.ts:142 |  |
| 17 | AC-30 | F-007 | accepted (advisory) | dispute_upheld | suggestion | TC-31 says 'a deliberately misaligned fixture fails' under validate:schemas and validate:assets. The negative fixture goes to Ajv directly, so the tests never show that the scripts detect misalignment. A no-op validate script (exit 0) passes the tests at lines 20 and 25. This is the enforcement half of an architectural AC. The declaration (enum and additionalProperties) is pinned, and task 17 does not change the scripts. | packages/accord-core/tests/alignment.test.ts:53 | dispute_upheld by T2/review-test — Task 17 does not change the validate scripts. Ajv rejects misaligned review_security configs ('major', 'WARN', '', extra key), which pins the declaration. Running the scripts end to end is phase-verify-task's job (`bun run validate:schemas && bun run validate:assets`). |
| 17 | AC-31 | F-008 | unresolved (advisory) | open | suggestion | it.each over agents.md / crucible-verification.md / task-file.md only checks lines containing both 'review-security' and 'advisory'. Deleting 'advisory' from those lines passes without the concept ever saying review-security can gate. /gate/i is also a substring match, so 'Below-gate' on the same line satisfies it. | packages/accord-core/tests/docs-validation.test.ts:225 |  |
| 17 | AC-31 | F-009 | unresolved (advisory) | open | suggestion | The review_security row in orchestration-policy.md does not pin the Default column. A row whose default cell says `"warn"` or `"block"` still passes, because `advisory` only has to appear somewhere in the row. | packages/accord-core/tests/docs-validation.test.ts:199 |  |
| 17 | AC-31 | F-010 | unresolved (advisory) | open | suggestion | Doc says suggestion findings always stay advisory, but under severity_gate `none` they gate; the sentence also sits under `# verify_loop` and duplicates the review_security table row. | okf/references/orchestration-policy.md:55 |  |
| 17 | AC-31 | F-011 | unresolved (advisory) | open | suggestion | Intro still says the harness does not read `stack` except the security gate, but other stack keys are read. | okf/references/stack-config.md:23 |  |
| 17 | AC-31 | F-012 | unresolved (advisory) | open | suggestion | Header comment still says review-security findings are advisory and never gate or consume a retry, contradicting the gate now documented. | packages/accord-core/src/orchestration/post-result/review-security.ts:2 |  |
| 17 | AC-31 | F-013 | unresolved (advisory) | open | suggestion | The review_loop key table documents review_test and review_code overrides but not review_security. | docs/configuration.md:174 |  |
| 18 | AC-30 | F-007 | accepted (advisory) | wont_fix_accepted | suggestion | AC-30 enforcement (validate:schemas / validate:assets) cannot be proven by a unit test. validate:schemas only checks files in schemas/examples/, so without an example contract-lock-schema.json is never exercised by it. | packages/accord-core/tests/contract-lock.test.ts:234 | wont_fix_accepted by T2/review-test — Sound reason. validate:schemas and validate:assets enforcement is a phase-verify-task command, and schemas/examples/contract-lock.json is a production asset for the impl step. The unit test pins the declaration: the schema file exists and SCHEMA_MAP registration is proved by the negatives. |
| 18 | AC-30 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | New schema and SCHEMA_MAP entry are not reflected in the OKF schema reference or docs/schemas.md. | packages/accord-core/src/artifacts/validation.ts:71 | wont_fix_accepted by C3/review-code — OKF and docs/schemas.md updates are owned by the okf docs task; docs gap on non-critical surface, suggestion only. |
| 19 | AC-9 | F-001 | unresolved (advisory) | reraised | warning | The wiring tests use a schema-invalid plan.json. processSubagentToolResult -> validateReturnedArtifact('phase-plan') validates plan_path against plan-schema.json. PLAN lacks the required `spec`, and its tasks lack `challenge`, `files` and `steps`, so validation.valid=false and applyWorkflowStateFromValidatedReturn never runs. The positive wiring test can pass only if PR0 is built for a REJECTED plan. The negative wiring tests (amend open, stack disabled, lock unset) pass vacuously for a correct implementation because the plan is rejected anyway. | packages/accord-core/tests/contract-pr0.test.ts:28 | reraised by T2/review-test — Target changed. My original 'Done when' did not require each negative fixture to be schema-valid. PLAN now validates and all 4 negatives exist. But the phase-spec negative uses SPEC, which does not match spec-schema.json, and the needs_input packet uses stage 'plan', which is not in the enum. Both are rejected before the post-result runs, which is the root cause F-001 named. Downgraded to warning because the valid 'stuck' case catches status-agnostic code. New 'Done when' is in the finding. |
| 19 | AC-9 | F-014 | unresolved (advisory) | open | suggestion | The tag-failure wiring check `/accord\/TESTLOCK-1\/contract\|tag/i` also matches a success message, because the success test expects `out` to contain TAG. Wiring that ignores result.ok and always prints 'PR0 committed, tag accord/TESTLOCK-1/contract' passes. This regex came from my own F-004 recommendation. | packages/accord-core/tests/contract-pr0.test.ts:630 |  |
| 19 | AC-9 | F-015 | unresolved (advisory) | open | suggestion | Only quick_fix is tested as an excluded work-item pattern. Code that checks `pattern !== 'quick_fix'` passes, but builds PR0 for investigate, infra and analyse work items. The spec says the contract PR is for implement and greenfield work only. Also, the greenfield test (line 224) seeds `pattern: 'greenfield'`, which is not a value in the work-item-schema.json pattern enum [implement, quick_fix, investigate, infra, analyse]. This is a gap in round-1 code that I missed. | packages/accord-core/tests/contract-pr0.test.ts:311 |  |
| 19 | AC-9 | F-016 | unresolved (advisory) | open | suggestion | Pre-lock hooks are tested as not running only for the quick_fix skip. Code that runs hooks before checking for an existing lock or an open amend passes every test. A hook such as the feature-knowledge impact analysis would then change spec.json after the lock is written, without an amend, and the CI lock check would fail. This is a gap in round-1 code that I missed. | packages/accord-core/tests/contract-pr0.test.ts:443 |  |
| 19 | AC-9 | F-017 | unresolved (advisory) | open | suggestion | The lock written by PR0 is never schema-validated. Code that adds an extra top-level field such as `tag` writes a lock that fails contract-lock-schema.json (additionalProperties:false), and every PR0 test still passes. This is a gap in round-1 code that I missed. | packages/accord-core/tests/contract-pr0.test.ts:165 |  |
| 19 | AC-9 | F-018 | unresolved (advisory) | open | suggestion | The test title says 'lock and files unchanged', but a rejected amend is checked only for HEAD and the lock. Code that clears the amend marker or rewrites spec.md before it checks the reason passes the test, and the open amend session is lost. This is a gap in round-1 code that I missed. | packages/accord-core/tests/contract-amend.test.ts:260 |  |
| 19 | AC-9 | F-019 | unresolved (advisory) | open | warning | A failed amend commit leaves contract.lock.json rewritten and files staged, so a retry appends a duplicate amendment record. | packages/accord-core/src/contract/amend.ts:57 |  |
| 19 | AC-9 | F-020 | unresolved (advisory) | open | warning | Unstaging foreign paths misses the old side of a staged rename, so an unrelated deletion enters the PR0 commit. The same pattern is in amend.ts:74. | packages/accord-core/src/contract/pr0.ts:71 |  |
| 19 | AC-9 | F-021 | unresolved (advisory) | open | warning | The amend commit emits no stack.commit.created event. | packages/accord-core/src/contract/amend.ts:91 |  |
| 19 | AC-9 | F-022 | unresolved (advisory) | open | suggestion | emitStackEvent is not guarded here, unlike the sibling commit modules. | packages/accord-core/src/contract/pr0.ts:94 |  |
| 19 | AC-9 | F-023 | unresolved (advisory) | open | suggestion | A tag-only failure is reported as 'PR0 contract commit failed'. Failures in this path are also not logged. | packages/accord-core/src/subagent/result/process.ts:108 |  |
| 19 | AC-9 | F-024 | unresolved (advisory) | open | suggestion | state/work-item.json is written without the stack.state.max_bytes cap. | packages/accord-core/src/contract/pr0.ts:65 |  |
| 20 | AC-9 | F-006 | unresolved (advisory) | open | suggestion | Open-amend pass-through is only tested with cwd at the repo root. The new subdirectory test covers only the lock side, so the amend side is untested from a subdirectory cwd. | packages/accord-core/tests/contract-lock-guard.test.ts:91 |  |
| 20 | AC-9 | F-007 | unresolved (advisory) | open | suggestion | Lock lookup is only tested relative to cwd after the path prefix is stripped. No test covers a write into another tree (such as a .worktrees/<X> checkout) whose lock lives at the file's real location while cwd has no lock. | packages/accord-core/tests/contract-lock-guard.test.ts:51 |  |
| 20 | AC-31 | F-008 | unresolved (advisory) | open | suggestion | The check:biome test is scoped to task-17 files, so this task's changed files are never biome-checked by TC-32. This is a round-1 miss on lines that did not change. | packages/accord-core/tests/docs-validation.test.ts:44 |  |
| 20 | AC-31 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The user-facing hook tables in `docs/hooks-and-tools.md` and `docs/accord-workflow.md:375` still omit the contract lock guard, and the Principle paragraph still says hook logic lives only in `harness/` and `subagent/`. | okf/architecture/hooks.md:39 | wont_fix_accepted by C2/review-code — Advisory docs gap. docs/hooks-and-tools.md and docs/accord-workflow.md are outside task.files, and the okf concept (the AC-31 target) is updated. Tracked as follow-up, not a correctness bug. |
| 21 | AC-9 | F-018 | unresolved (advisory) | open | suggestion | The 'valid done packet' wiring row only checks that the output lacks 'Return packet validation failed'. That check also passes if the packet is never extracted (the no-packet path), so the row does not prove the validated branch ran. | packages/accord-core/tests/contract-lock-restore.test.ts:620 |  |
| 21 | AC-9 | F-019 | unresolved (advisory) | open | warning | trustedContractLock is called with the raw cwd, but the rest of the function uses the git toplevel, so a non-root cwd silently disables the whole check. | packages/accord-core/src/contract/lock-verify.ts:28 |  |
| 21 | AC-9 | F-020 | unresolved (advisory) | open | warning | A restore of locked files is invisible to the orchestrator and, at the default log level, to the user. A failed restore is swallowed and emits no rejection event. | packages/accord-core/src/subagent/result/process.ts:329 |  |
| 21 | AC-9 | F-021 | unresolved (advisory) | open | suggestion | Restoring plan.json from the lock commit overwrites the whole file, including guidance[] entries added after PR0. | packages/accord-core/src/contract/lock-verify.ts:58 |  |
| 21 | AC-9 | F-022 | unresolved (advisory) | open | suggestion | Provenance by commit trailer conflicts with 'the lock file is the durable record and survives squash'. | packages/accord-core/src/contract/lock.ts:92 |  |
| 21 | AC-9 | F-023 | unresolved (advisory) | open | suggestion | The locked-path list duplicates lockedPaths() in contract/lock.ts, and the lock path string is repeated again. | packages/accord-core/src/commit/commit-guard.ts:79 |  |
| 21 | AC-9 | F-024 | unresolved (advisory) | open | suggestion | The Commit guard rule list omits the new `locked-path` rule and the existing `amend-scope` rule. Neither the `locked-file-written` restore nor the new rules appear in okf/log.md. | okf/references/commit-format.md:63 |  |
| 22 | AC-9 | F-011 | accepted (advisory) | wont_fix_accepted | suggestion | Stuck, and cancel after needs_input, never test what happens to locked files already edited during the amend, e.g. spec.json amended by phase-spec before phase-plan gets stuck in --replan. | packages/accord-core/tests/contract-amend-session.test.ts:504 | wont_fix_accepted by T2/review-test — The spec and the task steps say only that stuck clears the marker and snapshot; restore-on-stuck is not specified. A test would invent behaviour. If this matters, the engineer should decide it as a spec question, not phase-test. |
| 22 | AC-9 | F-015 | unresolved (advisory) | open | suggestion | The tampered-working-copy test checks only that no snapshot exists when openAmend refuses. It does not check that the amend is still closed, so a refusal can leave the marker and session in place and the lock guard then allows writes to locked files. | packages/accord-core/tests/contract-amend-session.test.ts:285 |  |
| 22 | AC-9 | F-016 | unresolved (advisory) | open | suggestion | No test runs a second amend after one completes. The done path can leave the session file behind, and openAmend can snapshot from the contract tag instead of the trusted lock, and both still pass. | packages/accord-core/tests/contract-amend-session.test.ts:533 |  |
| 22 | AC-9 | F-017 | unresolved (advisory) | open | suggestion | Today's no-reason form `/dev amend-spec <ID>` is not tested when there is no lock or no stack. Every AC-26 test passes 'some reason', so an impl that refuses a blank reason before it checks for the lock or stack breaks backward compatibility. | packages/accord-core/tests/contract-amend-session.test.ts:502 |  |
| 22 | AC-9 | F-018 | unresolved (advisory) | open | suggestion | amendments[0].diff is checked only for the new wording, so storing the full new spec.json (not a diff) passes. | packages/accord-core/tests/contract-amend-session.test.ts:552 |  |
| 22 | AC-9 | F-019 | unresolved (advisory) | open | suggestion | affectedAcsFromSpecDiff is not tested for changes to AC fields other than requirement, type, criterion and scenario, such as `enforcement` or `feature`. | packages/accord-core/tests/contract-amend-session.test.ts:359 |  |
| 22 | AC-9 | F-021 | unresolved (advisory) | open | warning | `applyContractAmend` and the steps after it are not guarded. A throw rejects the whole `processSubagentToolResult` batch. | packages/accord-core/src/contract/amend-session.ts:208 |  |
| 22 | AC-9 | F-022 | unresolved (advisory) | open | warning | `stuck` and `--cancel` delete the snapshot but leave the amended spec.json and plan.json in the working tree. A follow-up `/dev amend-spec` is then refused. | packages/accord-core/src/contract/amend-session.ts:89 |  |
| 22 | AC-9 | F-023 | unresolved (advisory) | open | warning | The amend commit emits no `stack.commit.created`, unlike every other orchestrator commit. | packages/accord-core/src/contract/amend-session.ts:208 |  |
| 22 | AC-9 | F-024 | unresolved (advisory) | open | suggestion | The handoff note says `blocked stale tasks: …` but lists every stale id from `applyContractAmend`. | packages/accord-core/src/contract/amend-session.ts:220 |  |
| 22 | AC-9 | F-025 | unresolved (advisory) | open | suggestion | Affected ACs come only from `acceptance_criteria` entries by id, so other spec changes get an empty diff and no stale tasks. | packages/accord-core/src/contract/amend-session.ts:131 |  |
| 22 | AC-9 | F-026 | unresolved (advisory) | open | suggestion | `blockStaleTasks` re-implements the block mutation from queries/block-task.ts `blockOne`. | packages/accord-core/src/contract/amend-session.ts:165 |  |
| 22 | AC-9 | F-027 | unresolved (advisory) | open | suggestion | `setCoarsePhase` does an unlocked read-modify-write of the work item file with an untyped cast. | packages/accord-core/src/contract/amend-session.ts:178 |  |
| 22 | AC-9 | F-028 | unresolved (advisory) | open | suggestion | `AMEND_AGENTS` and the lock path are duplicated. | packages/accord-core/src/contract/amend-session.ts:163 |  |
| 22 | AC-9 | F-029 | unresolved (advisory) | open | suggestion | `parseAmendArgs` hand-rolls a whitespace split. Quotes stay in the reason, `--replan` and `--cancel` are stripped from any position, and spaces collapse. | packages/accord-core/src/orchestration/resolve/subcommand.ts:94 |  |
| 22 | AC-31 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | AC-31 is claimed in ac_covered but has no runtime test, which is acceptable for an architectural AC. validate:okf checks structure but does not check that an amend-spec entry was appended. okf/references/dev-command.md:40 still documents `/dev amend-spec <ID>` without the reason, --replan and --cancel arguments. | packages/accord-core/tests/contract-amend-session.test.ts:30 | wont_fix_accepted by T2/review-test — AC-31 is architectural. Enforcement belongs to phase-verify-task: bun run validate:okf, validate:ste and check:biome, plus a grep for the amend-spec entry in okf/log.md. |
| 22 | AC-31 | F-020 | unresolved (advisory) | open | warning | Log entry is appended under the stale `## 2026-10-02` heading and claims Evidence stack and Hooks concepts were updated, but neither describes the amend session. | okf/log.md:76 |  |
| 23 | AC-9 | F-003 | unresolved (advisory) | reraised | suggestion | Changes to contract.lock.json itself are untested. A rule that discovers locks only at head (or that treats any lock added in the range as PR0, or that trusts the head lock's preceding_commit when the lock is not on base) passes every test. A PR that deletes or replaces the lock then edits locked files freely. | packages/accord-ci/tests/contract-lock-check.test.ts:217 | reraised by T2/review-test — Original Done-when met: all five cases exist with exitCode 1 and path assertions. Target changed: my original list missed a valid-JSON lock rewrite with no deletion and no locked-file edit. That gap allows a two-PR bypass if the rule only detects a missing or unreadable lock and trusts the base-tree lock. Downgraded to non-gating suggestion. See findings[0] for the two extra lockCases entries. |
| 23 | AC-9 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The push-to-main run is unspecified. The workflow also runs on push with base=github.event.before and head=the squash commit. A squash-merged amend commit (no trailer, touches locked files) will likely fail the status on main, which conflicts with the 'main green' constraint. Only later PRs are tested. | packages/accord-ci/tests/contract-lock-check.test.ts:267 | wont_fix_accepted by T2/review-test — Sound: the spec does not define the result of the push-to-main run over a squash-merged amend, and a squash without a trailer cannot be told apart from a forged edit. Needs a human or spec decision; flagged in analysis. The later-PR behaviour stays covered. |
| 23 | AC-9 | F-015 | unresolved (advisory) | open | suggestion | Merge tests cover an evil merge and a benign merge of main. A merge of a side branch (not base) that carries a regular locked-file edit in its own commit is untested. | packages/accord-ci/tests/contract-lock-check.test.ts:444 |  |
| 23 | AC-9 | F-016 | unresolved (advisory) | open | suggestion | Every amend test has a single amend as the last commit in the PR. Nothing checks that the rule moves its trusted lock forward after an in-PR amend. | packages/accord-ci/tests/contract-lock-check.test.ts:182 |  |
| 23 | AC-9 | F-017 | unresolved (advisory) | open | warning | On the push-to-main run, a squash-merged amend PR can fail the check because only a commit trailer marks an amend, and trailers do not reliably survive squash. | packages/accord-ci/src/checks/contract-lock.ts:171 |  |
| 23 | AC-9 | F-018 | unresolved (advisory) | open | suggestion | `git ls-tree -r --name-only <base>` lists only the cwd subtree with cwd-relative names, so the guard fails open when the rule runs from a subdirectory. | packages/accord-ci/src/checks/contract-lock.ts:145 |  |
| 23 | AC-9 | F-019 | unresolved (advisory) | open | suggestion | Step drift: the plan says the rule calls `verifyContractLock` over the PR head, but the impl never calls it. | packages/accord-ci/src/checks/contract-lock.ts:138 |  |
| 23 | AC-9 | F-020 | unresolved (advisory) | open | suggestion | Parallel implementations of existing core helpers. | packages/accord-ci/src/checks/contract-lock.ts:68 |  |
| 23 | AC-9 | F-021 | unresolved (advisory) | open | suggestion | `hashAt` writes each blob to a fresh temp dir only to call `hashLocked(rel, dir)`. | packages/accord-ci/src/checks/contract-lock.ts:77 |  |
| 23 | AC-9 | F-022 | unresolved (advisory) | open | suggestion | The amend scope is a second source of truth next to the `owned` list in `applyContractAmend`. | packages/accord-ci/src/checks/contract-lock.ts:102 |  |
| 23 | AC-9 | F-023 | unresolved (advisory) | open | suggestion | Merge-commit intersection is O(n·m) with `Array.includes`. | packages/accord-ci/src/checks/contract-lock.ts:49 |  |
| 23 | AC-31 | F-024 | unresolved (advisory) | open | suggestion | The new entry sits under a second `## 2026-10-06` heading at the end of the file, while the sibling ASDLC-1 entries (security-gate, evidence-asset, commit-evidence, contract-lock hook) are under `## 2026-10-30` at the top. | okf/log.md:78 |  |
| 24 | AC-31 | F-001 | unresolved (advisory) | open | warning | evidence-stack.md test is satisfied mostly by text that already exists. Only `outcome=amend` and a `src/contract/` source prefix are new requirements. The status line and Layering section can still say contract-lock is proposed. | packages/accord-core/tests/docs-validation.test.ts:300 |  |
| 24 | AC-31 | F-002 | unresolved (advisory) | open | warning | Lock-exclusion negation `/not\|no \|exclud/i` is substring-loose. It matches 'note', 'notes', 'annotated', 'another' and 'no other'. A line saying the lock DOES hash state/work-item.json passes. | packages/accord-core/tests/docs-validation.test.ts:316 |  |
| 24 | AC-31 | F-003 | unresolved (advisory) | open | warning | artifacts-and-state.md test checks 4 tokens anywhere in the file. contract.lock.json is a committed docs/dev/<ID>/ artifact but does not have to appear in the Committed table. The test does not check its contents (sha256 of the 3 files plus the preceding commit), its condition (stack.enabled) or a source binding. | packages/accord-core/tests/docs-validation.test.ts:319 |  |
| 24 | AC-31 | F-004 | unresolved (advisory) | open | warning | dev-command.md amend-spec row checks flag tokens one by one. It does not check the syntax order. It does not require the row to say the contract-amend flow runs only with stack.enabled and an existing contract.lock.json (otherwise behaviour is unchanged, AC-26). dev-command.md sources do not cover the amend code. | packages/accord-core/tests/docs-validation.test.ts:327 |  |
| 24 | AC-31 | F-005 | unresolved (advisory) | open | warning | The log test does not require a NEW appended entry. Editing the existing 2026-10-30 hooks contract-lock bullet in place passes both this test and the task-20 lock-guard log test, which violates AC-31 'append a dated entry' and the append-only log rule. | packages/accord-core/tests/docs-validation.test.ts:338 |  |
| 25 | AC-10 | F-001 | unresolved (advisory) | open | warning | The phase-plan.md test searches the whole file, not the Stack planning section. 'challenge' already appears in the file ('Challenge flag', L73), so that check passes before any change. The required rule 'challenge tasks above stack.sizing budgets' (the plan-side half of AC-10's flag-for-re-plan, never-split rule) is not pinned. | packages/accord-core/tests/alignment.test.ts:237 |  |
| 25 | AC-10 | F-004 | unresolved (advisory) | open | warning | Traceability drift. ac_covered claims AC-10, but no test name or describe in the file mentions ASDLC-1/AC-10. AC-26 tests exist (L253-372) but AC-26 is in neither ac_covered nor task.covers_ac. TC-11 (computeStack golden tests) belongs to task 26, so this task's AC-10 slice is only the plan fields. | packages/accord-core/tests/alignment.test.ts:116 |  |
| 25 | AC-30 | F-006 | unresolved (advisory) | open | suggestion | 'the plan example fixtures remain valid via validate:schemas' does not check what its name says. validate-examples.mjs only maps examples/*.json to return or artifact schemas, and there is no examples/plan.json, so the test duplicates L30. No real committed plan is checked against the changed schema. | packages/accord-core/tests/alignment.test.ts:189 |  |
| 25 | AC-30 | F-007 | unresolved (advisory) | open | suggestion | The fault-injection copy is written inside the repo (packages/.align-*), and that path is not gitignored. A timeout or crash before afterEach leaves an untracked copy of accord-assets that biome, validate-okf or git-status-based checks may pick up. | packages/accord-core/tests/alignment.test.ts:199 |  |
| 25 | AC-31 | F-008 | unresolved (advisory) | open | suggestion | The schemas.md test is a whole-file word search. The 'schema' check is already true (the file says 'schema' throughout). Field names and kind values can appear anywhere, unrelated to plan-schema.json. | packages/accord-core/tests/alignment.test.ts:242 |  |
| 25 | _task | F-002 | unresolved (advisory) | open | warning | With stack enabled, the tests only check that the budget numbers appear somewhere in the text. They don't check which key each number belongs to. A partly set sizing block (one key set, others defaulted) is never tested. | packages/accord-core/tests/alignment.test.ts:347 |  |
| 25 | _task | F-003 | unresolved (advisory) | open | warning | AC-26 (MUST, property) says planning is unchanged when the stack is off. The three stack-off tests only check that 'stack_enabled' and /stack planning/i are absent, plus '321' in one case. Any other stack text added when the stack is off passes. | packages/accord-core/tests/alignment.test.ts:320 |  |
| 25 | _task | F-005 | unresolved (advisory) | open | suggestion | No test checks the phase-spec task text with stack enabled. An impl that adds the stack block to every interview agent (phase-spec too) passes. The spec limits it to the phase-plan task text. | packages/accord-core/tests/alignment.test.ts:303 |  |
| 26 | AC-10 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The tests read 'flag' in pass B ('unless the task is a refactor, schema, or flag') as 'task.flag is set, so the task never merges'. AC-17 says that under require_flag every non-final task carries a flag. With this reading, merging is turned off for those stacks. kind 'enable' (the task that flips the flag) is also not tested. | packages/accord-core/tests/compute-stack.test.ts:154 | wont_fix_accepted by T2/review-test — Sound reason: plan section 4.2 pass B does not say whether 'flag' means task.flag or kind 'enable', and the tests apply the task.flag reading consistently. A human should confirm, because with require_flag (AC-17) this reading disables merging. |
| 26 | AC-10 | F-019 | accepted (advisory) | wont_fix_accepted | suggestion | A missing est_lines counts as 0, so unknown-size same-concern tasks always merge as 'below min_pr_lines' and bypass the line budget. | packages/accord-core/src/stack/compute-stack.ts:62 | wont_fix_accepted by C3/review-code — Advisory suggestion. A missing est_lines counts as 0, which a legacy-tasks test relies on. Not a correctness bug. |
| 26 | AC-10 | F-021 | accepted (advisory) | wont_fix_accepted | suggestion | StackSizing duplicates the sizing shape in config/stack-flags.ts and config/types.ts, so the three can drift. | packages/accord-core/src/stack/types.ts:15 | wont_fix_accepted by C3/review-code — Reason is scope: deriving StackSizing from the resolved config type belongs to the task that wires resolveStackConfig into computeStack. The finding is not a correctness bug. |
| 27 | AC-11 | F-006 | unresolved (advisory) | reraised | warning | Absent optional fields are never checked for leaking as NaN/undefined. Trailers omit absent keys (commit-grammar: 'absent keys are omitted, never null'), but every trailer in the roll-up fixture carries crit/warn/sugg/tok_in/tok_out/usd_u. A brief AC without text is also never checked for 'undefined'. | packages/accord-core/tests/stack-render.test.ts:357 | reraised by T2/review-test — Unmet: 'In the line 80 test add expect(md).not.toContain("undefined")'. It was added to the section-order test, where all ACs have text. The test with an AC that has no text still does not check for 'undefined'. The report half is met. |
| 27 | AC-11 | F-015 | unresolved (advisory) | open | suggestion | The tests cannot tell the 'tests' cell built from the latest test-bearing trailer apart from one built from the latest trailer. No T-loop trailer without t_pass or t_fail comes after the trailers that have them. In real T loops a review-test trailer (no t_* keys) usually comes last. This gap was missed in round 1 (the loop T fixture has not changed). | packages/accord-core/tests/stack-render.test.ts:452 |  |
| 27 | AC-11 | F-016 | unresolved (advisory) | open | suggestion | The stack map is never checked for leaked null or undefined, but the contract entry has `concern: null`, `acs: []` and no depends_on_prs. This gap was missed in round 1 (the entries fixture has not changed). | packages/accord-core/tests/stack-render.test.ts:185 |  |
| 28 | AC-11 | F-013 | unresolved (advisory) | open | suggestion | Every setEvidenceStatus call requests state 'success', so the requested state and the 'only upgrade missing or pending' rule are untested for other inputs. | packages/accord-core/tests/stack-provider-gh.test.ts:415 |  |
| 28 | AC-11 | F-014 | unresolved (advisory) | open | suggestion | No test makes the status read fail while writes would succeed, so a fail-open impl (catch the read error, treat it as 'missing', write) passes and can overwrite a CI failure. | packages/accord-core/tests/stack-provider-gh.test.ts:383 |  |
| 28 | AC-11 | F-015 | unresolved (advisory) | open | suggestion | The fake gh returns every fixture field whatever `--json` requests, and `--limit` is never asserted. An impl that omits baseRefName or url from `--json`, or that relies on gh's default 30-PR cap, passes but fails or truncates in production. | packages/accord-core/tests/stack-provider-gh.test.ts:435 |  |
| 28 | AC-11 | F-016 | unresolved (advisory) | open | suggestion | `git push --force-with-lease --force-if-includes origin feat` is rejected in the diverged case, so it passes. It still rewrites remote history after a local amend, which breaks 'evidence commits are append-only, no force-push'. | packages/accord-core/tests/stack-provider-gh.test.ts:641 |  |
| 28 | AC-11 | F-017 | unresolved (advisory) | open | suggestion | The gh tests are not hermetic. Most tests call resolveStackProvider('gh') without a cwd, so gh runs in the repo worktree with the inherited GH_TOKEN and the developer's gh auth. An impl that resolves the gh path once at import (Bun.which before installGh changes PATH) or uses an absolute path would call real GitHub. For example, the upsert tests would POST or PATCH comments on real issue #7. | packages/accord-core/tests/stack-provider-gh.test.ts:95 |  |
| 28 | AC-11 | F-018 | unresolved (advisory) | open | suggestion | createOrUpdatePr is never given a closed or merged PR on the same head. An impl that lists with `--state all` and edits the first result changes a merged PR body instead of opening a new PR. | packages/accord-core/tests/stack-provider-gh.test.ts:137 |  |
| 28 | AC-11 | F-019 | unresolved (advisory) | open | warning | listPrs silently truncates to gh's default 30 PRs, so unfiltered listing (accord stack sync) can miss stack PRs. | packages/accord-core/src/stack/gh-provider.ts:70 |  |
| 28 | AC-11 | F-020 | unresolved (advisory) | open | warning | setEvidenceStatus reads only the first page of the combined status, so the never-replace-a-CI-failure guard can miss accord/evidence. | packages/accord-core/src/stack/gh-provider.ts:126 |  |
| 28 | AC-11 | F-021 | unresolved (advisory) | open | suggestion | Failure messages carry little diagnostic value and execFile has no timeout. | packages/accord-core/src/stack/gh-provider.ts:29 |  |
| 28 | AC-11 | F-022 | unresolved (advisory) | open | suggestion | A second git runner duplicates `git()` in src/git/helpers.ts. | packages/accord-core/src/stack/gh-provider.ts:67 |  |
| 28 | AC-11 | F-023 | unresolved (advisory) | open | suggestion | createOrUpdatePr returns the whole trimmed stdout as `url`, not the extracted PR URL. | packages/accord-core/src/stack/gh-provider.ts:91 |  |
| 29 | AC-11 | F-011 | accepted (advisory) | wont_fix_accepted | warning | The resolver signature (taskId) => number[] has no work item id, and the fixture has exactly one docs/dev/*/plan.json, so 'first plan containing the task' passes. In real repos many work items share task ids. | packages/accord-core/tests/stack-service.test.ts:469 | wont_fix_accepted by T2/review-test — Sound scope reason. PrGroupResolver(taskId) has no workItemId and hooks.ts is outside task files. The multi-work-item ambiguity is a real interface gap; a human or review-code should decide (for example, pass workItemId through resolvePrGroup in a follow-up task). |
| 29 | AC-11 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | dev_stack* tools are only checked in ACCORD_TOOLS. The MCP adapter path is not exercised, and Pi dynamic-tool bundles (active-set.ts ACCORD_TOOL_BUNDLES) would leave them inactive in Pi sessions. | packages/accord-core/tests/stack-service.test.ts:500 | wont_fix_accepted by T2/review-test — MCP register-tools.ts iterates every ACCORD_TOOLS entry, so the MCP path is covered by the ACCORD_TOOLS assertions. Pi bundle activation needs tools/active-set.ts, which is outside task files. Flagged for review-code as follow-up. |
| 29 | AC-11 | F-016 | unresolved (advisory) | open | warning | The fake listPrs treats `state === undefined` as all states, but the only real adapter (gh-provider listPrs) adds --state only when given, and `gh pr list` then returns open PRs only. The sync test's 'merged' assertion therefore passes for a sync that calls listPrs() or listPrs({head}) without state 'all'. Against real GitHub, merged PRs disappear from `accord stack sync`. | packages/accord-core/tests/stack-service.test.ts:180 |  |
| 29 | AC-11 | F-017 | unresolved (advisory) | open | warning | The resolver probes run in a repo with no AGENTS.md Dev Harness config, so only default sizing is exercised. A resolver registered at load time with `resolveStackConfig(null).sizing`, ignoring the project's configured stack.sizing, passes every probe. stackSubmit honours configured sizing (CUSTOM test), so the evidence(task-<N>,<M>) groups would not match the submitted PR groups whenever sizing is customised. | packages/accord-core/tests/stack-service.test.ts:820 |  |
| 29 | AC-11 | F-018 | unresolved (advisory) | open | suggestion | The 'process summary non-blank' check slices from '## Process summary' to '## Reading order'. renderPrBrief always places '## Accepted risks' with '- None' in between, so `summary: ""` still passes. The adversarial impl passes an empty summary. | packages/accord-core/tests/stack-service.test.ts:434 |  |
| 29 | AC-11 | F-019 | unresolved (advisory) | open | suggestion | The cwd test injects the fake provider, and the real gh provider path (line 534) always runs with process.cwd() === repo. A service that calls resolveStackProvider(name) without { cwd } passes. Its git branch and push commands then run in the caller's cwd, for example an MCP server or CLI started elsewhere. | packages/accord-core/tests/stack-service.test.ts:322 |  |
| 29 | AC-11 | F-020 | unresolved (advisory) | open | suggestion | Submit and sync branch side effects are partly unpinned. (a) The dependent PR's ensureBranch base is not asserted, so beta can be ensured from main while the PR base is alpha's head. (b) Push-before-create order is not asserted; real `gh pr create` fails if the head is not pushed yet. (c) The sync test does not assert fake.ensures is empty, so a sync that creates local branches passes. | packages/accord-core/tests/stack-service.test.ts:412 |  |
| 29 | AC-11 | F-021 | unresolved (advisory) | open | warning | Stack head branches are named `accord/<ID>/task-<N>`, but the plan puts local stack branches in `stack/<ID>/pr-<n>`, distinct from the CI-driven `accord/*/**` namespace. | packages/accord-core/src/stack/service.ts:63 |  |
| 29 | AC-11 | F-022 | unresolved (advisory) | open | warning | `resolveGroup` takes only a task id, so it picks the first `docs/dev/*/plan.json` containing that id. It also computes groups with default sizing (`resolveStackConfig(null)`), ignoring the repo's `stack.sizing`. | packages/accord-core/src/stack/service.ts:268 |  |
| 29 | AC-11 | F-023 | unresolved (advisory) | open | warning | The four `dev_stack*` tools are not in any bundle in `tools/active-set.ts`, so the Pi adapter never activates them. | packages/accord-core/src/tools/registry.ts:856 |  |
| 29 | AC-11 | F-024 | unresolved (advisory) | open | warning | stackSync lists all PRs with `state: 'all'` and builds a head→PR map where the last entry wins. That can miss stack PRs or report a stale closed one. | packages/accord-core/src/stack/service.ts:126 |  |
| 29 | AC-11 | F-025 | unresolved (advisory) | open | warning | stackReport reads only HEAD's history, loads every commit body into one 10 MB-capped buffer, and turns any git failure into an empty successful report. | packages/accord-core/src/stack/service.ts:249 |  |
| 29 | AC-11 | F-026 | unresolved (advisory) | open | suggestion | stackSync takes each PR's ACs by re-rendering the whole stack table and picking a cell with `.split('\n')[2].split('\|')[4]`. | packages/accord-core/src/stack/service.ts:130 |  |
| 29 | AC-28 | F-013 | accepted (advisory) | wont_fix_accepted | suggestion | AC-28 enforcement (check:types, check:bundle) cannot be proven by unit tests. Source-regex checks only pin the declaration. | packages/accord-core/tests/stack-service.test.ts:492 | wont_fix_accepted by T2/review-test — Enforcement is a verify concern. The task verify step lists check:types, check:bundle and check:runtime, and layering.test.ts covers the import boundary for all of src. |
| 30 | AC-11 | F-009 | accepted (advisory) | wont_fix_accepted | warning | The success fixture lists only pr-1 and pr-3 although computeStack(PLAN) yields task PRs 1-4, so the tests pin 'a computed task PR absent from provider state counts as merged'. Combined with service.ts stackSubmit naming heads accord/<ID>/task-<N> (open advisory F-021), the real provider never lists any stack/<ID>/pr-* head, so the closeout guard passes even when every task PR is open. | packages/accord-core/tests/stack-branches.test.ts:431 | wont_fix_accepted by T2/review-test — Accepted as out of scope for task 30's tests; the success fixture now lists pr-1..pr-4 merged, so it holds under either semantics. NEEDS HUMAN: service.ts stackSubmit (task 29) pushes task PRs as accord/<ID>/task-<N>, a CI trigger namespace, while the closeout guard watches stack/<ID>/pr-<n>. In production the guard sees no task PRs. The fix belongs in task 29 or in a plan decision, not in these tests. |
| 30 | AC-11 | F-010 | unresolved (advisory) | reraised | warning | scope_out says quick_fix work items keep one branch and one PR. No test covers a phase-test spawn for a quick_fix item with stack.enabled. An impl that switches every phase-test with a task_id creates stack/<ID>/pr-n for quick fixes. If the impl propagates refusals instead, a quick_fix with no plan.json is blocked. | packages/accord-core/tests/stack-branches.test.ts:311 | reraised by T2/review-test — Rebuttal: no invented interface is needed. The work-item pattern lives in .tasks/<ID>.json and is read by loadWorkItem(), which this same preflight already calls (workflow-state-spawn.ts:55). writeTaskFixture accepts quickFixContract, and evidence-commit.test.ts:117-135 already seeds such a file. Quick fixes write docs/dev/<ID>/plan.json with task 1 (code-brief.ts writeQuickFixStubs). An impl that follows the step literally therefore creates stack/<ID>/pr-1 for quick fixes, or blocks them on the missing contract tag, against scope_out. Test: setup(false); write .tasks/ASDLC-9.json with {schema_version:'1.0', id:ID, title:'qf', created, updated, pattern:'quick_fix', phase:'fixing', task_ids:[1], spec, plan:`docs/dev/${ID}/plan.json`, verify:null, brief:null, decisions:[], deviations:[], cost_usd:0}. Call writeTaskFixture({workItemId:ID, taskId:1, quickFixContract:{...}}, repo) and add `**owner_nonce:** abcdef` to the brief if nonce sync needs it. Call runSubagentToolPreflight(spawn('phase-test',1), options(ENABLED)). Done when: this test asserts blockReason toBeUndefined(), HEAD unchanged, and no branch starting with 'stack/', and it passes against the current pre-impl preflight. Passing now proves the fixture itself does not block. |
| 30 | AC-11 | F-013 | unresolved (advisory) | reraised | suggestion | Ordering against the in_flight pin is unasserted. An impl that runs ensureTaskBranch after prepareWorkflowStateForSubagentInput pins control.in_flight on disk and then returns a dirty-tree blockReason, leaving a phantom in-flight spawn. | packages/accord-core/tests/stack-branches.test.ts:323 | reraised by T2/review-test — The storage format is specified: TaskFileV2.control.in_flight (tasks/types.ts:202), readable via readTaskFixture(ID, 1, repo). Sketch: seed .tasks/<ID>.json (pattern 'implement') and writeTaskFixture task 1; .tasks/ is untracked, so it does not dirty the tree. Then make README.md dirty and run the phase-test/1 preflight. Assert blockReason matches /uncommitted\|dirty/i and readTaskFixture(ID,1,repo).control.in_flight is null. Non-gating. |
| 30 | AC-11 | F-014 | unresolved (advisory) | open | suggestion | Hook delegation is tautological. The delegation test registers mod.ensureCloseoutBranch itself, and the subprocess probes (line 672) only print typeof the hook. So whatever branches.ts registers at load time is never invoked. | packages/accord-core/tests/stack-branches.test.ts:690 |  |
| 30 | AC-11 | F-015 | unresolved (advisory) | open | suggestion | The /evil/ alternative is satisfied by git's own failure. With no id validation, the impl reads docs/evil/plan.json and then fails on rev-parse 'accord/../evil/contract' or on the invalid ref 'stack/../evil/pr-1'. The resulting error text contains 'evil' but not 'plan.json'. | packages/accord-core/tests/stack-branches.test.ts:379 |  |
| 30 | AC-11 | F-016 | unresolved (advisory) | open | suggestion | Every closeout test injects options.provider. The production hook contract passes only {cwd}, so the provider-resolution path is untested (round-1 miss). | packages/accord-core/tests/stack-branches.test.ts:556 |  |
| 30 | AC-11 | F-017 | unresolved (advisory) | open | suggestion | 'No force' is pinned only by tip equality on independent-task and closeout re-entry. Chain-branch re-entry is untested, and no test spies on git helper arguments (round-1 miss). | packages/accord-core/tests/stack-branches.test.ts:256 |  |
| 30 | AC-11 | F-018 | unresolved (advisory) | open | warning | While PR0 is unmerged, new task branches are based on the frozen `accord/<ID>/contract` tag, so they miss any later contract-amend commit on the PR0 branch. | packages/accord-core/src/stack/branches.ts:91 |  |
| 30 | AC-11 | F-019 | unresolved (advisory) | open | warning | The closeout unmerged-PR guard matches heads with prefix `stack/<ID>/pr-`, but `stackSubmit` creates PRs from heads named `accord/<ID>/task-<N>` (service.ts `headFor`, open F-021 from task 29), so the guard never matches submitted PRs. | packages/accord-core/src/stack/branches.ts:163 |  |
| 30 | AC-11 | F-020 | unresolved (advisory) | open | warning | `ensureCloseoutBranch` has no same-branch short-circuit and refuses on a dirty tree even when HEAD is already `stack/<ID>/closeout`. It also hits the provider on every call. `ensureTaskBranch` does short-circuit. | packages/accord-core/src/stack/branches.ts:161 |  |
| 30 | AC-11 | F-021 | unresolved (advisory) | open | suggestion | On re-entry the base is resolved (fetch, parent-branch lookup, contract tag) before checking whether the target branch already exists, so a pure re-entry can be refused for a missing parent branch or tag. | packages/accord-core/src/stack/branches.ts:129 |  |
| 30 | AC-11 | F-022 | unresolved (advisory) | open | suggestion | The brief parsing duplicates `extractWorkItemId` and `extractTaskIdFromTaskText` (telemetry/usage.ts), and the branch switch silently does nothing on a brief mismatch, a corrupt plan, a task absent from the plan, or a failed fetch. | packages/accord-core/src/subagent/preflight-runner.ts:93 |  |
| 30 | AC-11 | F-023 | unresolved (advisory) | open | suggestion | `git checkout -b <branch> origin/main` makes the new branch track origin/main. | packages/accord-core/src/stack/branches.ts:68 |  |
| 30 | AC-11 | F-024 | unresolved (advisory) | open | suggestion | `gh pr list` is called without `--limit`, so it returns at most 30 PRs. The new closeout guard relies on `listPrs({state:'all'})` being complete. | packages/accord-core/src/stack/gh-provider.ts:70 |  |
| 30 | AC-11 | F-025 | unresolved (advisory) | open | suggestion | `readPlanTasks` and the safe-id regex duplicate `readPlan` in stack/service.ts and `WORK_ITEM_ID_PATTERN` in work-items/io.ts. | packages/accord-core/src/stack/branches.ts:76 |  |

## Decisions

- **phase-code-stuck-1** (escalation, resolved): check:biome fails on files outside task scope: docs/dev/ASDLC-1/trace.json (format) and packages/accord-core/scripts/update-model-pricing.ts:84 (useOptionalChain). Authorize fixing them, or accept? → Do not fix out-of-scope files. Accept the baseline check:biome failures (docs/dev/ASDLC-1/trace.json, scripts/update-model-pricing.ts); task 14 is markdown-only.
- **esc-ASDLC-1-14-T2/phase-test#0** (escalation, resolved): check:biome fails on the baseline for reasons outside task 14 files: lint error in packages/accord-core/scripts/update-model-pricing.ts and format error in docs/dev/ASDLC-1/trace.json. Fix both, or exclude generated docs/dev/**/trace.json from Biome, before phase-code can turn that test green. → Fixed both baseline biome failures manually (formatted trace.json, optional-chain in update-model-pricing.ts). check:biome is green; proceed.
- **phase-code-stuck-2** (escalation, resolved): 2 tests write .git/hooks/pre-commit without creating .git/hooks (absent here because the git template dir is missing). Fix tests (mkdir -p hooks) so they can pass? → Yes: tests must mkdir -p .git/hooks before writing pre-commit (git template dir may be absent). Respawn phase-test to fix those 2 tests; phase-code must not edit tests.

## Deviations

- Task 2 (accepted): layering.test.ts import-boundary tests pass without impl — accord-core src currently has no Pi imports; AC-28 is a regression guard, and the scanner self-check proves it fails on violations
- Task 4 (accepted): Added a test requiring an okf concept to list the evidence-check script or workflow as a source and mention accord/evidence. — F-005: the AC-31 clause 'update the affected okf/ concepts'. The natural file, okf/architecture/monorepo-packages.md, is not in task.files[]; the implementer must edit it, or another okf concept.
- Task 4 (accepted): Modified okf/architecture/monorepo-packages.md (sources + accord-ci row) outside task.files — Test requires an okf concept listing the evidence check as a source and describing accord/evidence
- Task 6 (accepted): Pinned unspecified contract: guardStagedPaths returns {kept,rejected,rule?,respawn?}; guardTrailer(workItemId, trailer, ctx) returns {ok,rule,errors}; event ref = commitType (paths) / trailer.ref (trailer); phase-test unrestricted; state/evidence/verify scopes as documented. — Spec names only rule/respawn/rejected; shape and per-type scopes inferred.
- Task 6 (accepted): redact.test.ts covers AC-12 (named in the plan step) though task covers_ac is AC-3/AC-29; ac_ids for it set to AC-3 only for attribution. — Plan step tags redaction tests as ASDLC-1/AC-12, which is outside this task's covers_ac.
- Task 8 (accepted): Pinned the row shape, column set, md/tsv exact text, and the chdir-based cwd for readTimeline in the test header. The spec only names ref, outcome, counts, tokens, cost and 'the documented awk extraction'. — Spec leaves the concrete column contract open. The columns are the trailer keys the documented awk reads. The implementer must match them or ask to amend the tests.
- Task 9 (accepted): Exported runEvidenceCommand from commands/index.ts (not in task.files) — dispatch.ts imports commands via the index barrel
- Task 11 (accepted): AC-30 has no dedicated test in qualified-ac-refs.test.ts; the trace-schema ac_id widening is covered indirectly via validateArtifact on a qualified trace.json. — AC-30 is enforced by bun run validate:schemas / validate:assets (phase-verify-task), and TC-31 lives in alignment.test.ts, which is outside this task's files.
- Task 13 (accepted): Edited phase-commits.test.ts (not in task.files) to add wiring cases and fix the V1-is-last assertion — F-001 required orchestrator wiring tests and removal of the V1-last assertion
- Task 13 (accepted): Stubbed registerCloseoutBranchHook(hook|undefined) and getCloseoutBranchHook() with an opaque hook type — F-010: spec leaves the closeout hook shape open; only default and registration identity are pinned
- Task 15 (accepted): The review-code re-raise rows (F-001) pass review-code's own gate to applyRechecks and applyReviewFindings. Making them pass likely needs a change in review-code.ts, which is outside task.files. — Under the default review-code gate (block), a re-raised security warning would turn advisory again; the AC-8 re-raise rows expect it to stay gating.
- Task 15 (accepted): Modified review-code.ts (not in task.files) to pass securityGate to recordReview — review-code re-raising a security finding must apply the security gate for the AC-8 re-raise tests
- Task 17 (accepted): Added tests for okf/architecture/agents.md, okf/architecture/crucible-verification.md and okf/references/task-file.md, which are outside plan task 17 files[]. — F-003: these concepts still say review-security never gates; AC-31 requires updating all affected okf concepts. phase-code or a follow-up task must edit them.
- Task 17 (accepted): Edited okf/architecture/agents.md, okf/architecture/crucible-verification.md, okf/references/task-file.md outside task.files[] — Tests require these concepts to stop saying review-security never gates
- Task 18 (accepted): Suite passes against the existing phase-code implementation, so red_confirmed is false. — This is a lint-fix retry round. The production code in lock.ts was already implemented in earlier rounds, so no stub is needed.
- Task 19 (accepted): Spec leaves the API of buildContractPr0, registerPreLockHook and applyContractAmend open. Tests fix it: buildContractPr0(id, devConfig, cwd) returns {ok, skipped?, reason?, hash?, tag?}; applyContractAmend(id, {diff: string, reason, affected_acs}, cwd) records amendments[] in contract.lock.json; state/work-item.json is seeded by the test, not generated by PR0. — Needed concrete contracts to write assertions; chosen to match existing helpers (commitTaskEvidence argument order, lock.ts verify semantics).
- Task 19 (accepted): Amend tests assert the amended contract.lock.json is schema-valid, which needs an `amendments` array ({diff, reason, affected_acs, stale_task_ids}) in contract-lock-schema.json. — F-009. The schema file is outside task 19 files[]; phase-code must extend it and the example under schemas/examples/.
- Task 19 (accepted): Tests expect buildContractPr0 to derive and redact docs/dev/<ID>/state/work-item.json from .tasks/<ID>.json (id, pattern), via redactText in state/redact.ts. — F-003. No other planned task writes this file into PR0.
- Task 19 (accepted): Added optional amendments[] to contract-lock-schema.json — Tests validate the amended lock through its schema; the schema had no amendments property
- Task 21 (accepted): Assumed verifyAfterSpawn(workItemId, cwd, agent?: string) with a third agent-name argument, and commit type 'amend' for guardStagedPaths; rules locked-file-written / locked-path. — Spec signature lacks the agent input needed for the phase-spec/phase-plan exception; the amend commit type name is not specified.
- Task 21 (accepted): process.ts calls verifyAfterSpawn for every attributed result rather than only when contract.lock.json exists on disk — a spawn that deletes the lock would otherwise skip verification; verifyAfterSpawn is a no-op for never-locked items
- Task 22 (accepted): Test contract chosen for amend-session.ts: openAmend(id,{reason,replan},cwd) returns {ok:true,nonce}|{ok:false,reason}; closeAmend(id,cwd); cancelAmend(id,cwd); affectedAcsFromSpecDiff(id,cwd) compares .tasks/<ID>-amend/spec.json with docs/dev/<ID>/spec.json. `/dev amend-spec` rawArgs are '<ID> <reason words> [--replan] | --cancel', via the synchronous resolveDevSubcommandOrchestration. — The spec names these functions but not their signatures; the stub carries the signatures the tests call.
- Task 22 (accepted): Phase-spec and phase-plan done packets in the tests omit spec_path and plan_path so the amended fixture files are not schema-validated. Stale tasks are asserted as status=blocked with a blocked.reason containing 'stale after contract-amend'; blocked.kind is not asserted. Unblock is tested via unblockTask(..., {force}). — The spec fixes only the blocker text and the 'existing blocked mechanism'; it does not name the block kind or the unblock options.
- Task 23 (accepted): Edited evidence-check-runner.test.ts: registry-empty assertion now expects the contract-lock rule, and main() is called with rules: [] so the real rule does not run on fake shas. — Registering the contract-lock rule makes the old 'registry.length === 0' assertion contradict AC-9; phase-code cannot edit tests.
- Task 25 (accepted): alignment.test.ts already existed (task 17); appended new describe blocks instead of adding the file. — Plan lists action add, but the file is on disk with earlier ASDLC-1 AC-30 tests that must stay.
- Task 26 (pending): Defined StackPlan/PrGroup/StackFlag output shape and the sizing input type in types.ts, because the spec does not fix them. Tests and the golden fixture pin that shape. — AC-10 names no concrete output schema; tests need a concrete contract.
- Task 29 (pending): No work-item-scoped resolver test (F-011) — PrGroupResolver carries no workItemId and hooks.ts is outside task files; no selection rule is derivable from spec
- Task 30 (pending): Test for 'closeout hook runs before any closeout artifact write' covers hook registration and delegation only; wiring into commit-on-task-done.ts is not in this task's files. Stub created at stack/branches.ts (in task.files) and does not register the hook. — Spec leaves function result shapes, PR0-merged detection and PR0 branch discovery open; contract pinned in the test file header.
- Task 30 (pending): Added side-effect import of ./branches.js in stack/service.ts (not in task.files) — Closeout hook must register when only src/index.ts or tools/registry.ts is imported; both already import service.ts

## Evidence by task

### Task 1: [flags] Stack and knowledge switch resolver with default-off values

RED evidence (`T1/phase-test`):

```text
error: not implemented: resolveReviewSecurityGate
(fail) ASDLC-1/AC-26 resolveReviewSecurityGate > ASDLC-1/AC-26 explicit block wins with stack key absent

 0 pass
 35 fail
Ran 35 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
stack-flags.test.ts: 35 pass, 0 fail. Preflight: bun test, check:biome, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle, check:runtime all exit 0.
```

### Task 2: [infra] Temp git repo, fake gh helpers and import-boundary test

- Human action `C4/unblock`: waive F-012; waive F-013 — all blockers resolved

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-28 fake gh helper > ... error: not implemented: installFakeGh (x5)
(fail) ASDLC-1/AC-28 temp git repo helper > ... error: not implemented: createTempGitRepo (x5)

 17 pass
 10 fail
 17 expect() calls
Ran 27 tests across 2 files.
```

Final verification (`V1/phase-verify-task`):

```text
task tests: 52 pass, 0 fail (2 files). check:types, check:bundle and check:biome (1 warning) passed. Preflight: bun test, biome, validate:schemas/assets/okf/ste, check:types, check:bundle and check:runtime all exit 0.
```

### Task 3: [telemetry] Stack event catalogue and emitter on the shared logger

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-29 stack telemetry (ASDLC-1/TC-30) > default shared logger (stderr) > ASDLC-1/AC-29 debug snapshot is silent at default error level, error alert is not
error: not implemented: emitStackEvent

 0 pass
 51 fail
 43 expect() calls
Ran 51 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
stack-telemetry.test.ts: 51 pass, 0 fail. bun test, check:types, validate:schemas/assets/okf/ste, check:bundle, check:runtime exit 0. biome on task files: clean. Repo-wide check:biome exit 1 (lint in a file the preflight output didn't name, trace.json format), outside task scope.
```

### Task 4: [infra] accord/evidence check runner and workflow

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-ci/tests/evidence-check-runner.test.ts
(fail) runEvidenceCheck > zero rules passes ... Error: not implemented: runEvidenceCheck
(fail) commit-status payload > ... Error: not implemented
(fail) workflow and docs declaration > ... ENOENT .github/workflows/accord-evidence.yml
(fail) docs/ci/pre-merge-smoke.md documents the accord-evidence workflow: Expected to contain "accord-evidence"
(fail) okf/log.md has an entry naming the accord-evidence workflow: Expected to contain "accord-evidence.yml"
 0 pass
 15 fail
Ran 15 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
evidence-check-runner.test.ts: 26 pass, 0 fail. Preflight: bun test, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle, check:runtime all exit 0; check:biome exit 1 (update-model-pricing.ts useOptionalChain; docs/dev/ASDLC-1/trace.json format). Workflow: fetch-depth: 0 at line 27; pull_request.head.sha at lines 37 and 44; only secrets.GITHUB_TOKEN referenced (line 43); no echo of the token.
```

### Task 5: [commit-evidence] Commit grammar: Accord trailer build, parse, validate

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-2 subject > ASDLC-1/AC-2 parseSubject rejects "random subject"
error: not implemented: parseSubject
(fail) ASDLC-1/AC-2 documented awk extraction over git log > awk extraction equals awk-extract.golden.txt and parseAccordTrailer sums
error: not implemented: buildCommitMessage

 1 pass
 68 fail
 8 expect() calls
Ran 69 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
commit-grammar.test.ts: 512 pass, 0 fail. bun test, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle, check:runtime all exit 0. check:biome exit 1: docs/dev/ASDLC-1/trace.json formatter diff (commits arrays). biome on task files: Checked 2 files, no fixes.
```

### Task 6: [commit-evidence] Commit guard and content redaction

RED evidence (`T1/phase-test`):

```text
46 fail, 0 pass across 2 files; every failure: error: not implemented: guardStagedPaths / guardTrailer / redactText (stub throws). check:types clean; secret-literal grep over packages/accord-core/tests: no match.
```

Final verification (`V1/phase-verify-task`):

```text
72 pass, 0 fail (commit-guard + redact). check:types ok. biome on task files clean; repo-wide check:biome fails only on untouched docs/dev/ASDLC-1/trace.json formatting and packages/accord-core/scripts/update-model-pricing.ts:84 useOptionalChain (pre-existing, not in task scope). Secret-token grep over packages/accord-core/tests: no match.
```

### Task 7: [commit-evidence] Orchestrator-only per-phase commits behind stack.commits phase

- Human action `T4/unblock`: waive F-002 — all blockers resolved

RED evidence (`T1/phase-test`):

```text
tests/phase-commits.test.ts + tests/append-only.test.ts: 0 pass, 12 fail. Each failure: error: not implemented: tryCommitPhase (at src/commit/phase-commit.ts:21). runtime-smoke.ts: error: not implemented: tryCommitPhase.
```

Final verification (`V1/phase-verify-task`):

```text
targeted bun test: 40 pass, 0 fail. Preflight: bun test exit 0; check:types, check:bundle, check:runtime, validate:* exit 0. Secret grep over packages/accord-core/tests: no match. check:biome repo-wide exit 1 only for docs/dev/ASDLC-1/trace.json formatting (harness-written artifact) and packages/accord-core/scripts/update-model-pricing.ts:84 useOptionalChain (pre-existing, untouched by task). biome on all task-touched files: clean.
```

### Task 8: [commit-evidence] Evidence timeline from git trailers

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-4 renderers > renderTimelineTsv matches expected text
error: not implemented: renderTimelineTsv
(fail) ASDLC-1/AC-4 renderers > renderTimelineMarkdown matches expected text
error: not implemented: readTimeline
 ... (12 tests: error: not implemented: readTimeline; 1 test: error: not implemented: renderTimelineTsv)

 0 pass
 13 fail
 2 expect() calls
Ran 13 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
evidence-timeline.test.ts: 17 pass, 0 fail. Preflight: bun test, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle and check:runtime exit 0. check:biome exit 1: format diff in docs/dev/ASDLC-1/trace.json; lint useOptionalChain in packages/accord-core/scripts/update-model-pricing.ts:84.
```

### Task 9: [commit-evidence] accord evidence CLI command

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-4 accord evidence > ASDLC-1/TC-4 default format is md ...
(fail) ... --format md equals the default output
(fail) ... --format tsv prints header plus one tab-separated line per commit
(fail) ... task-2 filters to that task (md)
(fail) ... task-2 with --format tsv filters to that task
(fail) ... --format may precede the task selector
(fail) ... tsv columns match the documented awk extraction
(fail) ... unknown format exits non-zero naming the format and the valid values
(fail) ... work item id is required
  Expected substring or pattern: /evidence requires a work item id/
  Received: "Unknown command \"evidence\". Run accord --help.\n"
(fail) ASDLC-1/AC-28 ... delegates to accord-core timeline and renderers
  Received: "export function runEvidenceCommand(... throw new Error(\"not implemented: runEvidenceCommand\") ..."
(pass) ASDLC-1/AC-28 adapter does not shell out to git or parse trailers itself
 1 pass
 10 fail
```

Final verification (`V1/phase-verify-task`):

```text
evidence-cli + no-pi-dep: 12 pass, 0 fail. Preflight: bun test, validate:schemas/assets/okf/ste, check:types, check:bundle, check:runtime all exit 0. check:biome exit 1: format of docs/dev/ASDLC-1/trace.json and lint at packages/accord-core/scripts/update-model-pricing.ts:84; `biome check packages/accord-cli` clean.
```

### Task 10: [commit-evidence] OKF docs and docs validation test

RED evidence (`T1/phase-test`):

```text
(pass) validate:okf exits 0
(pass) validate:ste exits 0
(fail) okf/log.md has a dated entry naming ASDLC-1 and the evidence command
(fail) accord-cli.md documents `accord evidence` - Expected to contain: "accord evidence"
(fail) evidence-stack.md documents the stack.commits phase mode - Expected to contain: "stack.commits"
(pass) commit-format.md documents the commit guard
 3 pass
 3 fail
```

Final verification (`V1/phase-verify-task`):

```text
docs-validation.test.ts: 7 pass, 0 fail. Preflight: bun test, check:biome, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle and check:runtime all exit 0. okf/log.md line 5 holds the ASDLC-1 commit-evidence entry.
```

### Task 11: [evidence-asset] Work-item-qualified AC refs, trace.json qualification behind stack.enabled

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-core/tests/qualified-ac-refs.test.ts: 11 pass, 20 fail. Failures: helper tests throw 'not implemented: qualifyAcRef/qualifyTcRef/findBareAcRefs/normalizeAcId'; stack.enabled trace tests expect ["ASDLC-1/AC-1","ASDLC-1/AC-2"] but received ["AC-1","AC-2"]; hand-qualified trace vs bare verify.json tests fail on exact-match lookup in findVerifyTraceDiscrepancies. Passing: stack-disabled bare/byte-identical regressions, legacy bare trace validates.
```

Final verification (`V1/phase-verify-task`):

```text
task tests: 62 pass, 0 fail
validate:schemas: 30 passed, 0 failed
validate:assets, validate:okf, validate:ste, check:types, check:bundle, check:runtime: exit 0
check:biome: exit 1. Errors: packages/accord-core/scripts/update-model-pricing.ts:84 (useOptionalChain), and the format of docs/dev/ASDLC-1/trace.json and docs/dev/ASDLC-1 state JSON (inline commits arrays). None of these files is in the task's file list.
Full bun test: 2092 pass, 1 fail. The failure is 'ASDLC-1/AC-31 check:biome exits 0', caused by the same biome errors.
```

### Task 12: [evidence-asset] Evidence asset writer (task-<N>.md and .json)

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-5 measureActualLines > an empty range measures zero
error: not implemented: measureActualLines
(fail) ASDLC-1/AC-6 qualified AC references > every AC/TC reference in md and json is ASDLC-1/AC-<n>
error: not implemented: buildEvidenceAsset
(fail) ASDLC-1/AC-12 redaction and size cap > masks seeded secrets, Bearer headers and home paths in md and json
error: not implemented: buildEvidenceAsset
(fail) ASDLC-1/AC-12 redaction and size cap > masks secrets in the written files too
error: not implemented: writeEvidenceAssets
(fail) ASDLC-1/AC-12 redaction and size cap > caps md and json at stack.state.max_bytes and keeps the json valid
error: not implemented: buildEvidenceAsset

 1 pass
 14 fail
Ran 15 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
evidence-asset.test.ts: 24 pass, 0 fail. check:types exit 0. Secret grep over packages/accord-core/tests: no match. biome on the task files (src/evidence, tests/evidence-asset.test.ts): clean. Repo-wide check:biome exit 1, on packages/accord-core/scripts/update-model-pricing.ts:84 (lint/complexity/useOptionalChain) and docs/dev/ASDLC-1/trace.json (format). Both are outside the task and unmodified in git status. Full bun test: 2116 pass, 1 fail (ASDLC-1/AC-31 check:biome exits 0), caused by the same biome failures. validate:schemas, validate:assets, validate:okf, validate:ste, check:bundle and check:runtime all pass.
```

### Task 13: [evidence-asset] Final evidence(task-<N>) commit

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-29 stack.commit.created for evidence commit > ASDLC-1/AC-29 no event on idempotent rerun
error: not implemented: commitTaskEvidence
error: not implemented: registerPrGroupResolver

 0 pass
 14 fail
Ran 14 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
task tests: 54 pass 0 fail. check:types, check:bundle, check:runtime, validate:schemas/assets/okf/ste pass. check:biome FAIL (outside task files): docs/dev/ASDLC-1/trace.json format (harness-generated); packages/accord-core/scripts/update-model-pricing.ts:84 lint/complexity/useOptionalChain. Full bun test: 2139 pass, 1 fail (AC-31 check:biome exits 0, caused by the same biome failure).
```

### Task 14: [evidence-asset] OKF docs for the evidence asset

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-core/tests/docs-validation.test.ts: 6 pass, 5 fail. (fail) check:biome exits 0 (pre-existing: lint error in packages/accord-core/scripts/update-model-pricing.ts, format error in docs/dev/ASDLC-1/trace.json). (fail) evidence-stack.md documents the evidence asset, evidence(task-<N>) commit, qualified refs and squash survival. (fail) artifacts-and-state.md lists the evidence asset with a Commands row-style table entry. (fail) artifacts-and-state.md says trace.json uses qualified <ID>/AC-<n> refs. (fail) okf/log.md has a dated entry for the evidence asset docs.
```

Final verification (`V1/phase-verify-task`):

```text
11 pass, 0 fail (docs-validation.test.ts); okf validation passed (38 files); ste lint passed; biome: Checked 647 files, no fixes applied. Preflight: all 9 verification commands exit 0.
```

### Task 15: [security-gate] review-security gating inside the C loop

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-core/tests/review-security-gate: 9 pass, 13 fail. Failures are assertion failures, e.g. 'security-only gating finding still sends the task to phase-code via review-code' Expected: "phase-code" Received: "phase-verify-task"; 'review-code re-raising the security finding keeps the loop in phase-code' Expected code_review.used 2, Received 1. Cause: review-security.ts hard-codes gate "block" and record.ts forces advisoryAll for review-security.
```

Final verification (`V1/phase-verify-task`):

```text
targeted: 39 pass, 0 fail (3 files). check:types, check:runtime, check:bundle, validate:schemas/assets/okf/ste exit 0. check:biome exit 1: only docs/dev/ASDLC-1/trace.json format (commits arrays expanded vs collapsed). Full bun test: 2174 pass, 1 fail (ASDLC-1/AC-31 check:biome exits 0, same trace.json cause).
```

### Task 16: [security-gate] Route open or disputed gating security findings back to review-security

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-core/tests/review-security-routing.test.ts: 13 pass, 13 fail. Failures: Expected "review-security", Received "review-code" after applyPhaseCodePostResult (e.g. fixed/disputed/unanswered gating security finding with non-sensitive path; gate table rows unset/block/warn/none). AC-26 advisory tests pass.
```

Final verification (`V1/phase-verify-task`):

```text
task tests: 68 pass 0 fail (3 files)
check:types exit 0
check:runtime exit 0
validate:schemas/assets/okf/ste, check:bundle exit 0
check:biome exit 1: only docs/dev/ASDLC-1/trace.json format (array inlining); task files clean
full bun test: 2214 pass, 1 fail (AC-31 check:biome exits 0, same trace.json cause)
```

### Task 17: [security-gate] Schema description and OKF docs

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-31 orchestration-policy.md documents the review-security gate, not 'always advisory'
(fail) ASDLC-1/AC-31 stack-config.md security gate section is no longer marked proposed
(fail) ASDLC-1/AC-31 okf/log.md has a dated entry for the security gate docs
(fail) ASDLC-1/AC-30 review_security description says the harness reads it (no PROPOSED marker)
(fail) ASDLC-1/AC-31 check:biome exits 0 (pre-existing formatting error in a .tasks JSON file, unrelated)
 15 pass
 5 fail
```

Final verification (`V1/phase-verify-task`):

```text
bun test exit 0; validate:schemas/assets/okf/ste exit 0; check:types/bundle/runtime exit 0; check:biome exit 1 (only docs/dev/ASDLC-1/trace.json format, harness-generated, outside task scope); biome check on task-changed files: clean.
```

### Task 18: [contract-lock] contract.lock.json writer, verifier and schema

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-9 amend marker > is not open when the marker nonce is wrong
error: not implemented: isAmendOpen
(fail) ASDLC-1/AC-30 schema alignment for contract.lock.json > schema file exists in schemas/
Expected: true
Received: false

 0 pass
 23 fail
Ran 23 tests across 1 file.
```

Final verification (`V2/phase-verify-task`):

```text
contract-lock.test.ts: 49 pass, 0 fail. validate:schemas: 30 passed, 0 failed. check:types: OK. validate:assets, validate:okf, validate:ste, check:bundle and check:runtime: OK (preflight). biome on task files: clean. check:biome repo-wide: fails only on docs/dev/ASDLC-1/trace.json formatting (harness-owned).
```

### Task 19: [contract-lock] PR0 contract commit, tag and contract-amend

RED evidence (`T1/phase-test`):

```text
bun test contract-pr0 + contract-amend: 3 pass, 30 fail. Failures are 'error: not implemented: buildContractPr0' / 'registerPreLockHook' / 'applyContractAmend' (stubs), plus a wiring assertion (HEAD has no PR0 files after the plan post-result) and /reason/i matches against 'not implemented: applyContractAmend'. The 3 passes are wiring negatives (amend open, stack disabled, contract.lock unset). check:types and biome clean.
```

Final verification (`V1/phase-verify-task`):

```text
task tests: 52 pass, 0 fail. Preflight: bun test exit 0; validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle, check:runtime all exit 0. check:biome exit 1: docs/dev/ASDLC-1/trace.json format only (arrays expanded across lines in commits[]); bunx biome check on the 6 task files is clean.
```

### Task 20: [contract-lock] Pre-write lock guard in the tool_call hook

RED evidence (`T1/phase-test`):

```text
error: not implemented: contractLockToolCallBlock
(fail) ASDLC-1/AC-9 lock guard pass-through > missing path or non-object input is untouched
(fail) ASDLC-1/AC-26 no lock file means every write passes > all locked paths pass without contract.lock.json
(fail) ASDLC-1/AC-26 no lock file means every write passes > an open amend without a lock file also passes everything

 0 pass
 23 fail
Ran 23 tests across 1 file.
```

Final verification (`V2/phase-verify-task`):

```text
61 pass, 0 fail across the 3 task test files; biome: Checked 662 files, no fixes applied; preflight: bun test, check:biome, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle and check:runtime all exit 0.
```

### Task 21: [contract-lock] Post-spawn lock verification, restore and amend-only commits

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-core/tests/contract-lock-restore.test.ts: 8 pass, 33 fail. Failures: 'error: not implemented: verifyAfterSpawn' (25 verifyAfterSpawn tests); 'error: unknown commit type: amend' (guardStagedPaths amend tests); phase-test/phase-code locked-path tests fail on assertion; forged-lock tests 'Expected: false Received: true' on verifyContractLock().unchanged.
```

Final verification (`V1/phase-verify-task`):

```text
targeted tests: 144 pass, 0 fail
bun test: exit 0
check:types, check:runtime, check:bundle, validate:schemas/assets/okf/ste: exit 0
check:biome: exit 1, 'docs/dev/ASDLC-1/trace.json format'. Checked 664 files. Found 1 error.
```

### Task 22: [contract-lock] Connect /dev amend-spec to contract-amend, amend marker and blocked downstream tasks

RED evidence (`T1/phase-test`):

```text
bun test contract-amend-session.test.ts: 31 fail (error: not implemented: openAmend; plus assertion failures: expected amend commit count 3 received 2, isAmendOpen expected true received false, task status expected 'blocked' received 'pending', ...), 4 pass (ASDLC-1/AC-26 no-lock / no-stack / stack.enabled=false / no-config guards, which pin existing behaviour), plus 'phase-spec done with no amend open commits no amend'. bun run check:types: clean.
```

Final verification (`V1/phase-verify-task`):

```text
95 pass, 0 fail across the 3 task test files; bun test (full) exit 0; validate:schemas/assets/okf/ste, check:types/bundle/runtime exit 0; check:biome exit 1 only for docs/dev/ASDLC-1/trace.json formatting (not a task file); biome check on task files: no fixes needed.
```

### Task 23: [contract-lock] Contract-lock rule in the accord/evidence CI check

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-9 locked-file edits without a contract-amend fail > non-amend commit after the lock editing spec.json fails and names the file
error: not implemented: createContractLockRule
      at createContractLockRule (packages/accord-ci/src/checks/contract-lock.ts:5:13)
(fail) ASDLC-1/AC-31 docs/ci/pre-merge-smoke.md documents the contract-lock rule > pre-merge-smoke.md mentions the contract-lock rule
Expected to contain: "contract-lock"

26 tests failed (24 'not implemented: createContractLockRule', 2 assertion failures: registry lacks contract-lock, doc lacks contract-lock)
 25 pass
 26 fail
Ran 51 tests across 2 files.
```

Final verification (`V1/phase-verify-task`):

```text
78 pass, 0 fail (contract-lock-check + evidence-check-runner). preflight: bun test, validate:schemas, validate:assets, validate:okf, validate:ste, check:types, check:bundle and check:runtime exit 0. check:biome exit 1 only on docs/dev/ASDLC-1/trace.json format. bunx biome check packages/accord-ci okf docs/ci: Checked 40 files, no fixes.
```

### Task 24: [contract-lock] OKF docs for contract PR0 and amendment

RED evidence (`T1/phase-test`):

```text
(fail) ASDLC-1/AC-31 evidence-stack.md says the lock covers brief.md, spec.json and plan.json but not state/work-item.json: expect(line).toBeDefined() Received: undefined
(fail) artifacts-and-state.md documents contract.lock.json...: Expected to contain: "contract.lock.json"
(fail) dev-command.md amend-spec row mentions the contract-amend and its flags: Expected to contain: "contract-amend" Received: "| `/dev amend-spec <ID>` | Controlled spec amendment |"
(fail) okf/log.md has a dated entry for the contract PR0 and amendment docs: Expected >= 1, Received: 0
(fail) evidence-stack.md documents PR0... (missing src/contract/ source)
 20 pass
 5 fail
Ran 25 tests across 1 file.
```

Final verification (`V2/phase-verify-task`):

```text
docs-validation.test.ts: 25 pass, 0 fail
okf validation passed (38 files)
ste lint passed
check:biome: only error docs/dev/ASDLC-1/trace.json format
```

### Task 25: [stack-compute] Plan schema fields, phase-plan prompt and alignment test

- Human action `V4/unblock`: fixed F-013 — verify used reset

RED evidence (`T1/phase-test`):

```text
15 tests failed:
(fail) plan schema stack fields > est_lines, concern, flag and kind validate together with depends_on
(fail) ... kind feature|refactor|schema|interface|enable is accepted (5)
(fail) ... est_lines 0|1|400|100000 accepted (4)
(fail) ... the new fields are optional and other unknown task keys stay rejected
(fail) phase-plan.md has the gated Stack planning section: Expected to contain "Stack planning (only when the task text says stack_enabled: true)"
(fail) okf/references/schemas.md documents the plan stack fields: Expected to contain "est_lines"
(fail) AC-26 stack.enabled true: marker and default sizing budgets present: Expected to contain "stack_enabled: true"
(fail) AC-26 stack.enabled true: configured sizing budgets are carried through: Expected to contain "stack_enabled: true"

 35 pass
 15 fail
 81 expect() calls
Ran 50 tests across 1 file.
```

Final verification (`V5/phase-verify-task`):

```text
alignment.test.ts: 50 pass, 0 fail. validate:schemas 0, validate:assets 0, validate:okf 0, validate:ste 0, check:biome 0. Preflight full list (bun test, check:types, check:bundle, check:runtime) all exit 0.
```

### Task 26: [stack-compute] computeStack: deterministic pack, flag and order

RED evidence (`T1/phase-test`):

```text
error: not implemented: computeStack
      at computeStack (packages/accord-core/src/stack/compute-stack.ts:4:50)
(fail) ASDLC-1/AC-10 order and siblings > topological order holds when a low id depends on a high id

 0 pass
 22 fail
Ran 22 tests across 1 file.
```

Final verification (`V2/phase-verify-task`):

```text
compute-stack.test.ts: 40 pass, 0 fail. check:types exit 0. biome on task files: clean. Repo-wide check:biome exit 1: format errors only in docs/dev/ASDLC-1/trace.json. bun test, validate:schemas, validate:assets, validate:okf, validate:ste, check:bundle, check:runtime all exit 0.
```

### Task 27: [stack-compute] PR brief, stack map, stack table and report renderers

RED evidence (`T1/phase-test`):

```text
error: not implemented: renderStackReport
  at renderStackReport (packages/accord-core/src/stack/render.ts:51:55)
(fail) ASDLC-1/AC-11 renderStackReport > ASDLC-1/AC-6 report has no bare AC refs even when trailers carry ac=

 0 pass
 16 fail
Ran 16 tests across 1 file.
```

Final verification (`V1/phase-verify-task`):

```text
stack-render.test.ts: 27 pass, 0 fail. check:types, validate:schemas, validate:assets, validate:okf, validate:ste, check:bundle, check:runtime and full bun test: pass. check:biome fails only on docs/dev/ASDLC-1/trace.json (format); the task's two files are Biome-clean.
```

### Task 28: [stack-compute] StackProvider port and gh provider

RED evidence (`T1/phase-test`):

```text
25 fail, 0 pass. Failures are 'not implemented: resolveStackProvider' thrown from the stub, or assertion failures such as: Expected substring or pattern: /gh/ Received: "not implemented: resolveStackProvider"
```

Final verification (`V1/phase-verify-task`):

```text
stack-provider-gh.test.ts: 30 pass, 0 fail (156 expect calls). Full bun test exit 0; validate:schemas/assets/okf/ste, check:types, check:bundle, check:runtime exit 0. grep for GH_TOKEN|GITHUB_TOKEN|process.env in src/stack: no match. check:biome exit 1: docs/dev/ASDLC-1/trace.json format only; task files clean.
```

### Task 29: [stack-compute] Stack service and dev_stack_* MCP tools

RED evidence (`T1/phase-test`):

```text
Ran 17 tests across 1 file. 0 pass, 17 fail. Failures: stackSync/stackShow/stackSubmit/stackReport throw 'not implemented: <fn>'; dev_stack* tools not registered in ACCORD_TOOLS; resolvePrGroup(3) returned [3] instead of [3,4]; service.ts lacks registerPrGroupResolver; registry.ts lacks stack/service import.
```

Final verification (`V1/phase-verify-task`):

```text
stack-service + accord-mcp tests: 30 pass, 0 fail. check:types, check:bundle, check:runtime, validate:schemas/assets/okf/ste: exit 0. bun test (full): exit 0. check:biome: fails only on docs/dev/ASDLC-1/trace.json (format, harness-generated, outside task files); biome check on the 4 task files is clean.
```

### Task 30: [stack-compute] Per-PR branch lifecycle in the spawn preflight

RED evidence (`T1/phase-test`):

```text
bun test packages/accord-core/tests/stack-branches.test.ts: 3 pass, 20 fail. Failures: 'not implemented: branchFor' / 'not implemented: ensureTaskBranch' / 'not implemented: ensureCloseoutBranch'; preflight first-task test: Expected "stack/ASDLC-9/pr-1" Received "work/pr0"; preflight dirty-tree test: 'Received value must be a string: undefined' (no blockReason); closeout hook test: Expected "function" Received "undefined". Passing: agents other than phase-test, stack.enabled false no-op, read-only status queries never switch.
```

Final verification (`V1/phase-verify-task`):

```text
93 pass, 0 fail (3 files). check:types, check:bundle, check:runtime, validate:* pass. check:biome: only docs/dev/ASDLC-1/trace.json format error (array collapse), unrelated to task files.
```

### Task 31: [stack-compute] accord stack CLI command

### Task 32: [stack-compute] Schema description and OKF docs for the stack

### Task 33: [tree-state] State size cap and task-file redaction

### Task 34: [tree-state] State snapshot writer staged with every typed commit

### Task 35: [tree-state] Stateless resume from committed state

### Task 36: [tree-state] Closeout commit builds artifacts then removes state

### Task 37: [tree-state] Leftover-state rule in the accord/evidence check

### Task 38: [tree-state] OKF docs for committed state and closeout

### Task 39: [trunk-hardening] Overrun measurement and re-plan decision

### Task 40: [trunk-hardening] Open-PR depth cap and flag validation

### Task 41: [trunk-hardening] Bottom-up merge: retarget next PR by merging main

### Task 42: [trunk-hardening] OKF docs for depth cap, merge order and overrun

### Task 43: [feature-knowledge] Feature doc schema, parser and index generator

### Task 44: [feature-knowledge] validate:features script and Dev Harness entry

### Task 45: [feature-knowledge] spec features[] and PR0 impact analysis

### Task 46: [feature-knowledge] Closeout feature-doc update and drift check

### Task 47: [feature-knowledge] Review invariants and CI drift rule

### Task 48: [feature-knowledge] Feature find/impact query and dev_feature_* tools

### Task 49: [feature-knowledge] accord feature CLI command

### Task 50: [feature-knowledge] Schema description and OKF docs for feature knowledge

### Task 51: [ci-driven-mode] Startup push-token check and cost cap key

### Task 52: [ci-driven-mode] CI builds PR0 from brief and spec

### Task 53: [ci-driven-mode] Idempotent resume, concurrency lock, gates and cost-cap alert

### Task 54: [ci-driven-mode] OKF and CI docs for CI-driven mode


