# Implementation trace: ASDLC-1

- Generated: 2026-10-29T15:11:48.940Z (harness-generated from `.tasks/`; regenerate, don't edit)
- Pattern: implement

## Tasks

| Task | Title | Status | Commits | Rounds T/C/V | Findings | Unblocks |
| ---: | --- | --- | --- | --- | --- | ---: |
| 1 | [flags] Stack and knowledge switch resolver with default-off values | done | `0e9ed2e` | 1/1/1 | 8 (open 8) | 0 |
| 2 | [infra] Temp git repo, fake gh helpers and import-boundary test | done | `a018167` | 4/4/1 | 21 (verified 15, wont_fix_accepted 1, waived 2, open 3) | 0 |
| 3 | [telemetry] Stack event catalogue and emitter on the shared logger | done | `fcd446c` | 1/1/1 | 9 (open 9) | 0 |
| 4 | [infra] accord/evidence check runner and workflow | done | `fd02108` | 2/1/1 | 21 (verified 9, reraised 1, wont_fix_accepted 1, open 10) | 0 |
| 5 | [commit-evidence] Commit grammar: Accord trailer build, parse, validate | done | `2194f4d` | 2/1/1 | 13 (verified 10, open 3) | 0 |
| 6 | [commit-evidence] Commit guard and content redaction | done | — | 2/1/1 | 21 (verified 8, reraised 3, open 8, wont_fix_accepted 2) | 0 |
| 7 | [commit-evidence] Orchestrator-only per-phase commits behind stack.commits phase | pending | — | 0/0/0 | 0 | 0 |
| 8 | [commit-evidence] Evidence timeline from git trailers | pending | — | 0/0/0 | 0 | 0 |
| 9 | [commit-evidence] accord evidence CLI command | pending | — | 0/0/0 | 0 | 0 |
| 10 | [commit-evidence] OKF docs and docs validation test | pending | — | 0/0/0 | 0 | 0 |
| 11 | [evidence-asset] Work-item-qualified AC refs, trace.json qualification behind stack.enabled | pending | — | 0/0/0 | 0 | 0 |
| 12 | [evidence-asset] Evidence asset writer (task-<N>.md and .json) | pending | — | 0/0/0 | 0 | 0 |
| 13 | [evidence-asset] Final evidence(task-<N>) commit | pending | — | 0/0/0 | 0 | 0 |
| 14 | [evidence-asset] OKF docs for the evidence asset | pending | — | 0/0/0 | 0 | 0 |
| 15 | [security-gate] review-security gating inside the C loop | pending | — | 0/0/0 | 0 | 0 |
| 16 | [security-gate] Route open or disputed gating security findings back to review-security | pending | — | 0/0/0 | 0 | 0 |
| 17 | [security-gate] Schema description and OKF docs | pending | — | 0/0/0 | 0 | 0 |
| 18 | [contract-lock] contract.lock.json writer, verifier and schema | pending | — | 0/0/0 | 0 | 0 |
| 19 | [contract-lock] PR0 contract commit, tag and contract-amend | pending | — | 0/0/0 | 0 | 0 |
| 20 | [contract-lock] Pre-write lock guard in the tool_call hook | pending | — | 0/0/0 | 0 | 0 |
| 21 | [contract-lock] Post-spawn lock verification, restore and amend-only commits | pending | — | 0/0/0 | 0 | 0 |
| 22 | [contract-lock] Connect /dev amend-spec to contract-amend, amend marker and blocked downstream tasks | pending | — | 0/0/0 | 0 | 0 |
| 23 | [contract-lock] Contract-lock rule in the accord/evidence CI check | pending | — | 0/0/0 | 0 | 0 |
| 24 | [contract-lock] OKF docs for contract PR0 and amendment | pending | — | 0/0/0 | 0 | 0 |
| 25 | [stack-compute] Plan schema fields, phase-plan prompt and alignment test | pending | — | 0/0/0 | 0 | 0 |
| 26 | [stack-compute] computeStack: deterministic pack, flag and order | pending | — | 0/0/0 | 0 | 0 |
| 27 | [stack-compute] PR brief, stack map, stack table and report renderers | pending | — | 0/0/0 | 0 | 0 |
| 28 | [stack-compute] StackProvider port and gh provider | pending | — | 0/0/0 | 0 | 0 |
| 29 | [stack-compute] Stack service and dev_stack_* MCP tools | pending | — | 0/0/0 | 0 | 0 |
| 30 | [stack-compute] Per-PR branch lifecycle in the spawn preflight | pending | — | 0/0/0 | 0 | 0 |
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

### AC-1 — pending (not verified)

> Then the orchestrator makes one commit per phase completion, each subject names its ref (T1/phase-test, C1/review-security, V1/phase-verify-task), agents never commit, and each review commit holds its findings before …

- Tasks: 7 (pending)

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

### AC-3 — pending (not verified)

> Then the out-of-scope path is not committed, a stack.guard.rejected log event is emitted, and a test edit respawns phase-test

- Tasks: 6 (satisfied), 7 (pending)
- Files: `packages/accord-core/tests/commit-guard.test.ts`, `packages/accord-core/tests/redact.test.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/src/state/redact.ts`
- Tests verified (4):
  - commit-guard.test.ts › ASDLC-1/AC-3 guardStagedPaths — review commits keep only reviews/** and state/**
  - commit-guard.test.ts › ASDLC-1/AC-3 guardStagedPaths — code loop
  - commit-guard.test.ts › ASDLC-1/AC-3 guardStagedPaths — state and evidence commits
  - commit-guard.test.ts › ASDLC-1/AC-3 guardTrailer — trailer-counts

### AC-4 — pending (not verified)

> Then a timeline is rendered from git trailers only (ref, outcome, counts, tokens, cost) and the tsv columns match the documented awk extraction

- Tasks: 8 (pending), 9 (pending)

### AC-5 — pending (not verified)

> Then it is evidence(task-<N>) (evidence(task-<N>,<M>) for a merged PR), writes docs/dev/<ID>/evidence/task-<N>.{md,json} per task from commits and trailers (red and green excerpts, findings, review-to-fix patches, pla…

- Tasks: 12 (pending), 13 (pending)

### AC-6 — pending (not verified)

> Every AC or TC reference outside spec.json (evidence asset .md and .json, trace.json, the PR brief and the stack map) MUST be work-item-qualified as <work_item_id>/AC-<n>, never a bare AC-<n>, so it resolves once many…

- Tasks: 11 (pending), 12 (pending), 27 (pending)

### AC-7 — pending (not verified)

> Then they stay advisory exactly as today and no round is gated

- Tasks: 15 (pending)

### AC-8 — pending (not verified)

> Then findings at or above the gate severity gate the round (block: critical; warn: critical and warning; none: any), suggestions stay advisory under warn and block, the next C round phase-code fixes security and code …

- Tasks: 15 (pending), 16 (pending)

### AC-9 — pending (not verified)

> Then PR0 contains docs/dev/<ID>/{brief.md,spec.json,plan.json}, state/work-item.json and contract.lock.json with sha256 of each of brief.md, spec.json and plan.json (state/work-item.json is not locked because closeout…

- Tasks: 18 (pending), 19 (pending), 20 (pending), 21 (pending), 22 (pending), 23 (pending)

### AC-10 — pending (not verified)

> Then the output is byte-identical, adjacent same-concern tasks below min_pr_lines merge within the budget, a task above max_pr_lines or max_files is flagged for re-plan and never split, independent tasks are siblings,…

- Tasks: 25 (pending), 26 (pending)

### AC-11 — pending (not verified)

> Then PRs are created or updated with a stack map comment and a generated PR brief (contract link first, ACs and proving tests, process summary, reading order), one accord/evidence status check replaces bot comments, a…

- Tasks: 27 (pending), 28 (pending), 29 (pending), 30 (pending), 31 (pending)

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

### AC-26 — pending (not verified)

> With stack.enabled and knowledge.enabled unset or false and stack.commits unset or "task", the existing single-branch, single-PR flow, per-task commits (orchestration.commit.on_task_done), and review-security advisory…

- Tasks: 1 (satisfied), 7 (pending), 15 (pending)
- Files: `packages/accord-core/tests/stack-flags.test.ts`, `packages/accord-core/src/config/stack-flags.ts`, `packages/accord-core/src/config/types.ts`
- Tests verified (4):
  - packages/accord-core/tests/stack-flags.test.ts: ASDLC-1/AC-26 resolveStackConfig defaults, resolveKnowledgeConfig defaults, resolveReviewSecurityGate (35 pass)
  - bun test (full suite, exit 0)
  - bun run check:runtime (TC-27 runtime smoke, exit 0)
  - bun run check:types, check:bundle, check:biome, validate:schemas, validate:assets, validate:okf, validate:ste (all exit 0)

### AC-27 — pending (not verified)

> Evidence commits are append-only: the harness MUST NOT amend or force-push them, and a failed round adds commits and never rewrites them

- Tasks: 7 (pending), 13 (pending), 19 (pending), 41 (pending), 53 (pending)

### AC-28 — pending (not verified)

> Orchestration and domain logic (commit grammar, computeStack, evidence, state, feature knowledge) MUST live in packages/accord-core; pi-accord, accord-cli and accord-mcp stay thin adapters and Pi APIs never enter acco…

- Tasks: 2 (satisfied), 9 (pending), 29 (pending), 31 (pending), 49 (pending)
- Files: `packages/accord-core/tests/helpers-git.test.ts`, `packages/accord-core/tests/layering.test.ts`, `packages/accord-core/tests/helpers/temp-git-repo.ts`, `packages/accord-core/tests/helpers/fake-gh.ts`
- Tests verified (4):
  - packages/accord-core/tests/layering.test.ts › ASDLC-1/AC-28 no accord-core src import resolves to @earendil-works/* or packages/pi-*
  - packages/accord-core/tests/helpers-git.test.ts › ASDLC-1/AC-28 (temp git repo and fake gh)
  - bun run check:types
  - bun run check:bundle

### AC-29 — pending (not verified)

> The telemetry events stack.commit.created, stack.guard.rejected, stack.state.snapshot and stack.overrun.detected MUST be emitted through the shared accord-core logger (logging.ts) at, respectively, the orchestrator co…

- Tasks: 3 (satisfied), 6 (satisfied), 7 (pending), 13 (pending), 34 (pending), 39 (pending)
- Files: `packages/accord-core/tests/stack-telemetry.test.ts`, `packages/accord-core/src/telemetry/stack-events.ts`, `packages/accord-core/tests/commit-guard.test.ts`, `packages/accord-core/src/commit/commit-guard.ts`
- Tests verified (10):
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

### AC-30 — pending (not verified)

> New agents, schemas and config keys MUST stay aligned across manifest.json, registry.ts and schemas/ (plan fields est_lines, concern, depends_on, flag, kind; spec features[]; stack and knowledge keys)

- Tasks: 11 (pending), 17 (pending), 18 (pending), 25 (pending), 32 (pending), 39 (pending), 43 (pending), 45 (pending), 50 (pending), 51 (pending)

### AC-31 — pending (not verified)

> Each feature MUST update the affected okf/ concepts and append a dated entry to okf/log.md; procedure text in files marked style: ste follows ASD-STE100; changes under packages/accord-ci/ also update docs/ci/pre-merge…

- Tasks: 4 (satisfied), 10 (pending), 14 (pending), 17 (pending), 20 (pending), 22 (pending), 23 (pending), 24 (pending), 25 (pending), 31 (pending), 32 (pending), 37 (pending), 38 (pending), 42 (pending), 44 (pending), 47 (pending), 49 (pending), 50 (pending), 51 (pending), 52 (pending), 53 (pending), 54 (pending)
- Files: `packages/accord-ci/tests/evidence-check-runner.test.ts`, `packages/accord-ci/src/evidence-check.ts`, `.github/workflows/accord-evidence.yml`, `docs/ci/pre-merge-smoke.md`, `okf/log.md`, `okf/architecture/monorepo-packages.md`
- Tests verified (5):
  - bun test packages/accord-ci/tests/evidence-check-runner.test.ts (26 pass)
  - bun run validate:okf
  - bun run validate:ste
  - bun run check:types
  - grep fetch-depth: 0 / pull_request.head.sha / secrets in accord-evidence.yml

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

## Decisions

_None._

## Deviations

- Task 2 (pending): layering.test.ts import-boundary tests pass without impl — accord-core src currently has no Pi imports; AC-28 is a regression guard, and the scanner self-check proves it fails on violations
- Task 4 (pending): Added a test requiring an okf concept to list the evidence-check script or workflow as a source and mention accord/evidence. — F-005: the AC-31 clause 'update the affected okf/ concepts'. The natural file, okf/architecture/monorepo-packages.md, is not in task.files[]; the implementer must edit it, or another okf concept.
- Task 4 (pending): Modified okf/architecture/monorepo-packages.md (sources + accord-ci row) outside task.files — Test requires an okf concept listing the evidence check as a source and describing accord/evidence
- Task 6 (pending): Pinned unspecified contract: guardStagedPaths returns {kept,rejected,rule?,respawn?}; guardTrailer(workItemId, trailer, ctx) returns {ok,rule,errors}; event ref = commitType (paths) / trailer.ref (trailer); phase-test unrestricted; state/evidence/verify scopes as documented. — Spec names only rule/respawn/rejected; shape and per-type scopes inferred.
- Task 6 (pending): redact.test.ts covers AC-12 (named in the plan step) though task covers_ac is AC-3/AC-29; ac_ids for it set to AC-3 only for attribution. — Plan step tags redaction tests as ASDLC-1/AC-12, which is outside this task's covers_ac.

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

### Task 8: [commit-evidence] Evidence timeline from git trailers

### Task 9: [commit-evidence] accord evidence CLI command

### Task 10: [commit-evidence] OKF docs and docs validation test

### Task 11: [evidence-asset] Work-item-qualified AC refs, trace.json qualification behind stack.enabled

### Task 12: [evidence-asset] Evidence asset writer (task-<N>.md and .json)

### Task 13: [evidence-asset] Final evidence(task-<N>) commit

### Task 14: [evidence-asset] OKF docs for the evidence asset

### Task 15: [security-gate] review-security gating inside the C loop

### Task 16: [security-gate] Route open or disputed gating security findings back to review-security

### Task 17: [security-gate] Schema description and OKF docs

### Task 18: [contract-lock] contract.lock.json writer, verifier and schema

### Task 19: [contract-lock] PR0 contract commit, tag and contract-amend

### Task 20: [contract-lock] Pre-write lock guard in the tool_call hook

### Task 21: [contract-lock] Post-spawn lock verification, restore and amend-only commits

### Task 22: [contract-lock] Connect /dev amend-spec to contract-amend, amend marker and blocked downstream tasks

### Task 23: [contract-lock] Contract-lock rule in the accord/evidence CI check

### Task 24: [contract-lock] OKF docs for contract PR0 and amendment

### Task 25: [stack-compute] Plan schema fields, phase-plan prompt and alignment test

### Task 26: [stack-compute] computeStack: deterministic pack, flag and order

### Task 27: [stack-compute] PR brief, stack map, stack table and report renderers

### Task 28: [stack-compute] StackProvider port and gh provider

### Task 29: [stack-compute] Stack service and dev_stack_* MCP tools

### Task 30: [stack-compute] Per-PR branch lifecycle in the spawn preflight

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


