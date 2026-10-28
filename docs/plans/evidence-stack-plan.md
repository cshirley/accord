# Evidence stack — stacked PRs with red/green/review commits (plan)

Status: **proposed** · Owner: harness core · Touches: `packages/accord-core` (new `stack/`, `commit/`, `evidence/`; plan schema; orchestration commit handlers), `packages/accord-ci`, `packages/accord-assets` (plan agent), `accord-cli` / `pi-accord` / `accord-mcp` (thin adapters), `okf/`.
Design concept: [`okf/architecture/evidence-stack.md`](../../okf/architecture/evidence-stack.md) · Config: [`okf/references/stack-config.md`](../../okf/references/stack-config.md).

## 1. Problem

For greenfield or large features, one branch and one PR mixes many concerns. Engineers cannot see how the code came to exist.

- Red and green test runs, review findings, and fix rounds live in `.tasks/` (gitignored). Git sees only a `trace.*` projection and one commit per `done` task.
- `docs/dev/<ID>/` is called immutable by convention only. It is committed in pieces beside code.
- The reviewer reads one large diff plus `verify.md`. The process (RGR, adversarial loops) is not in the history.

## 2. Goals / non-goals

**Goals**
- G1: Git history is the evidence log. Every phase completion, including adversarial reviews, is one commit with its loop and round, made only by the orchestrator.
- G2: Each concern is one small PR that leaves `main` green.
- G3: The brief, spec, and plan are a locked contract, merged first.
- G4: The reviewer finds the right information at the right time, without PR noise.
- G5: Fits trunk-based development: short-lived PRs, bottom-up merge, flags for unfinished features.

**Non-goals**
- Not a replacement for the single-PR flow. `stack.enabled` defaults to `false`.
- No new hosting service. Stack tools sit behind a `provider` port.
- No force-push or amend of evidence commits.
- Evidence does not depend on the merge strategy. The asset in the final commit is the durable record.

## 3. Architecture change

### 3.1 PR stack

```
main
 └─ PR0  [ID] Contract        docs/dev/ID/{brief,spec,plan}, contract.lock.json — docs only
     └─ PR1  [ID] T1: <concern>
         └─ PR2  [ID] T2: <concern>     (independent tasks are siblings, not a chain)
             └─ PRn  [ID] Closeout      verify.md, trace.*, workflow-cost.*
```

### 3.2 Commit grammar (per task PR)

**Rule: every phase completion is one commit, made only by the orchestrator, and every commit names its loop and round.** This includes the adversarial reviews and verify. A review commit holds the findings; the next phase commit holds the response. Findings are committed before the next phase starts, so the orchestrator reads them back from the tree and never depends on in-memory state.

**Loops, rounds, refs.** The harness already names every step with a ref `<round>/<actor>` (`task-schema.json`: `control.round` matches `^[TCV]\d+$`; `log[].ref`). The commit uses the same ref, so a commit joins directly to the task file `log[]` entry. `T<n>` is a test-loop round (`phase-test` then `review-test`), `C<n>` a code-loop round (`phase-code`, then `review-security`, then `review-code`), `V<n>` a verify round (`phase-verify-task`). A re-run in the same round gets a `.2` suffix (`T1.2/phase-test`). Loops can interleave: a test problem found in a code round opens a new `T` round (the existing RGR respawn), then a new `C` round. Counters are `control.retries.{test_review,code_review,rgr,verify}`.

| Loop (ref prefix) | Phase agent | Adversarial agent(s) | Gate |
|------|-------------|----------------------|------|
| test (`T`) | `phase-test` | `review-test` (before any implementation) | No gating findings: open `C` |
| code (`C`) | `phase-code` | `review-security`, then `review-code` (existing order) | No gating findings: open `V` |
| verify (`V`) | `phase-verify-task` | none | All ACs pass |

**Security gate (policy change).** Today `review-security` is always advisory (`advisoryAll` in `tasks/record.ts`). In this process it gates inside the existing `C` round, which already runs `phase-code`, then `review-security`, then `review-code`. Any open finding of severity `critical` or `warning` ("major") from `review-security` is gating, like findings from `review-code`; `suggestion` stays advisory. The next `C` round's `phase-code` fixes the security and code findings together, and `review-code` re-reviews that fix, so a security fix is always code-reviewed. Fix rounds use the existing `code_review` counter and its caps; at the cap the task blocks for a human. The post-code test gate runs after every `phase-code`. No new loop, round prefix, counter, or schema pattern is needed. Config: section 5a. Decided; the separate `S` loop was rejected.

| Commit | Content | Guard (orchestrator stages only these paths) |
|--------|---------|------|
| `phase-test` (`T<n>`) | Tests. Round 1 is the RED commit: the harness ran the tests and recorded they fail for the right reason (assertion, not compile error or import error). Round N>1 answers the previous `review-test` findings and records the response to each (fixed, disputed, accepted). | Test paths, `docs/dev/<ID>/state/**` |
| `review-test` (`T<n>`) | Findings (`docs/dev/<ID>/reviews/task-<N>/T<n>-review-test.md`: severity, file:line, id) or a clean verdict. Includes harness findings such as `import_only_red`. | `reviews/**`, `docs/dev/<ID>/state/**` only. No test or code edits |
| `phase-code` (`C<n>`) | Production code. Round 1 is the GREEN commit. Round N>1 answers the previous `review-code` and `review-security` findings (security and code findings are fixed together). | Production paths, `docs/dev/<ID>/state/**`. No test edits (a test edit respawns `phase-test`) |
| `review-code` (`C<n>`) | Findings or clean verdict. | `reviews/**`, `docs/dev/<ID>/state/**` only |
| `review-security` (`C<n>`) | Security findings (`reviews/task-<N>/C<n>-review-security.md`) or a clean verdict. Runs after `phase-code` in the same round, before `review-code`. Critical and warning findings gate. Always its own commit. | `reviews/**`, `docs/dev/<ID>/state/**` only |
| `phase-verify-task` (`V<n>`) | Verify result per AC. A failed AC bounces to `phase-code` and starts the next `code` round. Named like every other phase, by its ref. | `reviews/**`, `docs/dev/<ID>/state/**` only |
| `state(task-<N>)` | Orchestrator-originated state change with no phase behind it: `/dev unblock`, a human answer to `decisions[]`, a cap reached. Not part of the normal flow. | `docs/dev/<ID>/state/**` only |
| `evidence(task-<N>)` | Evidence asset (below), deletion of `docs/dev/<ID>/state/task-<N>/`. Final commit of the PR. A PR that merges tasks uses `evidence(task-<N>,<M>)` and writes one asset per task. | `evidence/**`, `docs/dev/<ID>/state/**` |

**Example** (one test round and one code round with findings; refs as in `task.log[]`):

```
T1/phase-test        red: 4 failing
T1/review-test       findings: 1 critical, 2 warning
T2/phase-test        answers T1: 2 addressed, 1 wont_fix
T2/review-test       clean
C1/phase-code        green
C1/review-security   findings: 1 critical, 1 warning, 1 suggestion
C1/review-code       findings: 1 warning
C2/phase-code        answers C1: 3 addressed (security + code)
C2/review-security   clean (suggestion advisory)
C2/review-code       clean
V1/phase-verify-task pass
evidence(task-2)
```

**Who commits.** The orchestrator is the only committer. Agents never commit and get no git write access. The orchestrator decides when to commit, stages by role per the Guard column (an out-of-scope path is not committed and respawns `phase-test`, the existing RGR rule), and writes the message and trailers. A review commit that touches code is a guard failure, which shows that adversarial reviewers cannot alter what they review.

**Multi-turn phases** (align, spec, plan) commit once when they return `done`, never per turn. Drafts stay in the working tree state.

- The adversarial diff for a round is the code change in the phase commit that follows the review commit (`git diff <review commit>..<next phase commit>`, excluding `reviews/` and `docs/dev/<ID>/state/`). The findings are in the review commit just before it.
- A failed round adds commits. It never rewrites them. The retry cap equals the number of visible rounds.
- **No crash window.** Each phase result is committed before the next phase starts. A stateless CI runner resumes from the last commit and reads the findings from `docs/dev/<ID>/state/` and `reviews/`. No review is re-run.
- **Commit count.** A task has `2 × (T rounds) + 3 × (C rounds) + 1 (verify) + 1 (evidence)` commits at minimum (`state` adds more). A task with one findings round in each of the test and code loops has 12. Mitigation is in §3.5: the reviewer reads the PR brief and net diff, and uses the commit list only for process audit.
- The last commit of every task PR is `evidence(task-<N>)`. It adds the evidence asset `docs/dev/<ID>/evidence/task-<N>.md` and `task-<N>.json`, generated from the PR's commits and trailers: red and green output excerpts, findings, the review-to-fix diffs as patches, planned vs actual size. The asset is a file, so it survives any merge strategy, including squash.
- Rebase or merge keeps the evidence commits reachable as well (`git log --first-parent main` stays readable). Squash is allowed because the asset carries the evidence.

### 3.2e Commit message format

Every commit has three parts: a human subject, a human body, and one `Accord:` trailer. The trailer is the only machine contract. It holds space-separated `key=value` pairs: integer counts, no spaces inside values, so `awk` can split on `=`. It follows git trailer rules, so `git log --format='%(trailers:key=Accord,valueonly,unfold)'` returns exactly that line.

```
[FEAT-ASDLC][task-2] T1/review-test: 1 critical, 2 warning

F-001 critical tests/refresh.test.ts:42  asserts on the mock, not behaviour (AC-3)
F-002 warning  tests/refresh.test.ts:70  no expired-token case (AC-4)
F-003 warning  tests/refresh.test.ts:91  test name does not state the expected result

Accord: v=1 id=FEAT-ASDLC task=2 seq=2 ref=T1/review-test agent=review-test loop=test round=1 outcome=findings crit=1 warn=2 sugg=0 open_crit=1 open_warn=2 findings=F-001,F-002,F-003 ac=AC-3,AC-4 files=1 harness=pi model=sonnet spawns=1 tok_in=18200 tok_out=1900 tok_cache_r=12000 tok_cache_w=0 usd_u=118000 ms=41200 usage=host
```

**Subject regex:** `^\[([A-Z]+(-[A-Z]+)*-[0-9]+)\]\[task-([0-9]+)\] ([TCVS][0-9]+(\.[0-9]+)?)/([a-z-]+): ` (captures: work item, task, ref, actor). If subject and trailer disagree, the trailer wins.

**Keys, `v=1`**

| Group | Keys | Meaning |
|-------|------|---------|
| Identity | `v id task seq ref agent loop round` | `task` is the plan task number; `ref` is the task-file `log[]` ref (`T1/review-test`), the join key to the task file; `seq` is the commit order within the task PR |
| Outcome | `outcome` | `red`, `green`, `findings`, `clean`, `fixed`, `pass`, `fail`, `blocked`, `done` |
| Raised | `crit warn sugg` | Findings raised in this commit (review commits) |
| Open | `open_crit open_warn` | Gate state after this commit |
| Responses (phase commits) | `addressed disputed wont_fix` | Fixer responses to the previous findings; same names as the finding lifecycle in `okf/references/task-file.md` |
| Verdicts (review commits) | `verified reraised dispute_upheld wont_fix_accepted waived` | Reviewer or human resolution of earlier findings; same lifecycle names |
| IDs | `findings fixes` | Comma-separated `F-nnn` IDs |
| Tests | `t_pass t_fail t_skip t_ms red` | `red` is `assertion`, `import`, or `compile` |
| Criteria | `ac ac_pass ac_fail` | `ac` is the covered list; the counts are on verify commits |
| Diff | `files add_src del_src add_test del_test` | Measured from the staged diff |
| Model | `harness model spawns` | Backend (`pi`, `claude`, `exec`), model id, number of spawns summed into this commit |
| Tokens | `tok_in tok_out tok_cache_r tok_cache_w` | Integers, summed over all spawns since the previous commit |
| Cost | `usd_u ms` | Micro-dollars (integer) and wall time in milliseconds, same sum |
| Usage source | `usage` | `host` (reported by the host), `self` (agent self-reported), `missing` (counts are 0, as in the usage log) |
| Retry | `retry retry_life` | `control.retries.<loop>.used` and `.lifetime` for this loop at this commit |

- **Cost on every commit.** `tok_*`, `usd_u`, `ms`, `harness` and `model` are on every commit that follows a spawn. They sum every spawn since the previous commit, including retries and failed spawns, so cost per phase is exact and `spawns` shows how many. If a commit follows several models, `model` is the one that produced the result and the others are in the evidence asset.
- **Source of numbers.** The orchestrator measures or validates every value, from the usage log, return packets, the test run, and the staged diff. An agent's own claim is never used for counts.
- **Absent values.** A key is omitted when it does not apply. Counts are never `null`.
- **Extensions.** Custom keys use an `x_` prefix. Consumers ignore unknown keys. `v` changes only for breaking changes.
- **Guard.** The commit guard checks that the trailer parses, required keys are present, and counts match the staged files. For example `crit+warn+sugg` equals the number of findings in `docs/dev/<ID>/reviews/task-<N>/<ref>.md`.

**Other commit types**
- `T1/phase-test`: `outcome=red t_fail=4 t_pass=0 red=assertion add_test=130`.
- A fix commit: `outcome=fixed addressed=2 disputed=0 wont_fix=1 fixes=F-001,F-002`.
- `phase-verify-task`: `outcome=pass ac_pass=4 ac_fail=0`.
- `evidence(task-<N>)`: a roll-up: `outcome=done rounds_test=2 rounds_code=2 findings_total=7 est_lines=300 act_lines=340 tok_in=… tok_out=… usd_u=…` (planned vs actual size gives sizing feedback).

**Extraction**

```sh
git log --reverse --format='%H%x09%(trailers:key=Accord,valueonly,unfold)' main..HEAD |
awk -F'\t' '$2!="" {
  n=split($2,p," "); delete r
  for(i=1;i<=n;i++){split(p[i],kv,"="); r[kv[1]]=kv[2]}
  if (r["outcome"]=="findings") { crit[r["loop"]]+=r["crit"]; warn[r["loop"]]+=r["warn"] }
  if (r["round"]+0 > rounds[r["loop"]]) rounds[r["loop"]]=r["round"]
  usd[r["agent"]]+=r["usd_u"]; tok[r["model"]]+=r["tok_in"]+r["tok_out"]
}
END { for (l in rounds) printf "%s rounds=%d crit=%d warn=%d\n", l, rounds[l], crit[l], warn[l]
      for (a in usd) printf "%s usd=%.2f\n", a, usd[a]/1e6
      for (m in tok) printf "%s tokens=%d\n", m, tok[m] }'
```

Other reports follow the same pattern: findings by agent, first-pass clean rate, red-for-the-wrong-reason count (`red=import` or `red=compile`), cost per loop or model. `git log --grep='^Accord: .*agent=review-security'` selects by key without tooling.

**PR roll-up.** `accord stack report` parses the same trailers (`commit/commit-grammar.ts`) and renders a table per PR: rows per loop; columns for rounds, findings raised, fixed, disputed, accepted, tests red to green, tokens, and cost. A stack-level table adds up the PRs. `accord evidence <ID> --format tsv` exports columns for ad-hoc `awk`. The roll-up is also written to `evidence/task-<N>.json`, so the numbers survive squash-merge when per-commit trailers do not.

### 3.2a State persistence (tree)

The harness state that drives a task is committed in the branch, so any machine or CI runner can resume from the checkout alone (no local `.tasks/`).

- **Path**: `docs/dev/<ID>/state/task-<N>/`, beside the brief, spec, plan, `reviews/`, and `evidence/` (`stack.state.path`, template `docs/dev/{id}/state`). It is not a hidden directory and not gitignored, so a human can find, read, and troubleshoot it with `ls` and the PR file list. `state/` is the one transient part of `docs/dev/<ID>/`; everything else there is permanent. Not named `.accord-state`, and not the `accord-state-<ticket>` CI artifact in `docs/ci/`.
- **Human-readable first, no new format.** `STATE.md` is the existing `renderTaskTrace()` output (`packages/accord-core/src/tasks/render.ts`, the `accord trace` view): headline, phase, status, round, retry counters, next action (`who`, `why`, exact commands), blockers, advisories, requirements with findings and history, and the log. It is generated from the task file `summary` and `control`; nobody edits it. `accord trace <ID>` prints the same text from any checkout, so there is no separate `accord state` command.
- **`task.json` is the v2 task file**, redacted, and still valid against `task-schema.json`. Required fields stay: `in_flight` is always `null` (state is committed only at phase boundaries), and `owner_nonce` is a placeholder that the next runner replaces. Test output excerpts come from the sidecar `<round>-<agent>.output.txt`, redacted and size-capped. Raw packets (`<round>-<agent>.json`) are never committed.
- **Relation to `.tasks/`.** Locally, `.tasks/` stays the authoritative raw working state (gitignored). `state/` is a redacted snapshot of it, written with each commit. A CI runner has no `.tasks/`, so it rebuilds it from `state/` and the other `docs/dev/<ID>/` artifacts at start, as `rehydrate` does. An interrupted spawn needs no committed marker: the existing recovery rule respawns the same ref without consuming a retry.
- **Per-PR, no shared file.** There is no work-item-wide JSON in task PRs, so restack does not conflict. Each task dir carries a small `work-item` slice (phase, relevant `decisions[]`). The contract PR holds the work-item essentials in `docs/dev/<ID>/state/work-item.json`; later PRs read parent branches for the rest.
- **When**: a snapshot is written in the same commit as each commit the orchestrator makes (every phase, `state`, `evidence`). It records the parent sha, so it lags the commit hash by one.
- **Removal**:
  - The final `evidence(task-<N>)` commit builds `evidence/task-<N>.*` from the snapshots, then deletes `docs/dev/<ID>/state/task-<N>/`.
  - The closeout commit deletes the rest of `docs/dev/<ID>/state/` (including `work-item.json`) after `trace.*` and `verify.*` are built.
  - Net diff of each PR is zero for state. Under rebase or merge the snapshots stay in the commit history; under squash they disappear.
  - A check (`accord/evidence`) fails if `docs/dev/*/state/` exists on `main` after closeout, so cleanup cannot be forgotten.
- **Guards exempt** `docs/dev/<ID>/state/**` (green-touches-no-tests, review-commit-only-reviews). Artifact discovery, `rehydrate`, and trace skip `state/`; the contract lock does not cover it.
- **Reproducibility**: the evidence asset must be a pure function of the snapshots. Test: regenerate from the last pre-deletion commit and compare. After a squash this regeneration is impossible; the asset is then the only copy, which is intended.
- **Redaction is mandatory** (`stack.state.redact`, default `true`) because the content enters git history. Size cap `stack.state.max_bytes`.
- Alternative modes: `notes` (git notes under `refs/notes/accord/<ID>`, no PR noise, not visible in the GitHub UI) and `none`.

**What survives which merge strategy**

| Evidence | Location | Rebase or merge | Squash |
|----------|----------|-----------------|--------|
| Phase commits and `Accord:` trailers | History | Kept | Lost |
| State snapshots | `docs/dev/<ID>/state/` in history | Kept in history | Lost |
| Review findings and responses | `docs/dev/<ID>/reviews/` | Kept | Kept |
| Evidence asset | `docs/dev/<ID>/evidence/task-<N>.*` | Kept | Kept |
| Contract and lock | `docs/dev/<ID>/` (PR0) | Kept | Kept |
| Closeout: `verify.*`, `trace.*`, `workflow-cost.*`, feature docs | `docs/dev/<ID>/`, `docs/features/` | Kept | Kept |

History is the detailed log. The committed assets are the durable record, derived from history and state and reproducible from them.

### 3.2b CI-driven mode (long-term target)

Goal: an engineer commits `brief.md` and `spec.json` to a new branch and opens a PR; CI builds the rest.

- Tree state is what makes this possible. A CI job is stateless: it checks out the branch, reads `docs/dev/<ID>/state/` and `docs/dev/<ID>/`, performs the next step, commits, and pushes.
- **Trigger**: push to `accord/<ID>/*` that adds `docs/dev/<ID>/brief.md` and `spec.json`. CI runs plan, commits `plan.json` and the proposed stack table to PR0, and stops at the human gate.
- **Gates**: PR0 approval (the contract), blocked tasks, closeout. Answers to `decisions[]` come as PR comments or commits.
- **Loop**: after PR0 merges, CI opens each task PR from `computeStack`, runs red, green, review, fix, verify, and the final evidence commit, within the retry caps.
- **Requirements**: concurrency lock per `<ID>`; idempotent resume from the last typed commit; a GitHub App or PAT for pushes (commits made with `GITHUB_TOKEN` do not trigger workflows); redaction; cost caps from `workflow-cost`.
- Builds on [`okf/playbooks/adopt-autopipeline.md`](../../okf/playbooks/adopt-autopipeline.md) and `packages/accord-ci`.

### 3.2c Storage: change record vs feature knowledge

`docs/dev/<ID>/` stays, as the **change record**: keyed by ticket or slug, immutable after merge. It holds brief, spec, plan, `contract.lock.json`, `evidence/`, `verify.*`, `trace.*`. A ticket key is right for audit and lineage and wrong for discovery. Moving it would break `rehydrate`, trace, and CI paths.

A second layer, **feature knowledge**, is keyed by capability and describes what the system does now:

| Layer | Path | Keyed by | Mutability | Answers |
|-------|------|----------|-----------|---------|
| Change record | `docs/dev/<ID>/` | Ticket or slug | Immutable after merge | What was agreed, built, and proved? |
| Feature knowledge | `<knowledge.root>/<slug>.md` (default `docs/features/`) plus generated `index.md` and `index.json` | Capability | Living; changed only by closeout PRs | What does the system do now, and what touches it? |

Feature doc: OKF-style frontmatter so humans, agents, and validators share one format.

```yaml
id: auth-token-refresh          # stable, never reused
type: Feature
title: Token refresh
description: One line, written for search.
tags: [auth, session]
status: active                  # proposed | active | deprecated | superseded
owners: [team-auth]
acs:                            # stable, feature-scoped IDs
  - { id: auth-token-refresh.AC1, text: "...", tests: [src/auth/refresh.test.ts#expired] }
anchors:
  code: [src/auth/refresh.ts]
  interfaces: [POST /token/refresh, event:session.expired]
depends_on: [session-store]
related: [rate-limiting]
supersedes: []
changes:                        # newest first
  - { work_item: ACCORD-123, pr: 456, evidence: docs/dev/ACCORD-123/evidence/task-2.md, contract: <sha> }
```

The body holds behaviour, key decisions with reasons (ADR style), constraints, and non-goals. `acs` and `anchors` are the machine-readable part.

**Links into the stack**
- **Contract (PR0)**: `spec.json` gains `features[]` with a relation (`new`, `extends`, `modifies`, `deprecates`, `depends_on`) and a delta against feature AC IDs.
- **Closeout PR**: applies the delta to the feature docs and appends `changes[]`. The knowledge update is a reviewable diff. The mapping from work-item AC IDs to feature AC IDs is recorded here.
- **Evidence**: feature docs link to `docs/dev/<ID>/evidence/task-<N>.*`; they do not copy it.

### 3.2d Cross-referencing new against old

1. **Align and spec**: impact analysis before the contract.
   - Deterministic: `plan.files` ∩ feature `anchors`, then `depends_on` and `related` traversal.
   - Semantic: search over `title`, `description`, `tags` through `index.json`.
   - Output: an "Impacted features" table in PR0. Overlaps and contradicting ACs become `decisions[]`.
2. **Review**: review agents receive the impacted feature docs as invariants. A regression against an existing AC is a finding.
3. **Closeout**: `validate:features` checks that links and anchors resolve, every AC has a test, a feature owning changed files was updated (or the PR declares no change), and a feature stays under `max_acs_per_feature`.
4. **Outside the harness**: the same drift check runs in CI on any PR, so manual edits cannot invalidate a feature doc unnoticed.
5. **Lookup**: `accord feature find <query|path>`, `accord feature impact <ID>`, and MCP `dev_feature_*`. Progressive disclosure: index, then feature, then change record, then evidence.
6. **Brownfield**: no up-front repo scan. A feature doc is created or extended when a change first touches an area. `accord feature init` is optional and proposes features for review.

### 3.3 Contract immutability

- PR0 merges first. `contract.lock.json` records sha256 of `brief.md`, `spec.json`, `plan.json` and the commit sha. The commit is tagged `accord/<ID>/contract`.
- A hook and a CI check fail when locked files change without an amendment.
- `/dev amend-spec` creates a small `contract-amend` PR with the diff, reason, and affected ACs. It marks downstream tasks stale.
- Every task PR links to the contract by sha-pinned permalink.

### 3.4 Trunk-based fit

- Each task PR leaves `main` green and the feature unreachable (dark code or flag). The last task flips the flag.
- Merge bottom-up as each PR is approved. Do not hold the stack for the top.
- Tasks are planned independent, so each task PR branches from `main` and needs no restack. Only a real `depends_on` chain forms a stack: retarget the next PR to `main` after its base merges, and merge bottom-up. Evidence commits stay append-only (no amend, no force-push).
- Depth caps *open* PRs in a chain (`stack.sizing.max_depth`, default 6). `computeStack` opens PR n+max_depth only after PR n merges. Total PRs are not capped. A chain that cannot fit splits into milestone work items, each with its own contract PR.

### 3.5 Navigation and noise control

- **Stack map**: one generated comment per PR, updated in place: position, PR links, AC coverage.
- **Reviewer brief**: PR body, generated. Contract link first, then ACs and proving tests, a one-line process summary (`RED ✔ → GREEN ✔ → review r1: 1C 2W → fixed → verify ✔`), accepted risks, reading order.
- **Three lenses**: contract (PR0, read once), net change (production diff), process audit (commit-by-commit or `accord evidence`).
- **Noise**: findings live in review commits (`reviews/**`), the evidence asset, and the brief; process commits carry trailers so they can be filtered. Inline comments only for unresolved findings. One status check, `accord/evidence`, replaces bot comments. Humans are notified only at gates: PR0 ready, task blocked, closeout ready.
- **CLI**: `accord stack <ID>`, `accord evidence <ID> [task-<N>]`, `accord stack sync`, `accord stack submit`. Same logic as `dev_stack_*` MCP tools.

## 4. Sizing: how many PRs, how big

A PR is one reviewable concern that leaves `main` green. Count follows from the plan DAG and the size budget:

`N_PRs = 2 (contract + closeout) + number of packed task groups`

### 4.1 Plan inputs

Existing: `covers_ac`, `files[]`, `test_files[]`, steps. New: `est_lines`, `concern`, `depends_on`, `flag`, `kind` (`feature` | `refactor` | `schema` | `interface` | `enable`).

### 4.2 `computeStack(plan, config)` — deterministic, pure, in `accord-core/stack/`

**Pass A — flag** a task for re-plan if any hold (the harness never splits; the plan agent re-plans, section 4.2a):
- `est_lines` is above `sizing.max_pr_lines`, or files exceed `sizing.max_files`.
- It crosses a package or layer (`split_on: package`).
- Its ACs belong to different concerns (`concern`).
- It mixes refactor or move with behaviour change (`refactor`).
- It adds a public interface and its consumers (`interface`).

**Pass B — merge** adjacent tasks if all hold:
- Same concern, combined size within budget, `merge_small_same_concern` is true.
- Below `sizing.min_pr_lines`, unless the task is a refactor, schema, or flag.
- Merging does not exceed `max_depth`.

**Order**: topological sort on `depends_on`. Independent tasks are siblings. Depth is the longest path.

**Overrides**: a PR must leave `main` green and the feature unreachable. This beats the size budget: a re-plan that would break either is not made, and the task is accepted with a reason.

### 4.2a Oversized tasks

The harness never splits a task into several PRs. A flagged task is a planning defect: the plan agent re-plans it as smaller tasks with integer ids, so one PR stays small and safe to merge to `main`. Before PR0 is approved the plan changes freely; after, re-planning goes through `contract-amend`. Task ids stay integers. Sizing logic is deliberately simple; if PR size drifts upward, rework it in a later ACCORD version using the planned-vs-actual data in `trace.json`. A merged PR uses `evidence(task-<N>,<M>)` and writes one asset per task.

### 4.3 Measure and adjust

- After GREEN the harness measures actual changed lines (production, tests reported separately, generated excluded).
- If actual > `overrun_factor` × estimate, raise a `decisions[]` entry: re-plan now (a `contract-amend` PR replaces the task with smaller ones, section 4.2a) or accept with a reason.
- Unplanned dependency: record a deviation; `contract-amend` if it changes the plan.
- Planned vs actual per task goes into `trace.json`, to tune the defaults.

### 4.4 Who decides

| Actor | Role |
|-------|------|
| Plan agent | Proposes `concern`, `est_lines`, `depends_on`, and a `challenge` for any task above budget. |
| Harness | Applies merge rules and flags oversized tasks deterministically. Same plan gives same stack. |
| Human | Approves the proposed stack table in PR0. Changing the count later needs `/dev amend-spec` or a replan. |

PR0 carries this table:

| PR | Tasks | Concern | ACs | Est. LOC | Depends on |
|----|-------|---------|-----|----------|------------|

### 4.5 Greenfield shape

Bottom: types, schemas, interfaces (small, unblock the rest). Middle: one vertical slice per PR. Top: wiring, then the flag-flip PR. A 1,500–2,500 LOC feature gives about 5–8 task PRs plus contract and closeout.

## 5. Configuration

`stack` is a top-level key in `accord.json` (global `~/.config/accord/accord.json`, or the project `## Dev Harness` block; project overrides global). It is in `accord-schema.json`. Keys and defaults: [`okf/references/stack-config.md`](../../okf/references/stack-config.md).

```json
"stack": {
  "enabled": true,
  "provider": "gh",
  "commits": "phase",
  "merge_strategy": "rebase",
  "evidence": { "asset": true, "include_diffs": true },
  "state": { "persist": "tree", "path": "docs/dev/{id}/state", "redact": true, "max_bytes": 262144 },
  "sizing": {
    "max_pr_lines": 400, "min_pr_lines": 30, "max_files": 10, "max_depth": 6,
    "overrun_factor": 1.5,
    "split_on": ["package", "concern", "refactor", "interface"],
    "merge_small_same_concern": true
  },
  "contract": { "lock": true, "tag": true },
  "require_flag": true
},
"knowledge": {
  "enabled": true,
  "root": "docs/features",
  "impact_analysis": true,
  "drift_check": "warn",
  "max_acs_per_feature": 12
}
```

`knowledge` is its own top-level key. Feature knowledge is useful without the stack, so it does not live under `stack`.

### 5a. Security gate configuration (`orchestration.review_loop.review_security`)

New, proposed. It follows the existing per-reviewer overrides (`review_test`, `review_code`) under `orchestration.review_loop`:

```json
"orchestration": {
  "review_loop": { "review_security": { "severity_gate": "warn" } }
}
```

`severity_gate` is `advisory` (never gates; today's behaviour), `block` (critical only), `warn` (critical and warning), or `none` (any finding), the last three as for the other loops. Schema default: `advisory`, so existing projects do not change. With `stack.enabled: true` the effective default is `warn` unless set explicitly. Severity names are the existing `critical`, `warning`, `suggestion`; "major" means `warning`. There are no separate retry keys: security fixes use the `code_review` counter and its caps (`review_code`, or the `review_loop` defaults).

## 6. Phasing

| Phase | Deliver | Exit check |
|-------|---------|-----------|
| 1 | Commit grammar (`commit/commit-grammar.ts`), orchestrator-only per-phase commits behind `stack.commits: "phase"`, `accord evidence` timeline. No stack yet. | every phase appears as a commit with loop and round trailers; findings are in review commits; timeline renders from git. |
| 2 | Contract PR0, `contract.lock.json`, lock guard (hook + CI), `contract-amend`. | Edit to a locked file without amendment fails. |
| 3 | Plan schema fields, `computeStack`, `stack/` provider port with the `gh` provider only, evidence asset writer (final `evidence(task-<N>)` commit), `accord stack`, stack map, PR brief. | Same plan gives same stack; golden-file tests. |
| 4 | Tree state: `docs/dev/<ID>/state/` snapshots per typed commit, removal in `evidence(task-<N>)`, guard exemptions, redaction, reproducibility test. | Resume from a fresh clone at any typed commit; asset regenerates identically. |
| 5 | Trunk hardening: flags in plan, depth cap, `accord/evidence` check, bottom-up merge automation, overrun decision. | Green-only-on-head CI; overrun raises a decision. |
| 6 | Feature knowledge (§3.2c, §3.2d): feature doc schema, `index.json` generator, `spec.json` `features[]` and delta, impact analysis in PR0, closeout update, `validate:features`, drift check, `accord feature find/impact`. | A change touching an anchored file lists the feature in PR0; closeout updates the doc; drift check fails on an unreflected change. |
| 7 | CI-driven mode (§3.2b): trigger on brief + spec commit, stateless resume, gates through PR comments. | A branch with only brief + spec yields PR0 with plan and stack table, with no local session. |

Each phase ships behind `stack.enabled: false`. Phase 1 is the largest evidence gain for the least risk.

## 7. Work breakdown (layering rule: logic in `accord-core`)

1. `accord-core/commit/commit-grammar.ts`: build, parse, and validate the `Accord:` trailer (section 3.2e), with a golden-file test for the awk extraction above.
2. `accord-core/orchestration` post-result handlers: the orchestrator commits every phase completion (phase-test, review-test, phase-code, review-code, review-security, phase-verify-task) with loop and round trailers, and make `review-security` gate on critical and warning findings (inside the `C` loop via `orchestration.review_loop.review_security`; today it is always advisory in `tasks/record.ts` and `orchestration/post-result/review-security.ts`), plus `state` for orchestrator-originated changes and `evidence` at the end (replaces the single `on_task_done` commit when `commits: "phase"`).
3. `accord-core/stack/`: `computeStack`, `StackProvider` port (`git`, `gh`, `graphite`, `spr`), PR body and map rendering.
4. `accord-core/evidence/`: timeline built from git trailers, and the evidence asset writer (`docs/dev/<ID>/evidence/task-<N>.{md,json}`).
5. Contract lock writer and verifier; hook; `accord-ci` check; `docs/ci/pre-merge-smoke.md` update.
6. `plan.schema.json`: `est_lines`, `concern`, `depends_on`, `flag`, `kind`. Keep `manifest.json`, `registry.ts`, and schemas aligned (`validate:assets`, `validate:schemas`).
7. Plan agent prompt: vertical slices, concern tags, estimates.
8. Adapters: `accord stack`, `accord evidence`, `dev_stack_*`, `dev_evidence` MCP tools.
9. `accord-core/knowledge/`: feature doc parser and schema, index generator, impact analysis, delta applier. New schema `feature.schema.json` (align `manifest.json`, `registry.ts`, schemas). `spec.schema.json`: `features[]`. `scripts/validate-features.ts` and CI drift check. Adapters: `accord feature`, `dev_feature_*`.
10. OKF: update concepts and append to `okf/log.md`.

## 8. Risks and trade-offs

| Risk | Mitigation |
|------|-----------|
| More commits and PRs add noise | Build navigation (map, brief, `accord/evidence` check) before the stack. |
| RED commits are not green: `bisect` and per-commit CI fail | Require CI on PR heads only; trailer lets `bisect` skip; RED and GREEN stay in the same PR. |
| Squash-merge culture | Evidence asset (`docs/dev/<ID>/evidence/task-<N>.*`) in the final commit of each PR survives squash. Per-commit history is lost on `main`, the asset keeps the diffs. |
| Stacked PR tooling on GitHub is awkward | `StackProvider` port; budget for retarget and restack. |
| State in git history (size, secrets) | Mandatory redaction, `max_bytes` cap, no raw packets, per-task dirs only. History keeps snapshots under rebase or merge, so redaction must be right the first time. |
| Feature docs rot | `anchors` plus the drift check in CI; update is part of the closeout PR, not a follow-up. |
| Feature granularity | A feature is a capability, not a file; `max_acs_per_feature` forces a split. |
| Feature doc duplicates the spec | Spec = intent and delta; feature doc = distilled current state, generated from spec plus evidence and human-reviewed in closeout. |
| More commits per task (12 with one findings round in each of the test and code loops) | Trailers allow filtering. The reviewer reads the PR brief and net diff; the commit list is for audit. Every commit is non-empty and has a single purpose. |
| Trailer line grows long with cost fields | One line per commit is the point (`awk`). Keep keys short; cost is summed per commit, never repeated. |
| Plan estimates are rough | Measure after GREEN; overrun raises a decision. |
| History never rewritten | Intended: a bad round is evidence. Tell reviewers. |

## 9. Decisions

| Question | Decision |
|----------|----------|
| Is the contract PR mandatory for `quick_fix`? | No. Only `implement` and greenfield work items get PR0. `quick_fix` keeps one branch and one PR. |
| Where does evidence live under squash-merge? | As an asset in the final commit of each PR: `docs/dev/<ID>/evidence/task-<N>.{md,json}` (`stack.evidence.asset`). |
| Are adversarial findings folded into the next commit or committed separately? | Separately. Every phase completion, including `review-*` and verify, is its own commit with loop and round, before the next phase starts. State is read back from the tree, so no findings are held in memory and no crash window exists. Review commits can touch only `reviews/**` and `docs/dev/<ID>/state/**`. |
| Does `review-security` gate, and where? | Yes, for `critical` and `warning` (major) findings, which must be fixed in code. It gates inside the existing `C` loop (order: `phase-code`, `review-security`, `review-code`), not in a new loop. Fixes are the next `C` round's `phase-code`, re-reviewed by `review-code`, and use the `code_review` counter. Every review and fix is its own commit. Config: `orchestration.review_loop.review_security.severity_gate`. |
| How is `verify` named? | Like every other phase: `phase-verify-task verify rN`. |
| What is the machine-readable commit format? | Human subject and body plus one `Accord:` trailer of `key=value` pairs (section 3.2e). Cost, token, harness and model fields are on every commit that follows a spawn, summed over all spawns (including retries and failures) since the previous commit. |
| Where does harness state live per commit? | In the tree (`stack.state.persist: "tree"`, default) under `docs/dev/<ID>/state/task-<N>/`, deleted by the final `evidence(task-<N>)` commit. Chosen so CI can resume statelessly and be triggered by committing brief + spec. `notes` stays as an option. |
| Does `docs/dev/<ID>/` still make sense? | Yes, as the immutable change record (audit, lineage, evidence). A separate living, capability-keyed layer, `knowledge.root` (default `docs/features/`), serves discovery and cross-referencing by humans and agents. |
| Which stack provider first? | `gh`. The `provider` key stays configurable behind the `StackProvider` port; `git`, `graphite`, `spr` follow later. |
