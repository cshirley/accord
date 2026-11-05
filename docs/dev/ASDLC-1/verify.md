# Verification Report: ASDLC-1

- Verdict: **GAPS**
- Date: 2026-11-05
- Acceptance criteria: 0 pass, 31 fail, 0 partial, 0 not verified

## Source Artifacts

- Brief: `docs/dev/ASDLC-1/brief.md`
- Spec (JSON): `docs/dev/ASDLC-1/spec.json`
- Spec (readable): `docs/dev/ASDLC-1/spec.md`
- Plan: `docs/dev/ASDLC-1/plan.json`
- Machine-readable verify: `docs/dev/ASDLC-1/verify.json`
- Workflow cost (JSON): `docs/dev/ASDLC-1/workflow-cost.json`
- Workflow cost (readable): `docs/dev/ASDLC-1/workflow-cost.md`
- Implementation trace (JSON): `docs/dev/ASDLC-1/trace.json`
- Implementation trace (readable): `docs/dev/ASDLC-1/trace.md`

## Summary

| Status | Count |
| --- | ---: |
| Pass | 0 |
| Fail | 31 |
| Partial | 0 |
| Not verified | 0 |

## Acceptance Criteria

### AC-1 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 7 (satisfied)
- Files: `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/src/subagent/result/process.ts`
- Task verification: 3 test(s) checked

### AC-2 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 5 (satisfied)
- Files: `packages/accord-core/tests/commit-grammar.test.ts`, `packages/accord-core/tests/fixtures/commit-grammar/messages.golden.txt`, `packages/accord-core/tests/fixtures/commit-grammar/awk-extract.golden.txt`, `packages/accord-core/src/commit/commit-grammar.ts`
- Task verification: 8 test(s) checked

### AC-3 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 6 (satisfied), 7 (satisfied)
- Files: `packages/accord-core/tests/commit-guard.test.ts`, `packages/accord-core/tests/redact.test.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/src/state/redact.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/src/subagent/result/process.ts`
- Task verification: 6 test(s) checked

### AC-4 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 8 (satisfied), 9 (satisfied)
- Files: `packages/accord-core/tests/evidence-timeline.test.ts`, `packages/accord-core/src/evidence/timeline.ts`, `packages/accord-cli/tests/evidence-cli.test.ts`, `packages/accord-cli/src/commands/evidence.ts`, `packages/accord-cli/src/cli.ts`, `packages/accord-cli/src/dispatch.ts`, `packages/accord-cli/src/commands/index.ts`
- Task verification: 8 test(s) checked

### AC-5 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 12 (satisfied), 13 (satisfied)
- Files: `packages/accord-core/tests/evidence-asset.test.ts`, `packages/accord-core/src/evidence/asset.ts`, `packages/accord-core/src/evidence/lines.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/commit/evidence-commit.ts`, `packages/accord-core/src/commit/hooks.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/subagent/result/process.ts`
- Task verification: 4 test(s) checked

### AC-6 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 11 (satisfied), 12 (satisfied), 27 (satisfied)
- Files: `packages/accord-core/tests/qualified-ac-refs.test.ts`, `packages/accord-core/src/evidence/qualify-ac.ts`, `packages/accord-core/src/artifacts/trace-artifact.ts`, `packages/accord-core/schemas/trace-schema.json`, `packages/accord-core/src/queries/verify-summary.ts`, `packages/accord-core/tests/evidence-asset.test.ts`, `packages/accord-core/src/evidence/asset.ts`, `packages/accord-core/tests/stack-render.test.ts`, `packages/accord-core/src/stack/render.ts`
- Task verification: 10 test(s) checked

### AC-7 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 15 (satisfied)
- Files: `packages/accord-core/tests/review-security-gate.test.ts`, `packages/accord-core/tests/helpers/security-gate-fixture.ts`, `packages/accord-core/src/tasks/record.ts`, `packages/accord-core/src/orchestration/post-result/review-security.ts`
- Task verification: 3 test(s) checked

### AC-8 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 15 (satisfied), 16 (satisfied)
- Files: `packages/accord-core/tests/review-security-gate-stack.test.ts`, `packages/accord-core/tests/helpers/security-gate-fixture.ts`, `packages/accord-core/src/tasks/record.ts`, `packages/accord-core/src/orchestration/post-result/review-security.ts`, `packages/accord-core/src/orchestration/post-result/review-code.ts`, `packages/accord-core/tests/review-security-routing.test.ts`, `packages/accord-core/src/orchestration/review-paths.ts`, `packages/accord-core/src/orchestration/post-result/phase-code.ts`
- Task verification: 11 test(s) checked

### AC-9 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 18 (satisfied), 19 (satisfied), 20 (satisfied), 21 (satisfied), 22 (satisfied), 23 (satisfied)
- Files: `packages/accord-core/tests/contract-lock.test.ts`, `packages/accord-core/src/contract/lock.ts`, `packages/accord-core/schemas/contract-lock-schema.json`, `packages/accord-core/src/artifacts/validation.ts`, `packages/accord-core/tests/contract-pr0.test.ts`, `packages/accord-core/tests/contract-amend.test.ts`, `packages/accord-core/src/contract/pr0.ts`, `packages/accord-core/src/contract/amend.ts`, `packages/accord-core/src/subagent/result/process.ts`, `packages/accord-core/tests/contract-lock-guard.test.ts`, `packages/accord-core/src/contract/lock-guard.ts`, `packages/pi-accord/tests/pi-contract-lock-hook.test.ts`, `packages/pi-accord/src/pi-hook-listeners.ts`, `okf/architecture/hooks.md`, `packages/accord-core/tests/contract-lock-restore.test.ts`, `packages/accord-core/src/contract/lock-verify.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/tests/contract-amend-session.test.ts`, `packages/accord-core/src/contract/amend-session.ts`, `packages/accord-core/src/orchestration/resolve/subcommand.ts`, `packages/accord-ci/tests/contract-lock-check.test.ts`, `packages/accord-ci/tests/evidence-check-runner.test.ts`, `packages/accord-ci/src/checks/contract-lock.ts`, `packages/accord-ci/src/evidence-check.ts`, `docs/ci/pre-merge-smoke.md`
- Task verification: 30 test(s) checked

### AC-10 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 25 (satisfied), 26 (satisfied)
- Files: `packages/accord-core/tests/alignment.test.ts`, `packages/accord-core/schemas/plan-schema.json`, `packages/accord-assets/agents/accord/phase-plan.md`, `packages/accord-core/src/orchestration/resolve/interview-task.ts`, `packages/accord-core/src/orchestration/resolve/forced.ts`, `packages/accord-core/src/orchestration/resolve/resume.ts`, `packages/accord-core/tests/compute-stack.test.ts`, `packages/accord-core/tests/fixtures/stack/compute-stack.golden.json`, `packages/accord-core/src/stack/types.ts`, `packages/accord-core/src/stack/compute-stack.ts`
- Task verification: 6 test(s) checked

### AC-11 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 27 (satisfied), 28 (satisfied), 29 (satisfied), 30 (satisfied), 31 (satisfied)
- Files: `packages/accord-core/tests/stack-render.test.ts`, `packages/accord-core/src/stack/render.ts`, `packages/accord-core/tests/stack-provider-gh.test.ts`, `packages/accord-core/src/stack/provider.ts`, `packages/accord-core/src/stack/gh-provider.ts`, `packages/accord-core/tests/stack-service.test.ts`, `packages/accord-core/src/stack/service.ts`, `packages/accord-core/src/tools/registry.ts`, `packages/accord-core/src/index.ts`, `packages/accord-core/tests/stack-branches.test.ts`, `packages/accord-core/src/stack/branches.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/subagent/preflight-runner.ts`, `packages/accord-cli/tests/stack-cli.test.ts`, `packages/accord-cli/src/commands/stack.ts`, `packages/accord-cli/src/commands/index.ts`, `packages/accord-cli/src/cli.ts`, `packages/accord-cli/src/dispatch.ts`, `packages/accord-cli/src/ui/command-catalog.ts`
- Task verification: 25 test(s) checked

### AC-12 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 33 (satisfied), 34 (satisfied)
- Files: `packages/accord-core/tests/state-redact.test.ts`, `packages/accord-core/src/state/redact.ts`, `packages/accord-core/tests/state-snapshot.test.ts`, `packages/accord-core/src/state/snapshot.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`
- Task verification: 14 test(s) checked

### AC-13 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 35 (satisfied)
- Files: `packages/accord-core/tests/e2e/state-resume.test.ts`, `packages/accord-core/src/state/restore.ts`, `packages/accord-core/src/work-items/rehydrate.ts`, `packages/accord-core/src/work-items/artifact-discovery.ts`
- Task verification: 9 test(s) checked

### AC-14 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 37 (satisfied)
- Files: `packages/accord-ci/tests/evidence-check.test.ts`, `packages/accord-ci/src/checks/leftover-state.ts`, `packages/accord-ci/src/evidence-check.ts`
- Task verification: 3 test(s) checked

### AC-15 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 36 (satisfied)
- Files: `packages/accord-core/tests/closeout.test.ts`, `packages/accord-core/src/state/closeout.ts`, `packages/accord-core/src/orchestration/commit-on-task-done.ts`
- Task verification: 4 test(s) checked

### AC-16 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 39 (satisfied)
- Files: `packages/accord-core/tests/overrun-decision.test.ts`, `packages/accord-core/src/stack/overrun.ts`, `packages/accord-core/src/subagent/result/process.ts`, `packages/accord-core/src/artifacts/trace-artifact.ts`, `packages/accord-core/schemas/trace-schema.json`, `packages/accord-core/src/evidence/lines.ts`
- Task verification: 5 test(s) checked

### AC-17 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 40 (satisfied), 41 (satisfied)
- Files: `packages/accord-core/tests/stack-depth.test.ts`, `packages/accord-core/src/stack/depth.ts`, `packages/accord-core/src/stack/service.ts`, `packages/accord-core/tests/stack-provider-gh.test.ts`, `packages/accord-core/tests/stack-branches.test.ts`, `packages/accord-core/tests/stack-service.test.ts`, `packages/accord-core/src/stack/merge-bottom-up.ts`, `packages/accord-core/src/stack/provider.ts`, `packages/accord-core/src/stack/gh-provider.ts`
- Task verification: 11 test(s) checked

### AC-18 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 43 (satisfied), 44 (satisfied)
- Files: `packages/accord-core/tests/feature-docs.test.ts`, `packages/accord-core/tests/fixtures/features/`, `packages/accord-core/src/knowledge/feature-doc.ts`, `packages/accord-core/src/knowledge/index-gen.ts`, `packages/accord-core/schemas/feature-schema.json`, `packages/accord-core/tests/validate-features-script.test.ts`, `scripts/validate-features.ts`, `package.json`, `AGENTS.md`
- Task verification: 5 test(s) checked

### AC-19 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 45 (satisfied)
- Files: `packages/accord-core/tests/feature-impact.test.ts`, `packages/accord-core/src/knowledge/impact.ts`, `packages/accord-core/schemas/spec-schema.json`, `packages/accord-core/src/contract/pr0.ts`, `packages/accord-core/src/artifacts/render-spec-markdown.ts`
- Task verification: 3 test(s) checked

### AC-20 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 46 (satisfied)
- Files: `packages/accord-core/tests/feature-drift.test.ts`, `packages/accord-core/src/knowledge/closeout-update.ts`, `packages/accord-core/src/knowledge/drift.ts`, `packages/accord-core/src/orchestration/commit-on-task-done.ts`
- Task verification: 9 test(s) checked

### AC-21 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 48 (satisfied), 49 (satisfied)
- Files: `packages/accord-core/tests/feature-query.test.ts`, `packages/accord-core/src/knowledge/query.ts`, `packages/accord-core/src/tools/registry.ts`, `packages/accord-cli/tests/feature-cli.test.ts`, `packages/accord-cli/src/commands/feature.ts`, `packages/accord-cli/src/cli.ts`, `packages/accord-cli/src/dispatch.ts`, `packages/accord-cli/src/commands/index.ts`
- Task verification: 5 test(s) checked

### AC-22 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 47 (satisfied)
- Files: `packages/accord-ci/tests/feature-drift-ci.test.ts`, `packages/accord-ci/src/checks/feature-drift.ts`, `packages/accord-ci/src/evidence-check.ts`, `packages/accord-core/src/briefing/task-requirements.ts`
- Task verification: 2 test(s) checked

### AC-23 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 52 (satisfied)
- Files: `packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts`, `packages/accord-ci/src/ci-driven/pr0.ts`, `packages/accord-ci/src/ci-driven/trigger.ts`, `packages/accord-ci/src/ci-driven/gate.ts`, `.github/workflows/accord-driven.yml`
- Task verification: 4 test(s) checked

### AC-24 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 53 (satisfied)
- Files: `packages/accord-ci/tests/ci-driven-resume.test.ts`, `packages/accord-ci/src/ci-driven/resume.ts`, `packages/accord-ci/src/ci-driven/alert.ts`, `packages/accord-ci/src/ci-driven/resume-gate.ts`, `packages/accord-ci/src/run-phase.ts`, `.github/workflows/accord-driven.yml`
- Task verification: 3 test(s) checked

### AC-25 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: task 51 (satisfied)
- Files: `packages/accord-ci/tests/ci-driven-startup.test.ts`, `packages/accord-ci/src/ci-driven/startup.ts`
- Task verification: 7 test(s) checked

### AC-26 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 1 (satisfied), 7 (satisfied), 15 (satisfied)
- Files: `packages/accord-core/tests/stack-flags.test.ts`, `packages/accord-core/src/config/stack-flags.ts`, `packages/accord-core/src/config/types.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/pi-accord/scripts/runtime-smoke.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/src/subagent/result/process.ts`, `okf/architecture/orchestration.md`, `okf/references/orchestration-policy.md`, `okf/log.md`, `packages/accord-core/tests/review-security-gate.test.ts`, `packages/accord-core/src/tasks/record.ts`, `packages/accord-core/src/orchestration/post-result/review-security.ts`
- Task verification: 12 test(s) checked

### AC-27 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 7 (satisfied), 13 (satisfied), 19 (satisfied), 41 (satisfied), 53 (satisfied)
- Files: `packages/accord-core/tests/append-only.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/commit/evidence-commit.ts`, `packages/accord-core/tests/contract-pr0.test.ts`, `packages/accord-core/tests/contract-amend.test.ts`, `packages/accord-core/src/contract/pr0.ts`, `packages/accord-core/src/contract/amend.ts`, `packages/accord-core/tests/stack-depth.test.ts`, `packages/accord-core/src/stack/merge-bottom-up.ts`, `packages/accord-core/src/stack/gh-provider.ts`, `packages/accord-ci/tests/ci-driven-resume.test.ts`, `packages/accord-ci/src/ci-driven/resume.ts`, `.github/workflows/accord-driven.yml`
- Task verification: 11 test(s) checked

### AC-28 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 2 (satisfied), 9 (satisfied), 29 (satisfied), 31 (satisfied), 49 (satisfied)
- Files: `packages/accord-core/tests/helpers-git.test.ts`, `packages/accord-core/tests/layering.test.ts`, `packages/accord-core/tests/helpers/temp-git-repo.ts`, `packages/accord-core/tests/helpers/fake-gh.ts`, `packages/accord-cli/tests/evidence-cli.test.ts`, `packages/accord-cli/src/commands/evidence.ts`, `packages/accord-core/tests/stack-service.test.ts`, `packages/accord-core/src/stack/service.ts`, `packages/accord-core/src/tools/registry.ts`, `packages/accord-core/src/index.ts`, `packages/accord-cli/tests/stack-cli.test.ts`, `packages/accord-cli/src/commands/stack.ts`, `packages/accord-cli/src/commands/index.ts`, `packages/accord-cli/src/dispatch.ts`, `packages/accord-cli/tests/feature-cli.test.ts`, `packages/accord-cli/src/commands/feature.ts`
- Task verification: 14 test(s) checked

### AC-29 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 3 (satisfied), 6 (satisfied), 7 (satisfied), 13 (satisfied), 34 (satisfied), 39 (satisfied)
- Files: `packages/accord-core/tests/stack-telemetry.test.ts`, `packages/accord-core/src/telemetry/stack-events.ts`, `packages/accord-core/tests/commit-guard.test.ts`, `packages/accord-core/src/commit/commit-guard.ts`, `packages/accord-core/tests/phase-commits.test.ts`, `packages/accord-core/src/commit/phase-commit.ts`, `packages/accord-core/tests/evidence-commit.test.ts`, `packages/accord-core/src/commit/evidence-commit.ts`, `packages/accord-core/tests/state-snapshot.test.ts`, `packages/accord-core/src/state/snapshot.ts`, `packages/accord-core/tests/overrun-decision.test.ts`, `packages/accord-core/src/stack/overrun.ts`
- Task verification: 22 test(s) checked

### AC-30 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 11 (satisfied), 17 (satisfied), 18 (satisfied), 25 (satisfied), 32 (satisfied), 39 (satisfied), 43 (satisfied), 45 (satisfied), 50 (satisfied), 51 (satisfied)
- Files: `packages/accord-core/tests/qualified-ac-refs.test.ts`, `packages/accord-core/src/evidence/qualify-ac.ts`, `packages/accord-core/schemas/trace-schema.json`, `packages/accord-core/tests/alignment.test.ts`, `packages/accord-core/schemas/accord-schema.json`, `packages/accord-core/tests/contract-lock.test.ts`, `packages/accord-core/schemas/contract-lock-schema.json`, `packages/accord-core/src/artifacts/validation.ts`, `packages/accord-core/schemas/plan-schema.json`, `packages/accord-assets/agents/accord/phase-plan.md`, `packages/accord-core/src/orchestration/resolve/interview-task.ts`, `packages/accord-core/tests/overrun-decision.test.ts`, `packages/accord-core/tests/feature-docs.test.ts`, `packages/accord-core/schemas/feature-schema.json`, `packages/accord-core/tests/feature-impact.test.ts`, `packages/accord-core/schemas/spec-schema.json`, `packages/accord-core/tests/docs-validation.test.ts`, `packages/accord-ci/tests/ci-driven-startup.test.ts`, `packages/accord-core/src/config/types.ts`
- Task verification: 29 test(s) checked

### AC-31 - Fail

Evidence:
- command: bun test - exit 1: command timed out after 120000ms
- command: bun run check:biome - exit 1: Some errors were emitted while running checks.

Gap: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

Implementation: tasks 4 (satisfied), 10 (satisfied), 14 (satisfied), 17 (satisfied), 20 (satisfied), 22 (satisfied), 23 (satisfied), 24 (satisfied), 25 (satisfied), 31 (satisfied), 32 (satisfied), 37 (satisfied), 38 (satisfied), 42 (satisfied), 44 (satisfied), 47 (satisfied), 49 (satisfied), 50 (satisfied), 51 (satisfied), 52 (satisfied), 53 (satisfied), 54 (satisfied)
- Files: `packages/accord-ci/tests/evidence-check-runner.test.ts`, `packages/accord-ci/src/evidence-check.ts`, `.github/workflows/accord-evidence.yml`, `docs/ci/pre-merge-smoke.md`, `okf/log.md`, `okf/architecture/monorepo-packages.md`, `packages/accord-core/tests/docs-validation.test.ts`, `okf/references/commit-format.md`, `okf/architecture/evidence-stack.md`, `okf/references/accord-cli.md`, `okf/references/artifacts-and-state.md`, `okf/references/orchestration-policy.md`, `okf/references/stack-config.md`, `okf/architecture/agents.md`, `okf/architecture/crucible-verification.md`, `okf/references/task-file.md`, `okf/architecture/hooks.md`, `packages/accord-core/tests/contract-amend-session.test.ts`, `packages/accord-ci/tests/contract-lock-check.test.ts`, `okf/references/dev-command.md`, `packages/accord-core/tests/alignment.test.ts`, `okf/references/schemas.md`, `packages/accord-cli/tests/stack-cli.test.ts`, `okf/architecture/tool-surface.md`, `packages/accord-ci/tests/evidence-check.test.ts`, `okf/playbooks/answer-decisions.md`, `packages/accord-core/tests/validate-features-script.test.ts`, `AGENTS.md`, `okf/playbooks/verify-a-change.md`, `packages/accord-core/tests/feature-docs.test.ts`, `packages/accord-cli/tests/feature-cli.test.ts`, `okf/references/knowledge-config.md`, `packages/accord-ci/tests/ci-driven-startup.test.ts`, `packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts`, `packages/accord-ci/tests/ci-driven-resume.test.ts`, `okf/playbooks/adopt-autopipeline.md`, `okf/references/environment-variables.md`, `docs/ci/autopipeline.md`
- Task verification: 69 test(s) checked

## Gaps

- AC-1: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-2: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-3: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-4: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-5: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-6: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-7: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-8: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-9: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-10: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-11: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-12: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-13: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-14: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-15: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-16: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-17: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-18: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-19: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-20: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-21: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-22: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-23: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-24: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-25: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-26: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-27: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-28: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-29: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-30: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify
- AC-31: verification.commands preflight failed: bun test → exit 1 (timed out after 120000ms); bun run check:biome → exit 1 (formatting diffs, e.g. JSON arrays in state/trace files)
  Suggested action: Run bun test and bun run check:biome locally; fix timeout/failing cases and format (bunx biome check --write <touched files>) before re-running verify

## Tasks

| Task | Title | Status | Commits | Rounds T/C/V | Findings |
| ---: | --- | --- | --- | --- | ---: |
| 1 | [flags] Stack and knowledge switch resolver with default-off values | done | `0e9ed2e` | 1/1/1 | 8 |
| 2 | [infra] Temp git repo, fake gh helpers and import-boundary test | done | `a018167` | 4/4/1 | 21 |
| 3 | [telemetry] Stack event catalogue and emitter on the shared logger | done | `fcd446c` | 1/1/1 | 9 |
| 4 | [infra] accord/evidence check runner and workflow | done | `fd02108` | 2/1/1 | 21 |
| 5 | [commit-evidence] Commit grammar: Accord trailer build, parse, validate | done | `2194f4d` | 2/1/1 | 13 |
| 6 | [commit-evidence] Commit guard and content redaction | done | `619a27f` | 2/1/1 | 21 |
| 7 | [commit-evidence] Orchestrator-only per-phase commits behind stack.commits phase | done | `dfcd785` | 5/3/1 | 28 |
| 8 | [commit-evidence] Evidence timeline from git trailers | done | `2a2e877` | 3/1/1 | 16 |
| 9 | [commit-evidence] accord evidence CLI command | done | `831cf8e` | 1/1/1 | 11 |
| 10 | [commit-evidence] OKF docs and docs validation test | done | `cfb68a8` | 2/1/1 | 13 |
| 11 | [evidence-asset] Work-item-qualified AC refs, trace.json qualification behind stack.enabled | done | `58b8d41` | 2/1/1 | 15 |
| 12 | [evidence-asset] Evidence asset writer (task-<N>.md and .json) | done | `96e4fcd` | 2/1/1 | 24 |
| 13 | [evidence-asset] Final evidence(task-<N>) commit | done | `b946982` | 2/1/1 | 22 |
| 14 | [evidence-asset] OKF docs for the evidence asset | done | `96f2bbd` | 2/1/1 | 12 |
| 15 | [security-gate] review-security gating inside the C loop | done | `3e86b17` | 2/1/1 | 12 |
| 16 | [security-gate] Route open or disputed gating security findings back to review-security | done | `e8393f1` | 2/1/1 | 11 |
| 17 | [security-gate] Schema description and OKF docs | done | `68d3fe7` | 2/1/1 | 13 |
| 18 | [contract-lock] contract.lock.json writer, verifier and schema | done | `3d58371` | 3/3/2 | 16 |
| 19 | [contract-lock] PR0 contract commit, tag and contract-amend | done | `fea6e0a` | 2/1/1 | 24 |
| 20 | [contract-lock] Pre-write lock guard in the tool_call hook | done | `a076d02` | 2/2/2 | 13 |
| 21 | [contract-lock] Post-spawn lock verification, restore and amend-only commits | done | `7e4b1c0` | 4/2/1 | 24 |
| 22 | [contract-lock] Connect /dev amend-spec to contract-amend, amend marker and blocked downstream tasks | done | `f98ce01` | 2/1/1 | 29 |
| 23 | [contract-lock] Contract-lock rule in the accord/evidence CI check | done | `e448106` | 2/1/1 | 24 |
| 24 | [contract-lock] OKF docs for contract PR0 and amendment | done | `7940f3b` | 1/2/2 | 10 |
| 25 | [stack-compute] Plan schema fields, phase-plan prompt and alignment test | done | `50242d8` | 1/4/5 | 15 |
| 26 | [stack-compute] computeStack: deterministic pack, flag and order | done | `89b79ee` | 3/3/2 | 23 |
| 27 | [stack-compute] PR brief, stack map, stack table and report renderers | done | `c6f34b7` | 2/1/1 | 16 |
| 28 | [stack-compute] StackProvider port and gh provider | done | `eb2f03d` | 2/1/1 | 23 |
| 29 | [stack-compute] Stack service and dev_stack_* MCP tools | done | `3a7bfc8` | 2/1/1 | 26 |
| 30 | [stack-compute] Per-PR branch lifecycle in the spawn preflight | done | `f7abffb` | 2/1/1 | 25 |
| 31 | [stack-compute] accord stack CLI command | done | `b7c7b0e` | 2/1/1 | 15 |
| 32 | [stack-compute] Schema description and OKF docs for the stack | done | `2efaca7` | 2/1/1 | 14 |
| 33 | [tree-state] State size cap and task-file redaction | done | `fcba02c` | 2/1/1 | 15 |
| 34 | [tree-state] State snapshot writer staged with every typed commit | done | `b7c261f` | 2/1/1 | 21 |
| 35 | [tree-state] Stateless resume from committed state | done | `f299bdb` | 2/1/1 | 10 |
| 36 | [tree-state] Closeout commit builds artifacts then removes state | done | `f48130a` | 2/1/1 | 18 |
| 37 | [tree-state] Leftover-state rule in the accord/evidence check | done | `adc441a` | 2/1/1 | 15 |
| 38 | [tree-state] OKF docs for committed state and closeout | done | `85f7289` | 1/1/1 | 13 |
| 39 | [trunk-hardening] Overrun measurement and re-plan decision | done | `f8d7bab` | 2/1/1 | 20 |
| 40 | [trunk-hardening] Open-PR depth cap and flag validation | done | `e2aa296` | 2/1/1 | 19 |
| 41 | [trunk-hardening] Bottom-up merge: retarget next PR by merging main | done | `d26040c` | 5/7/4 | 43 |
| 42 | [trunk-hardening] OKF docs for depth cap, merge order and overrun | done | `103c838` | 2/1/1 | 19 |
| 43 | [feature-knowledge] Feature doc schema, parser and index generator | done | `9b82742` | 2/1/1 | 24 |
| 44 | [feature-knowledge] validate:features script and Dev Harness entry | done | `2349b1d` | 3/5/4 | 23 |
| 45 | [feature-knowledge] spec features[] and PR0 impact analysis | done | `c8d20fe` | 2/1/1 | 24 |
| 46 | [feature-knowledge] Closeout feature-doc update and drift check | done | `3eb57f7` | 3/2/1 | 30 |
| 47 | [feature-knowledge] Review invariants and CI drift rule | done | `2b68f82` | 2/1/1 | 23 |
| 48 | [feature-knowledge] Feature find/impact query and dev_feature_* tools | done | `4d6754c` | 2/1/1 | 20 |
| 49 | [feature-knowledge] accord feature CLI command | done | `f06b2ee` | 2/1/1 | 21 |
| 50 | [feature-knowledge] Schema description and OKF docs for feature knowledge | done | `0d07304` | 1/1/1 | 13 |
| 51 | [ci-driven-mode] Startup push-token check and cost cap key | done | `5f3819c` | 1/1/1 | 8 |
| 52 | [ci-driven-mode] CI builds PR0 from brief and spec | done | `3b43fb7` | 2/1/1 | 30 |
| 53 | [ci-driven-mode] Idempotent resume, concurrency lock, gates and cost-cap alert | done | `c66137e` | 3/2/1 | 50 |
| 54 | [ci-driven-mode] OKF and CI docs for CI-driven mode | done | `7fb4cb6` | 1/1/1 | 13 |

## Accepted risks and unresolved findings

| Task | Req | Finding | Kind | State | Severity | Issue | Location | Resolution |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | AC-26 | F-001 | unresolved (advisory) | open | warning | The required config/types.ts change (typed DevHarnessConfig.stack, .knowledge and orchestration.review_loop.review_security) is not checked by anything. Every fixture is cast with `as unknown as DevHarnessConfig`, every result is cast to Record<string, unknown>, and the stub returns `unknown`. | packages/accord-core/tests/stack-flags.test.ts:16 |  |
| 1 | AC-26 | F-002 | unresolved (advisory) | open | warning | The default assertions do not match the impl step's 'filling every default'. (a) The sizing toEqual (lines 34, 42, 62, 105) uses only 5 keys, so a correct resolver that also fills the schema defaults split_on and merge_small_same_concern fails. Phase-code cannot edit tests, so this causes an RGR respawn. (b) The other defaults are never asserted: top-level merge_strategy, evidence, contract and require_flag, plus knowledge.impact_analysis. The null-config tests (lines 45, 133) check only enabled/commits, and an undefined config (allowed by the signature) is never tested. | packages/accord-core/tests/stack-flags.test.ts:19 |  |
| 1 | AC-26 | F-003 | unresolved (advisory) | open | warning | The switch inputs are tested only with valid literal values. loadDevHarnessConfig (config/agents-md.ts parseAndValidateConfig) does not check stack or knowledge against accord-schema.json, so non-boolean or out-of-enum values reach the resolver. The dark-deploy guard can then turn the stack on, or change the security gate, when the user meant off. | packages/accord-core/tests/stack-flags.test.ts:51 |  |
| 1 | AC-26 | F-004 | unresolved (advisory) | open | warning | Overwritten shared defaults go undetected because of test order. Every default state/sizing assertion runs before the partial-override test (line 88). After it, nothing re-resolves defaults and checks state or sizing. The input-mutation test (line 108) uses an input with no nested state or sizing object, and nothing checks that returned objects are fresh. | packages/accord-core/tests/stack-flags.test.ts:88 |  |
| 1 | AC-26 | F-005 | unresolved (advisory) | open | warning | Knowledge defaults are not checked when a partial knowledge object is present. The drift_check test.each asserts only drift_check, and there is no `knowledge: {}` test. A resolver that returns the user object as-is passes every knowledge test. | packages/accord-core/tests/stack-flags.test.ts:159 |  |
| 2 | AC-28 | F-010 | accepted (advisory) | wont_fix_accepted | suggestion | TC-29 also requires check:types and check:bundle on the change; unit test cannot prove them, and neither command actually enforces the core→Pi boundary | packages/accord-core/tests/layering.test.ts:38 | wont_fix_accepted by T2/review-test — A unit test cannot run check:types or check:bundle. phase-verify-task runs `bun run check:types && bun run check:bundle && bun test packages/accord-core/tests/layering.test.ts`. |
| 2 | AC-28 | F-012 | accepted | waived | critical | phase-code modified test file packages/accord-core/tests/helpers/temp-git-repo.ts (tests are owned by phase-test) | packages/accord-core/tests/helpers/temp-git-repo.ts | waived by human — Plan task 2 deliverable: phase-code implements stub helpers under tests/helpers/ (plan.json files list). Ownership guard false positive; 52 tests pass |
| 2 | AC-28 | F-013 | accepted | waived | critical | phase-code modified test file packages/accord-core/tests/helpers/fake-gh.ts (tests are owned by phase-test) | packages/accord-core/tests/helpers/fake-gh.ts | waived by human — Same as F-012 (fake-gh.ts helper implementation is the planned phase-code deliverable) |
| 3 | AC-29 | F-001 | unresolved (advisory) | open | warning | Unknown-field and missing-field tests only change the number of fields. A rename that keeps the same count, with one declared field swapped for an undeclared one, is never tested. 'Exactly the declared field names' is therefore not enforced. | packages/accord-core/tests/stack-telemetry.test.ts:65 |  |
| 4 | AC-31 | F-002 | unresolved (advisory) | reraised | warning | The trigger and sha wiring is checked by substring presence only. Statuses can be posted to the merge sha, and either trigger can lack the main branch filter. | packages/accord-ci/tests/evidence-check-runner.test.ts:110 | reraised by T2/review-test — Unmet part of the Done-when: 'the status step's statuses/ URL uses that variable'. The test checks only that env contains the expression and bans only the literal `statuses/${{ github.sha }}`. `statuses/$GITHUB_SHA`, `${GITHUB_SHA}` and `${{github.sha}}` still pass, and so does `--head "$GITHUB_SHA"`. The other rows (trigger filters, no pull_request_target, fetch-depth 0, the base no-HEAD~1 check) are verified. |
| 4 | AC-31 | F-011 | accepted (advisory) | wont_fix_accepted | suggestion | The tests pin the declarations (doc and log text). The tools that enforce AC-31 (validate:okf, validate:ste, check:biome) run outside the unit test. | packages/accord-ci/tests/evidence-check-runner.test.ts:106 | wont_fix_accepted by T2/review-test — Running validate:okf, validate:ste, check:biome and the grep checks belongs to phase-verify-task. The suite already asserts the parsed-YAML equivalents of the greps. |
| 4 | AC-31 | F-014 | unresolved (advisory) | open | warning | A05 — Security Misconfiguration: actions/checkout persists GITHUB_TOKEN (statuses: write) into .git/config before running PR-controlled code | .github/workflows/accord-evidence.yml:25 |  |
| 6 | AC-3 | F-005 | unresolved (advisory) | reraised | warning | For review, state and evidence rejections, `result.rule` is never asserted, and the logged rule= value is unchecked. Telemetry is asserted only for review-code with a single path. review-test, review-security, state and evidence rejections, and the per-path event count for multi-path review rejections, are untested. | packages/accord-core/tests/commit-guard.test.ts:189 | reraised by T2/review-test — Done-when unmet: phase-verify-task (now in the table with rejections) has no result.rule literal and no warn-line assertions; state lines (line 301) have no path check; evidence lines (line 312) have no [accord:stack:warn] check. |
| 6 | AC-3 | F-006 | unresolved (advisory) | reraised | warning | The boundaries of the environment-value and home-path rules are untested: an env value of exactly 8 characters (only 7 and 20 are used), env values containing regex metacharacters, and usernames containing '.' or '-'. | packages/accord-core/tests/redact.test.ts:101 | reraised by T2/review-test — Target changed: my original 'full username absent' oracle was too weak. A \w+ username regex leaks '.shirley' and '-last2' and still passes. The new Done-when requires each name segment to be absent. The 8-char and metacharacter env rows are fine. |
| 6 | AC-3 | F-017 | unresolved (advisory) | open | warning | HOME_RE matches `/home/<seg>/` and `/Users/<seg>/` anywhere in a path, so relative repo paths are corrupted and over-counted. | packages/accord-core/src/state/redact.ts:22 |  |
| 6 | AC-3 | F-018 | unresolved (advisory) | open | warning | ASSIGNMENT_RE is case-sensitive, so lowercase or camelCase secret names are not masked. The env-name rule on line 8 uses the `i` flag, so the two rules are inconsistent. | packages/accord-core/src/state/redact.ts:11 |  |
| 6 | AC-29 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The telemetry tests pin `ref=phase-code` (the commit type) in the `ref` field. The stack event catalogue, the trailer path and AC-1 use the round ref (for example 'review-C1' or 'C1/phase-code'), so path-guard rejections cannot be correlated to a round. | packages/accord-core/tests/commit-guard.test.ts:182 | wont_fix_accepted by T2/review-test — Sound: the task signature guardStagedPaths(commitType, workItemId, paths, pattern) has no round ref; a round-ref argument can come later. |
| 6 | AC-29 | F-013 | accepted (advisory) | wont_fix_accepted | suggestion | The '[accord:stack:warn]' prefix assertion would also pass for a direct console.error call with a hand-formatted prefix, which bypasses emitStackEvent and the catalogue's field validation. Proving emission goes through logging.ts is an enforcement check, not a unit assertion. | packages/accord-core/tests/commit-guard.test.ts:175 | wont_fix_accepted by T2/review-test — This is an enforcement check for phase-verify-task (grep for no console. and for emitStackEvent in commit-guard.ts), not a unit assertion. |
| 7 | AC-1 | F-002 | accepted | waived | critical | Orchestrator wiring is untested. Every test calls tryCommitPhase directly with a test-supplied ref. Nothing drives processSubagentToolResult, so: (a) process.ts never calling tryCommitPhase, (b) a wrong ref derivation (e.g. always T1), (c) commitDoneTasks still sweeping in phase mode (sweeps the guard-rejected test file into a '[ID] Task 7:' commit), and (d) a truthy gate `if (devConfig.stack?.commits) skipSweep` that drops per-task commits for commits:"task" (AC-26) all leave every test green. runtime-smoke.ts:110 calls tryCommitOnTaskDone directly, which is untouched by design, so it cannot detect a regression in process.ts. | packages/accord-core/tests/phase-commits.test.ts:121 | waived by human — Wiring test gap after 3 review-test rounds; later rounds were nitpicking test mechanics. Proceed to phase-code; code review (C loop) must verify process.ts wiring and AC-26 per-task commits unchanged |
| 7 | AC-1 | F-023 | accepted (advisory) | wont_fix_accepted | warning | agent-commit reporting is anchored on the latest prior trailered commit, so it never fires for the first phase of a task branch and misreports any human commit between phases. | packages/accord-core/src/commit/phase-commit.ts:142 | wont_fix_accepted by C3/review-code — Detection gap limited to the first phase on a branch with no prior trailered commit; nothing is rewritten or lost. A baseline needs a new persisted task-control field, out of scope for task 7. Add a one-line comment on reportAgentCommits that detection anchors on the latest trailered commit. |
| 7 | AC-1 | F-024 | unresolved (advisory) | reraised | warning | In phase mode a missing task_id, missing ref, or a recovered packet silently produces no commit, and the done-task sweep is also disabled, so that phase's changes are never committed. | packages/accord-core/src/subagent/result/process.ts:559 | reraised by C3/review-code — Two Done-when parts remain unmet. (1) The missing task/ref skip uses log.warn, silent at the default `error` level, with no contentAppend notice, so the orchestrator never sees the skip. (2) The recovered-packet path (process.ts:500 -> recover-task-packet.ts recoverReturnedInFlight) re-applies state with no phase commit, and the sweep is disabled in phase mode, so that phase's files and review markdown are never committed. Done when: skipped commits append a visible `Phase commit skipped (<ref>)` line to the result, and the recovered-packet path makes its phase commit (or the done-task sweep runs as fallback for done tasks with no phase commit). |
| 8 | AC-4 | F-012 | unresolved (advisory) | open | warning | Any `git log` failure is swallowed and returned as an empty timeline, so a real failure looks like 'no evidence'. | packages/accord-core/src/evidence/timeline.ts:95 |  |
| 8 | AC-4 | F-013 | unresolved (advisory) | open | warning | `toRow` coerces missing required trailer keys into the strings 'undefined' and the number NaN instead of rejecting the commit. | packages/accord-core/src/evidence/timeline.ts:70 |  |
| 9 | AC-4 | F-001 | unresolved (advisory) | open | warning | Only one invalid format value ('xml') is tested. Missing or empty --format values are untested, so an implementation that defaults them to md passes. | packages/accord-cli/tests/evidence-cli.test.ts:267 |  |
| 9 | AC-4 | F-002 | unresolved (advisory) | open | warning | Task-selector and work-item-id parsing is the adapter's only real logic, and only valid single-digit selectors are tested. Bad selectors and stray positional arguments silently produce wrong output. | packages/accord-cli/tests/evidence-cli.test.ts:231 |  |
| 9 | AC-4 | F-008 | unresolved (advisory) | open | warning | console.log appends a second newline to renderer output that already ends in \n, so tsv/md output ends with a blank line. | packages/accord-cli/src/commands/evidence.ts:36 |  |
| 10 | AC-31 | F-006 | accepted (advisory) | wont_fix_accepted | suggestion | Two AC-31 clauses are not exercised by this test: 'changes under packages/accord-ci/ also update docs/ci/pre-merge-smoke.md' and 'style: ste procedure text follows ASD-STE100'. None of this task's four docs is marked style: ste, so validate:ste only re-checks okf/playbooks/write-in-ste.md. | packages/accord-core/tests/docs-validation.test.ts:29 | wont_fix_accepted by T2/review-test — The reason is sound. This task changes no packages/accord-ci/ path, a merge-base diff test is fragile in shallow clones, and the pairing is a phase-verify-task check (`git diff --name-only main...HEAD`). |
| 10 | AC-31 | F-008 | unresolved (advisory) | open | warning | Reporting section presents `accord stack report` and the `evidence/task-<N>.json` roll-up as available under an 'Implemented' banner, but neither exists. | okf/references/commit-format.md:56 |  |
| 10 | AC-31 | F-009 | unresolved (advisory) | open | warning | Guard rule descriptions do not match the implementation: `trailer-counts` is not corrected; counts are checked against findings, not 'staged files'; `agent-commit` is log-only; `code-touches-test` only returns a respawn note. | okf/references/commit-format.md:66 |  |
| 10 | AC-31 | F-010 | unresolved (advisory) | open | warning | Concept still says the `stack` key is proposed and 'The harness does not read it yet', now false for `stack.commits`. | okf/references/stack-config.md:20 |  |
| 11 | AC-6 | F-013 | unresolved (advisory) | open | warning | With stack.enabled only id fields are qualified; free-text fields copied into trace.json still contain bare AC-n/TC-n, so the trace does not satisfy 'contains no bare ref' (AC-6). | packages/accord-core/src/artifacts/trace-artifact.ts:402 |  |
| 11 | AC-30 | F-007 | accepted (advisory) | wont_fix_accepted | suggestion | Unit tests here cannot prove AC-30 enforcement, and TC-31 (alignment.test.ts) belongs to the stack-compute plan task, not this one. schemas/examples/trace.json has no qualified ac_id example, so validate:schemas never exercises the widened pattern. | packages/accord-core/tests/qualified-ac-refs.test.ts:1 | wont_fix_accepted by T2/review-test — Enforcement belongs to phase-verify-task (bun run validate:schemas && bun run validate:assets). TC-31 belongs to another task. schemas/examples/trace.json is not in task.files. |
| 12 | AC-5 | F-017 | unresolved (advisory) | open | warning | Test-file classification uses a private globToRegExp with no brace support and no basename matching, so it misclassifies under the shipped default test pattern. | packages/accord-core/src/evidence/lines.ts:77 |  |
| 12 | AC-5 | F-018 | unresolved (advisory) | open | warning | Review-to-fix patches are emitted for every review commit, including clean reviews, and pair it with the next non-review commit of any loop. | packages/accord-core/src/evidence/asset.ts:199 |  |
| 12 | AC-5 | F-019 | unresolved (advisory) | open | warning | Git failures are swallowed, so the writer can commit a hollow evidence asset with no signal. | packages/accord-core/src/evidence/asset.ts:72 |  |
| 12 | AC-5 | F-020 | unresolved (advisory) | open | warning | Red/green excerpts, test counts, responses and acs depend on trailer keys and commit bodies that the only in-repo producer never emits. | packages/accord-core/src/evidence/asset.ts:161 |  |
| 13 | AC-5 | F-011 | unresolved (advisory) | open | warning | The process.ts evidence wiring is tested only for a task that reaches done through a phase-verify-task result. In phase mode the per-task sweep is skipped (process.ts:572), so an implementation that calls commitTaskEvidence only when agentName === 'phase-verify-task' passes cases A-C. A task that reaches done through review-code with orchestration.verify_loop.enabled=false (review-code.ts:131) then gets neither the per-task commit nor an evidence commit, so the task PR is never closed. | packages/accord-core/tests/phase-commits.test.ts:850 |  |
| 13 | AC-5 | F-015 | unresolved (advisory) | open | warning | The roll-up trailer omits tok_in, tok_out and usd_u, which the plan includes in the evidence(task-N) trailer. | packages/accord-core/src/commit/evidence-commit.ts:47 |  |
| 13 | AC-5 | F-017 | unresolved (advisory) | open | warning | In phase mode the evidence commit is tried only for the task of the packet just processed, and the done-task sweep is off, so a failed or missed evidence commit is never retried. | packages/accord-core/src/subagent/result/process.ts:501 |  |
| 13 | AC-27 | F-014 | unresolved (advisory) | open | warning | Failure after the git commit leaves no idempotency marker, so a rerun adds a second evidence commit and the stack.commit.created event is lost. | packages/accord-core/src/commit/evidence-commit.ts:153 |  |
| 13 | AC-29 | F-016 | unresolved (advisory) | open | warning | Stray pre-staged files are unstaged without emitting stack.guard.rejected, unlike phase-commit.ts. | packages/accord-core/src/commit/evidence-commit.ts:126 |  |
| 14 | AC-31 | F-003 | accepted (advisory) | wont_fix_accepted | warning | The check:biome test fails on errors that existed before this task, in files outside task.files. A correct task-14 change cannot make it GREEN, so phase-code will stall. The trace.json format error may also come back after each harness rewrite. Task 14 changes only markdown, which Biome likely does not check, so this gate says little about the change. | packages/accord-core/tests/docs-validation.test.ts:40 | wont_fix_accepted by T2/review-test — Reason is sound: TC-32 requires the check:biome test, and both failing files (scripts/update-model-pricing.ts, docs/dev/ASDLC-1/trace.json) are outside task 14 and outside phase-test's scope. phase-test named both files. biome.json formats JSON and does not exclude docs/dev, so the harness-written trace.json is likely to fail again after each rewrite. A human or harness fix to the baseline is needed before this test can go green. |
| 14 | AC-31 | F-007 | unresolved (advisory) | open | warning | Doc says the evidence asset and evidence(task-<N>) commit depend on `stack.enabled`; source gates them on `stack.commits: phase`. | okf/references/artifacts-and-state.md:42 |  |
| 14 | AC-31 | F-008 | unresolved (advisory) | open | warning | Refs bullet says the asset uses qualified refs 'when `stack.enabled`'; the asset qualifies unconditionally, and only trace.json is gated on `stack.enabled`. | okf/architecture/evidence-stack.md:50 |  |
| 15 | AC-8 | F-008 | unresolved (advisory) | open | warning | The re-raise table never changes severity across the gate. In each row the finding is already gating (rows 1-4) or already advisory (row 5) before the re-raise, so an implementation that keeps the advisory flag unchanged on any re-raise of a security finding (for example, snapshot advisory before recordReview for review-code and restore it after) passes all tests. A security suggestion re-raised as a warning under warn then stays advisory forever, and a critical lowered to a warning under block keeps gating. | packages/accord-core/tests/review-security-gate-stack.test.ts:220 |  |
| 15 | AC-8 | F-010 | unresolved (advisory) | open | warning | review-code's findings brief is restricted to findings it raised itself, so a gated review-security finding fixed by phase-code is never rechecked by review-code (AC-8: 'review-code re-reviews it'). | packages/accord-core/src/tasks/render.ts:128 |  |
| 17 | AC-30 | F-007 | accepted (advisory) | dispute_upheld | suggestion | TC-31 says 'a deliberately misaligned fixture fails' under validate:schemas and validate:assets. The negative fixture goes to Ajv directly, so the tests never show that the scripts detect misalignment. A no-op validate script (exit 0) passes the tests at lines 20 and 25. This is the enforcement half of an architectural AC. The declaration (enum and additionalProperties) is pinned, and task 17 does not change the scripts. | packages/accord-core/tests/alignment.test.ts:53 | dispute_upheld by T2/review-test — Task 17 does not change the validate scripts. Ajv rejects misaligned review_security configs ('major', 'WARN', '', extra key), which pins the declaration. Running the scripts end to end is phase-verify-task's job (`bun run validate:schemas && bun run validate:assets`). |
| 18 | AC-30 | F-007 | accepted (advisory) | wont_fix_accepted | suggestion | AC-30 enforcement (validate:schemas / validate:assets) cannot be proven by a unit test. validate:schemas only checks files in schemas/examples/, so without an example contract-lock-schema.json is never exercised by it. | packages/accord-core/tests/contract-lock.test.ts:234 | wont_fix_accepted by T2/review-test — Sound reason. validate:schemas and validate:assets enforcement is a phase-verify-task command, and schemas/examples/contract-lock.json is a production asset for the impl step. The unit test pins the declaration: the schema file exists and SCHEMA_MAP registration is proved by the negatives. |
| 18 | AC-30 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | New schema and SCHEMA_MAP entry are not reflected in the OKF schema reference or docs/schemas.md. | packages/accord-core/src/artifacts/validation.ts:71 | wont_fix_accepted by C3/review-code — OKF and docs/schemas.md updates are owned by the okf docs task; docs gap on non-critical surface, suggestion only. |
| 19 | AC-9 | F-001 | unresolved (advisory) | reraised | warning | The wiring tests use a schema-invalid plan.json. processSubagentToolResult -> validateReturnedArtifact('phase-plan') validates plan_path against plan-schema.json. PLAN lacks the required `spec`, and its tasks lack `challenge`, `files` and `steps`, so validation.valid=false and applyWorkflowStateFromValidatedReturn never runs. The positive wiring test can pass only if PR0 is built for a REJECTED plan. The negative wiring tests (amend open, stack disabled, lock unset) pass vacuously for a correct implementation because the plan is rejected anyway. | packages/accord-core/tests/contract-pr0.test.ts:28 | reraised by T2/review-test — Target changed. My original 'Done when' did not require each negative fixture to be schema-valid. PLAN now validates and all 4 negatives exist. But the phase-spec negative uses SPEC, which does not match spec-schema.json, and the needs_input packet uses stage 'plan', which is not in the enum. Both are rejected before the post-result runs, which is the root cause F-001 named. Downgraded to warning because the valid 'stuck' case catches status-agnostic code. New 'Done when' is in the finding. |
| 19 | AC-9 | F-019 | unresolved (advisory) | open | warning | A failed amend commit leaves contract.lock.json rewritten and files staged, so a retry appends a duplicate amendment record. | packages/accord-core/src/contract/amend.ts:57 |  |
| 19 | AC-9 | F-020 | unresolved (advisory) | open | warning | Unstaging foreign paths misses the old side of a staged rename, so an unrelated deletion enters the PR0 commit. The same pattern is in amend.ts:74. | packages/accord-core/src/contract/pr0.ts:71 |  |
| 19 | AC-9 | F-021 | unresolved (advisory) | open | warning | The amend commit emits no stack.commit.created event. | packages/accord-core/src/contract/amend.ts:91 |  |
| 20 | AC-31 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The user-facing hook tables in `docs/hooks-and-tools.md` and `docs/accord-workflow.md:375` still omit the contract lock guard, and the Principle paragraph still says hook logic lives only in `harness/` and `subagent/`. | okf/architecture/hooks.md:39 | wont_fix_accepted by C2/review-code — Advisory docs gap. docs/hooks-and-tools.md and docs/accord-workflow.md are outside task.files, and the okf concept (the AC-31 target) is updated. Tracked as follow-up, not a correctness bug. |
| 21 | AC-9 | F-019 | unresolved (advisory) | open | warning | trustedContractLock is called with the raw cwd, but the rest of the function uses the git toplevel, so a non-root cwd silently disables the whole check. | packages/accord-core/src/contract/lock-verify.ts:28 |  |
| 21 | AC-9 | F-020 | unresolved (advisory) | open | warning | A restore of locked files is invisible to the orchestrator and, at the default log level, to the user. A failed restore is swallowed and emits no rejection event. | packages/accord-core/src/subagent/result/process.ts:329 |  |
| 22 | AC-9 | F-011 | accepted (advisory) | wont_fix_accepted | suggestion | Stuck, and cancel after needs_input, never test what happens to locked files already edited during the amend, e.g. spec.json amended by phase-spec before phase-plan gets stuck in --replan. | packages/accord-core/tests/contract-amend-session.test.ts:504 | wont_fix_accepted by T2/review-test — The spec and the task steps say only that stuck clears the marker and snapshot; restore-on-stuck is not specified. A test would invent behaviour. If this matters, the engineer should decide it as a spec question, not phase-test. |
| 22 | AC-9 | F-021 | unresolved (advisory) | open | warning | `applyContractAmend` and the steps after it are not guarded. A throw rejects the whole `processSubagentToolResult` batch. | packages/accord-core/src/contract/amend-session.ts:208 |  |
| 22 | AC-9 | F-022 | unresolved (advisory) | open | warning | `stuck` and `--cancel` delete the snapshot but leave the amended spec.json and plan.json in the working tree. A follow-up `/dev amend-spec` is then refused. | packages/accord-core/src/contract/amend-session.ts:89 |  |
| 22 | AC-9 | F-023 | unresolved (advisory) | open | warning | The amend commit emits no `stack.commit.created`, unlike every other orchestrator commit. | packages/accord-core/src/contract/amend-session.ts:208 |  |
| 22 | AC-31 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | AC-31 is claimed in ac_covered but has no runtime test, which is acceptable for an architectural AC. validate:okf checks structure but does not check that an amend-spec entry was appended. okf/references/dev-command.md:40 still documents `/dev amend-spec <ID>` without the reason, --replan and --cancel arguments. | packages/accord-core/tests/contract-amend-session.test.ts:30 | wont_fix_accepted by T2/review-test — AC-31 is architectural. Enforcement belongs to phase-verify-task: bun run validate:okf, validate:ste and check:biome, plus a grep for the amend-spec entry in okf/log.md. |
| 22 | AC-31 | F-020 | unresolved (advisory) | open | warning | Log entry is appended under the stale `## 2026-10-02` heading and claims Evidence stack and Hooks concepts were updated, but neither describes the amend session. | okf/log.md:76 |  |
| 23 | AC-9 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The push-to-main run is unspecified. The workflow also runs on push with base=github.event.before and head=the squash commit. A squash-merged amend commit (no trailer, touches locked files) will likely fail the status on main, which conflicts with the 'main green' constraint. Only later PRs are tested. | packages/accord-ci/tests/contract-lock-check.test.ts:267 | wont_fix_accepted by T2/review-test — Sound: the spec does not define the result of the push-to-main run over a squash-merged amend, and a squash without a trailer cannot be told apart from a forged edit. Needs a human or spec decision; flagged in analysis. The later-PR behaviour stays covered. |
| 23 | AC-9 | F-017 | unresolved (advisory) | open | warning | On the push-to-main run, a squash-merged amend PR can fail the check because only a commit trailer marks an amend, and trailers do not reliably survive squash. | packages/accord-ci/src/checks/contract-lock.ts:171 |  |
| 24 | AC-31 | F-001 | unresolved (advisory) | open | warning | evidence-stack.md test is satisfied mostly by text that already exists. Only `outcome=amend` and a `src/contract/` source prefix are new requirements. The status line and Layering section can still say contract-lock is proposed. | packages/accord-core/tests/docs-validation.test.ts:300 |  |
| 24 | AC-31 | F-002 | unresolved (advisory) | open | warning | Lock-exclusion negation `/not\|no \|exclud/i` is substring-loose. It matches 'note', 'notes', 'annotated', 'another' and 'no other'. A line saying the lock DOES hash state/work-item.json passes. | packages/accord-core/tests/docs-validation.test.ts:316 |  |
| 24 | AC-31 | F-003 | unresolved (advisory) | open | warning | artifacts-and-state.md test checks 4 tokens anywhere in the file. contract.lock.json is a committed docs/dev/<ID>/ artifact but does not have to appear in the Committed table. The test does not check its contents (sha256 of the 3 files plus the preceding commit), its condition (stack.enabled) or a source binding. | packages/accord-core/tests/docs-validation.test.ts:319 |  |
| 24 | AC-31 | F-004 | unresolved (advisory) | open | warning | dev-command.md amend-spec row checks flag tokens one by one. It does not check the syntax order. It does not require the row to say the contract-amend flow runs only with stack.enabled and an existing contract.lock.json (otherwise behaviour is unchanged, AC-26). dev-command.md sources do not cover the amend code. | packages/accord-core/tests/docs-validation.test.ts:327 |  |
| 24 | AC-31 | F-005 | unresolved (advisory) | open | warning | The log test does not require a NEW appended entry. Editing the existing 2026-10-30 hooks contract-lock bullet in place passes both this test and the task-20 lock-guard log test, which violates AC-31 'append a dated entry' and the append-only log rule. | packages/accord-core/tests/docs-validation.test.ts:338 |  |
| 25 | AC-10 | F-001 | unresolved (advisory) | open | warning | The phase-plan.md test searches the whole file, not the Stack planning section. 'challenge' already appears in the file ('Challenge flag', L73), so that check passes before any change. The required rule 'challenge tasks above stack.sizing budgets' (the plan-side half of AC-10's flag-for-re-plan, never-split rule) is not pinned. | packages/accord-core/tests/alignment.test.ts:237 |  |
| 25 | AC-10 | F-004 | unresolved (advisory) | open | warning | Traceability drift. ac_covered claims AC-10, but no test name or describe in the file mentions ASDLC-1/AC-10. AC-26 tests exist (L253-372) but AC-26 is in neither ac_covered nor task.covers_ac. TC-11 (computeStack golden tests) belongs to task 26, so this task's AC-10 slice is only the plan fields. | packages/accord-core/tests/alignment.test.ts:116 |  |
| 25 | _task | F-002 | unresolved (advisory) | open | warning | With stack enabled, the tests only check that the budget numbers appear somewhere in the text. They don't check which key each number belongs to. A partly set sizing block (one key set, others defaulted) is never tested. | packages/accord-core/tests/alignment.test.ts:347 |  |
| 25 | _task | F-003 | unresolved (advisory) | open | warning | AC-26 (MUST, property) says planning is unchanged when the stack is off. The three stack-off tests only check that 'stack_enabled' and /stack planning/i are absent, plus '321' in one case. Any other stack text added when the stack is off passes. | packages/accord-core/tests/alignment.test.ts:320 |  |
| 26 | AC-10 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The tests read 'flag' in pass B ('unless the task is a refactor, schema, or flag') as 'task.flag is set, so the task never merges'. AC-17 says that under require_flag every non-final task carries a flag. With this reading, merging is turned off for those stacks. kind 'enable' (the task that flips the flag) is also not tested. | packages/accord-core/tests/compute-stack.test.ts:154 | wont_fix_accepted by T2/review-test — Sound reason: plan section 4.2 pass B does not say whether 'flag' means task.flag or kind 'enable', and the tests apply the task.flag reading consistently. A human should confirm, because with require_flag (AC-17) this reading disables merging. |
| 26 | AC-10 | F-019 | accepted (advisory) | wont_fix_accepted | suggestion | A missing est_lines counts as 0, so unknown-size same-concern tasks always merge as 'below min_pr_lines' and bypass the line budget. | packages/accord-core/src/stack/compute-stack.ts:62 | wont_fix_accepted by C3/review-code — Advisory suggestion. A missing est_lines counts as 0, which a legacy-tasks test relies on. Not a correctness bug. |
| 26 | AC-10 | F-021 | accepted (advisory) | wont_fix_accepted | suggestion | StackSizing duplicates the sizing shape in config/stack-flags.ts and config/types.ts, so the three can drift. | packages/accord-core/src/stack/types.ts:15 | wont_fix_accepted by C3/review-code — Reason is scope: deriving StackSizing from the resolved config type belongs to the task that wires resolveStackConfig into computeStack. The finding is not a correctness bug. |
| 27 | AC-11 | F-006 | unresolved (advisory) | reraised | warning | Absent optional fields are never checked for leaking as NaN/undefined. Trailers omit absent keys (commit-grammar: 'absent keys are omitted, never null'), but every trailer in the roll-up fixture carries crit/warn/sugg/tok_in/tok_out/usd_u. A brief AC without text is also never checked for 'undefined'. | packages/accord-core/tests/stack-render.test.ts:357 | reraised by T2/review-test — Unmet: 'In the line 80 test add expect(md).not.toContain("undefined")'. It was added to the section-order test, where all ACs have text. The test with an AC that has no text still does not check for 'undefined'. The report half is met. |
| 28 | AC-11 | F-019 | unresolved (advisory) | open | warning | listPrs silently truncates to gh's default 30 PRs, so unfiltered listing (accord stack sync) can miss stack PRs. | packages/accord-core/src/stack/gh-provider.ts:70 |  |
| 28 | AC-11 | F-020 | unresolved (advisory) | open | warning | setEvidenceStatus reads only the first page of the combined status, so the never-replace-a-CI-failure guard can miss accord/evidence. | packages/accord-core/src/stack/gh-provider.ts:126 |  |
| 29 | AC-11 | F-011 | accepted (advisory) | wont_fix_accepted | warning | The resolver signature (taskId) => number[] has no work item id, and the fixture has exactly one docs/dev/*/plan.json, so 'first plan containing the task' passes. In real repos many work items share task ids. | packages/accord-core/tests/stack-service.test.ts:469 | wont_fix_accepted by T2/review-test — Sound scope reason. PrGroupResolver(taskId) has no workItemId and hooks.ts is outside task files. The multi-work-item ambiguity is a real interface gap; a human or review-code should decide (for example, pass workItemId through resolvePrGroup in a follow-up task). |
| 29 | AC-11 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | dev_stack* tools are only checked in ACCORD_TOOLS. The MCP adapter path is not exercised, and Pi dynamic-tool bundles (active-set.ts ACCORD_TOOL_BUNDLES) would leave them inactive in Pi sessions. | packages/accord-core/tests/stack-service.test.ts:500 | wont_fix_accepted by T2/review-test — MCP register-tools.ts iterates every ACCORD_TOOLS entry, so the MCP path is covered by the ACCORD_TOOLS assertions. Pi bundle activation needs tools/active-set.ts, which is outside task files. Flagged for review-code as follow-up. |
| 29 | AC-11 | F-016 | unresolved (advisory) | open | warning | The fake listPrs treats `state === undefined` as all states, but the only real adapter (gh-provider listPrs) adds --state only when given, and `gh pr list` then returns open PRs only. The sync test's 'merged' assertion therefore passes for a sync that calls listPrs() or listPrs({head}) without state 'all'. Against real GitHub, merged PRs disappear from `accord stack sync`. | packages/accord-core/tests/stack-service.test.ts:180 |  |
| 29 | AC-11 | F-017 | unresolved (advisory) | open | warning | The resolver probes run in a repo with no AGENTS.md Dev Harness config, so only default sizing is exercised. A resolver registered at load time with `resolveStackConfig(null).sizing`, ignoring the project's configured stack.sizing, passes every probe. stackSubmit honours configured sizing (CUSTOM test), so the evidence(task-<N>,<M>) groups would not match the submitted PR groups whenever sizing is customised. | packages/accord-core/tests/stack-service.test.ts:820 |  |
| 29 | AC-11 | F-021 | unresolved (advisory) | open | warning | Stack head branches are named `accord/<ID>/task-<N>`, but the plan puts local stack branches in `stack/<ID>/pr-<n>`, distinct from the CI-driven `accord/*/**` namespace. | packages/accord-core/src/stack/service.ts:63 |  |
| 29 | AC-11 | F-022 | unresolved (advisory) | open | warning | `resolveGroup` takes only a task id, so it picks the first `docs/dev/*/plan.json` containing that id. It also computes groups with default sizing (`resolveStackConfig(null)`), ignoring the repo's `stack.sizing`. | packages/accord-core/src/stack/service.ts:268 |  |
| 29 | AC-11 | F-023 | unresolved (advisory) | open | warning | The four `dev_stack*` tools are not in any bundle in `tools/active-set.ts`, so the Pi adapter never activates them. | packages/accord-core/src/tools/registry.ts:856 |  |
| 29 | AC-11 | F-024 | unresolved (advisory) | open | warning | stackSync lists all PRs with `state: 'all'` and builds a head→PR map where the last entry wins. That can miss stack PRs or report a stale closed one. | packages/accord-core/src/stack/service.ts:126 |  |
| 29 | AC-11 | F-025 | unresolved (advisory) | open | warning | stackReport reads only HEAD's history, loads every commit body into one 10 MB-capped buffer, and turns any git failure into an empty successful report. | packages/accord-core/src/stack/service.ts:249 |  |
| 29 | AC-28 | F-013 | accepted (advisory) | wont_fix_accepted | suggestion | AC-28 enforcement (check:types, check:bundle) cannot be proven by unit tests. Source-regex checks only pin the declaration. | packages/accord-core/tests/stack-service.test.ts:492 | wont_fix_accepted by T2/review-test — Enforcement is a verify concern. The task verify step lists check:types, check:bundle and check:runtime, and layering.test.ts covers the import boundary for all of src. |
| 30 | AC-11 | F-009 | accepted (advisory) | wont_fix_accepted | warning | The success fixture lists only pr-1 and pr-3 although computeStack(PLAN) yields task PRs 1-4, so the tests pin 'a computed task PR absent from provider state counts as merged'. Combined with service.ts stackSubmit naming heads accord/<ID>/task-<N> (open advisory F-021), the real provider never lists any stack/<ID>/pr-* head, so the closeout guard passes even when every task PR is open. | packages/accord-core/tests/stack-branches.test.ts:431 | wont_fix_accepted by T2/review-test — Accepted as out of scope for task 30's tests; the success fixture now lists pr-1..pr-4 merged, so it holds under either semantics. NEEDS HUMAN: service.ts stackSubmit (task 29) pushes task PRs as accord/<ID>/task-<N>, a CI trigger namespace, while the closeout guard watches stack/<ID>/pr-<n>. In production the guard sees no task PRs. The fix belongs in task 29 or in a plan decision, not in these tests. |
| 30 | AC-11 | F-010 | unresolved (advisory) | reraised | warning | scope_out says quick_fix work items keep one branch and one PR. No test covers a phase-test spawn for a quick_fix item with stack.enabled. An impl that switches every phase-test with a task_id creates stack/<ID>/pr-n for quick fixes. If the impl propagates refusals instead, a quick_fix with no plan.json is blocked. | packages/accord-core/tests/stack-branches.test.ts:311 | reraised by T2/review-test — Rebuttal: no invented interface is needed. The work-item pattern lives in .tasks/<ID>.json and is read by loadWorkItem(), which this same preflight already calls (workflow-state-spawn.ts:55). writeTaskFixture accepts quickFixContract, and evidence-commit.test.ts:117-135 already seeds such a file. Quick fixes write docs/dev/<ID>/plan.json with task 1 (code-brief.ts writeQuickFixStubs). An impl that follows the step literally therefore creates stack/<ID>/pr-1 for quick fixes, or blocks them on the missing contract tag, against scope_out. Test: setup(false); write .tasks/ASDLC-9.json with {schema_version:'1.0', id:ID, title:'qf', created, updated, pattern:'quick_fix', phase:'fixing', task_ids:[1], spec, plan:`docs/dev/${ID}/plan.json`, verify:null, brief:null, decisions:[], deviations:[], cost_usd:0}. Call writeTaskFixture({workItemId:ID, taskId:1, quickFixContract:{...}}, repo) and add `**owner_nonce:** abcdef` to the brief if nonce sync needs it. Call runSubagentToolPreflight(spawn('phase-test',1), options(ENABLED)). Done when: this test asserts blockReason toBeUndefined(), HEAD unchanged, and no branch starting with 'stack/', and it passes against the current pre-impl preflight. Passing now proves the fixture itself does not block. |
| 30 | AC-11 | F-018 | unresolved (advisory) | open | warning | While PR0 is unmerged, new task branches are based on the frozen `accord/<ID>/contract` tag, so they miss any later contract-amend commit on the PR0 branch. | packages/accord-core/src/stack/branches.ts:91 |  |
| 30 | AC-11 | F-019 | unresolved (advisory) | open | warning | The closeout unmerged-PR guard matches heads with prefix `stack/<ID>/pr-`, but `stackSubmit` creates PRs from heads named `accord/<ID>/task-<N>` (service.ts `headFor`, open F-021 from task 29), so the guard never matches submitted PRs. | packages/accord-core/src/stack/branches.ts:163 |  |
| 30 | AC-11 | F-020 | unresolved (advisory) | open | warning | `ensureCloseoutBranch` has no same-branch short-circuit and refuses on a dirty tree even when HEAD is already `stack/<ID>/closeout`. It also hits the provider on every call. `ensureTaskBranch` does short-circuit. | packages/accord-core/src/stack/branches.ts:161 |  |
| 31 | AC-28 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | Enforcement half of the architectural ACs cannot be proven by these unit tests. check:types/check:bundle (AC-28) and validate:okf/validate:ste/check:biome (AC-31) must cover the new files: commands/stack.ts, the cli.ts/dispatch.ts edits, the test file and the doc edits. docs-validation.test.ts's biome check is scoped to task-17 files. | packages/accord-cli/tests/stack-cli.test.ts:290 | wont_fix_accepted by T2/review-test — The finding said enforcement belongs to phase-verify-task. Unit tests cannot prove check:types, check:bundle, validate:okf, validate:ste or biome. |
| 32 | AC-31 | F-010 | unresolved (advisory) | open | warning | Intro says computeStack reads max_depth, overrun_factor and split_on, and that the keys are read by the harness. Several keys have no consumer and are not marked 'not yet read'. | okf/references/stack-config.md:26 |  |
| 32 | AC-31 | F-011 | unresolved (advisory) | open | warning | Sizing paragraph says computeStack reads max_depth, and describes post-GREEN overrun measurement and max_depth capping as current behaviour while the same paragraph says overrun_factor is planned. | okf/architecture/evidence-stack.md:74 |  |
| 34 | AC-12 | F-012 | unresolved (advisory) | open | warning | The size-cap tests (lines 322, 344 and 355; the last two were added in T2) do not check the trace or schema contract when output is over the cap. They check only that each file is at most max_bytes, that log[0].note matches /truncated/i and that 'tail-marker' is absent. Plausible wrong implementation: cap the oversized note in task.json, but write STATE.md = capBytes(renderTaskTrace(redactedUncappedTask), max).value. capBytes is a text helper that already exists, so capping the whole file is a natural choice. This passes all three tests. But STATE.md is then no longer 'exactly renderTaskTrace' output, and every trace line after the cut is silently lost: log[0].events and warnings, later log entries and the in-flight line. Related gaps in the same input partition: (1) the capped task.json is never checked with Ajv, so a cap that breaks schema shape passes; (2) only one oversized field is seeded, so a cap that trims only log[0].note, or trims each note to the same budget, passes when several notes are large. | packages/accord-core/tests/state-snapshot.test.ts:322 |  |
| 34 | AC-12 | F-015 | unresolved (advisory) | open | warning | Cap loop exits at the 64-byte string floor with task.json still over max_bytes, then truncates STATE.md independently, so the written snapshot exceeds the cap and STATE.md no longer equals renderTaskTrace(task.json). | packages/accord-core/src/state/snapshot.ts:61 |  |
| 35 | AC-13 | F-003 | unresolved (advisory) | reraised | warning | The 'next action' check compares the clone's resolution only to marker.resolution, which is recorded at line 320 and never checked against the expected agent. If the origin resolves to blocked at some markers (for example owner_nonce drift in buildImplementSpawnTaskBrief, or a fixture gap), blocked equals blocked, the review-ref guard at lines 398-402 never runs, and the only next-ref evidence is allocateRef with an agent the test itself supplies. | packages/accord-core/tests/e2e/state-resume.test.ts:397 | reraised by T2/review-test — Unmet: 'every markers[i] … asserted to equal { outcome: spawn, agent: STEPS[i+1].agent }'. Lines 409 and 411 pin 'review-test' where STEPS[4] and STEPS[6] are 'phase-code'. Root cause: the fixture never sets pre_impl_gates='complete' after the clean T2/review-test (the real post-result/review-test.ts:128 does), so the origin re-runs review-test and the test enshrines that review re-run. A restore that drops pre_impl_gates also passes. Target unchanged; recipe added: set pre_impl_gates in applyToTask at T2/review-test, then derive the list from STEPS. |
| 35 | AC-13 | F-006 | unresolved (advisory) | open | warning | Evidence-finished tasks get no task file, but resume routing treats a missing file as not done, so a fully finished PR resumes to a misleading blocked message. | packages/accord-core/src/work-items/artifact-discovery.ts:264 |  |
| 35 | AC-13 | F-007 | unresolved (advisory) | open | warning | A failed restoreStateFromTree is silently ignored and rehydrate falls back to inferring a fresh work item from plan.json, losing committed state with no log. | packages/accord-core/src/work-items/rehydrate.ts:164 |  |
| 36 | AC-15 | F-010 | accepted (advisory) | wont_fix_accepted | suggestion | Only v, id and outcome of the closeout trailer are pinned. The required trailer keys (task, seq, ref, agent, loop, round) and the subject format are left open, so a hand-written `Accord: v=1 id=ASDLC-1 outcome=closeout` passes. Downstream consumers (evidence timeline, leftover-state check, CI resume 'from the last typed commit') may reject or ignore it. | packages/accord-core/tests/closeout.test.ts:170 | wont_fix_accepted by T2/review-test — The spec and plan pin only v, id and outcome=closeout. The chosen shape is recorded in the comment at line 66. Sound reason. |
| 36 | AC-15 | F-012 | unresolved (advisory) | open | warning | prepareCloseout mutates the worktree (writes marker, deletes state/) before the commit, with no rollback. If the commit fails, the clean-tree guard then blocks every retry. | packages/accord-core/src/orchestration/commit-on-task-done.ts:341 |  |
| 36 | AC-15 | F-013 | unresolved (advisory) | open | warning | Closeout still sweeps done tasks via commitDoneTasks when stack.commits is 'phase'. The per-result sweep skips this mode, so closeout adds legacy `[<ID>] Task N:` commits. | packages/accord-core/src/orchestration/commit-on-task-done.ts:311 |  |
| 36 | AC-15 | F-014 | unresolved (advisory) | open | warning | The closeout commit does not emit the `stack.commit.created` telemetry event that every other typed-commit path emits. | packages/accord-core/src/orchestration/commit-on-task-done.ts:359 |  |
| 37 | AC-14 | F-010 | unresolved (advisory) | open | warning | The malformed-trailer test (added in T2) checks only that a malformed 'Accord:' line does not cause a failure. No test checks that the rule still detects leftover state when a malformed line sits next to a closeout or evidence signal. A rule that fails open on a parse error passes the whole suite. | packages/accord-ci/tests/evidence-check.test.ts:451 |  |
| 37 | AC-31 | F-009 | accepted (advisory) | wont_fix_accepted | suggestion | AC-31 enforcement (validate:okf, validate:ste, check:biome) cannot be proven by this unit test. TC-32's test_name_glob points at packages/accord-core/tests/docs-validation.test.ts, not this file. The okf concept and okf/log.md entry belong to task 38. | packages/accord-ci/tests/evidence-check.test.ts:245 | wont_fix_accepted by T2/review-test — TC-32 test_name_glob targets docs-validation.test.ts. phase-verify-task runs validate:okf, validate:ste and check:biome. Plan task 38 ('[tree-state] OKF docs for committed state and closeout') owns the okf concept and the log entry. |
| 38 | AC-31 | F-001 | unresolved (advisory) | open | warning | Closeout order and closeout marker are token-bag checks. The 'documents the closeout order' test only needs one line containing closeout, 'state/' and 'trace'. The closeoutRow at line 516 only needs to exist. stateRow (508-511) does not say which commit removes state/task-<N>/. | packages/accord-core/tests/docs-validation.test.ts:519 |  |
| 38 | AC-31 | F-002 | unresolved (advisory) | open | warning | The fresh-clone resume mechanism is not pinned. artifacts-and-state.md only needs 'fresh clone' somewhere in the file. In evidence-stack.md, the /fresh clone/i assertion (line 499) already passed before the change: the existing sentence 'A fresh clone or CI runner resumes from the branch alone' satisfies it. Nothing requires state/work-item.json in the Committed table, although PR0 writes it, rehydrate restores it and closeout deletes it. | packages/accord-core/tests/docs-validation.test.ts:521 |  |
| 38 | AC-31 | F-003 | unresolved (advisory) | open | warning | stack.state.* semantics are not pinned. Both the redactRow assertion (/raw packets/) and the maxRow assertion ('262144') already pass against the unchanged doc, so they give no RED. The test title says 'state.redact must stay true', but no assertion checks that or what `false` does. The persist row and the evidence-stack section can keep describing `notes` mode as working, but it is scope_out and a no-op. | packages/accord-core/tests/docs-validation.test.ts:533 |  |
| 38 | AC-31 | F-004 | unresolved (advisory) | open | warning | The tree-state log test does not exclude or pin existing bullets, so editing an old bullet in place satisfies 'append a dated entry'. The earlier log tests use PRIOR_LOG_BULLET, EVIDENCE_ASSET_BULLET and EXISTING_2026_10_30 to prevent this. | packages/accord-core/tests/docs-validation.test.ts:544 |  |
| 38 | AC-31 | F-005 | unresolved (advisory) | open | warning | artifacts-and-state.md and stack-config.md will document the state/ modules, but no test requires them to bind those modules in frontmatter `sources`. Without the bindings, later changes to closeout.ts, restore.ts, snapshot.ts or redact.ts will not prompt a re-check of these concepts (the AGENTS.md 'Keeping it true' rule). Earlier tests in this file require the bindings: asset.ts for artifacts-and-state (line 141) and compute-stack.ts and review-security.ts for stack-config (lines 214, 445). | packages/accord-core/tests/docs-validation.test.ts:505 |  |
| 38 | AC-31 | F-008 | unresolved (advisory) | open | warning | Plan step says document the redaction rules, but the Redaction and Size cap bullets only say 'masks secrets' and 'limits the bytes'. | okf/architecture/evidence-stack.md:84 |  |
| 38 | AC-31 | F-009 | unresolved (advisory) | open | warning | `state.path` is documented as a live directory template, but the harness never reads it. | okf/references/stack-config.md:38 |  |
| 38 | AC-31 | F-010 | unresolved (advisory) | open | warning | 'Modes `notes` and `none` exist' (and the stack-config `state.persist` row) present `notes` as working, but only `tree` is built. | okf/architecture/evidence-stack.md:90 |  |
| 39 | AC-16 | F-001 | unresolved (advisory) | reraised | warning | process.ts is in task.files[] (after GREEN, when stack.enabled and est_lines are present, await checkOverrun), but no test goes through processSubagentToolResult. The AC's 'When the harness measures the diff' is unpinned: wiring, the stack.enabled gate (backward-compat constraint), the GREEN-only trigger and base/head choice can all be wrong while every test stays green. | packages/accord-core/tests/overrun-decision.test.ts:10 | reraised by T2/review-test — Target changed. All four Done-when rows exist (GREEN stack-enabled, RED-only, stack absent/false/missing, est omitted) with the requested assertions. But the GREEN case sets up phase-code without a RED commit, so the base choice that the original recommendation's (d) aimed at is still unpinned for the RED→GREEN sequence: measuring only the GREEN commit drops the test lines. New Done-when: a RED-then-GREEN wiring test asserts size toEqual({est_lines:10, act_prod_lines:5, act_test_lines:40}), one pending decision, and an event with act_lines=45. Line 582 asserts the exact size {10,40,0} and act_lines=40. |
| 39 | AC-16 | F-013 | unresolved (advisory) | open | warning | Overrun check only runs when `stack.commits === "phase"`, but the spec step and AC-16 gate it on `stack.enabled` and est_lines only. | packages/accord-core/src/subagent/result/process.ts:570 |  |
| 40 | AC-17 | F-014 | unresolved (advisory) | open | warning | PR brief summary and stack map derive 'N of M' / position totals from the openable window, not the stack. | packages/accord-core/src/stack/service.ts:211 |  |
| 40 | AC-17 | F-015 | unresolved (advisory) | open | warning | Merged-PR detection uses one unscoped `listPrs({state:'all'})`; the gh provider passes no `--limit`, so gh returns at most 30 PRs. | packages/accord-core/src/stack/service.ts:190 |  |
| 40 | AC-17 | F-016 | unresolved (advisory) | open | warning | `finalTaskId` computes depth by unmemoized recursion over `depends_on`, which is exponential on DAGs with shared ancestors. | packages/accord-core/src/stack/depth.ts:45 |  |
| 41 | AC-17 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | The rule-partition table has no deletion rows. (a) Main deleted a base-added file and the child modified it (modify/delete conflict, main:<path> unreadable). This is untested, so `const mainBlob = await show('main', p).catch(() => null); if (mainBlob === null) keepChild()` passes and silently brings back a file main deleted. (b) The child deleted or reverted content the base added. After a squash merge the plain merge has no conflict, so it silently restores the base content. AC-17 defines the rule only for conflicted paths, so (b) is a spec gap. | packages/accord-core/tests/stack-depth.test.ts:1222 | wont_fix_accepted by T3/review-test — Advisory suggestion. (a) needs a buildScenario deletion hook. The rule already stops a merge when a path is missing from the base head, but a modify/delete row is still the cheap next step. (b) is a spec gap: whether a child's deletion or revert of base-added content survives a squash advance. A human must decide it, and tests must not invent the behaviour. |
| 41 | AC-17 | F-013 | accepted (advisory) | wont_fix_accepted | suggestion | Every advance fixture has exactly one eligible PR. An implementation that advances the first open PR with a merged base and then breaks passes every test. With two chains, the second chain's child is never retargeted. | packages/accord-core/tests/stack-depth.test.ts:1325 | wont_fix_accepted by T3/review-test — Advisory round-1 miss. Advancing one PR per run is fixed by running the advance again, so this does not leave AC-17 fully negatable. |
| 41 | AC-17 | F-020 | accepted (advisory) | wont_fix_accepted | suggestion | Spec gap: after a squash base, a clean 3-way merge silently takes main's version of paths the child reverted, deleted or renamed. The rule only inspects conflicts, so this is not caught. | packages/accord-core/src/stack/merge-bottom-up.ts:120 | wont_fix_accepted by C2/review-code — The spec scopes the rule to conflicts. The limitation is documented in okf/architecture/evidence-stack.md ('Known limit'). |
| 41 | AC-17 | F-029 | accepted (advisory) | dispute_upheld | suggestion | The task head-branch name is rebuilt inline instead of shared with service.ts. | packages/accord-core/src/stack/merge-bottom-up.ts:129 | dispute_upheld by C5/review-code — headFor is private to service.ts, outside task 41 files[]. Exporting it would be scope drift. Suggestion-level, left as a follow-up. |
| 41 | AC-17 | F-036 | unresolved (advisory) | open | warning | raiseDecision silently records nothing and writes a `null` work-item file when `.tasks/<ID>.json` is missing, while advanceStack still reports that the conflict 'needs a decision'. | packages/accord-core/src/stack/merge-bottom-up.ts:62 |  |
| 41 | AC-17 | F-037 | unresolved (advisory) | open | warning | Eligibility is 'parent PR merged and PR open', so every later advanceStack run merges the latest origin/main into PRs that were already advanced. | packages/accord-core/src/stack/merge-bottom-up.ts:207 |  |
| 42 | AC-31 | F-009 | accepted (advisory) | wont_fix_accepted | suggestion | The plan step asks for ASD-STE100 in the playbook, but answer-decisions.md has no `style: ste` frontmatter, so validate:ste (scripts/validate-ste.ts:107) skips it. The TC-32 runner therefore checks no STE rule for the new procedure text. AC-31 itself only requires STE for files marked style: ste. | okf/playbooks/answer-decisions.md:1 | wont_fix_accepted by T2/review-test — AC-31 requires STE only for files marked style: ste. Adding the marker to answer-decisions.md is a plan-owner decision outside phase-test scope. |
| 42 | AC-31 | F-015 | unresolved (advisory) | open | warning | `require_flag` is documented with default `true`, but the harness treats an unset key as off. | okf/references/stack-config.md:54 |  |
| 42 | AC-31 | F-016 | unresolved (advisory) | open | warning | Docs present bottom-up merge as implemented and running, but `advanceStack` has no production caller or entry point. | okf/architecture/evidence-stack.md:123 |  |
| 42 | AC-31 | F-017 | unresolved (advisory) | open | warning | The re-plan option does not say to answer `overrun-task-<N>`, so resume stays blocked after `amend-spec --replan`. | okf/playbooks/answer-decisions.md:68 |  |
| 43 | AC-18 | F-017 | unresolved (advisory) | open | warning | A feature doc whose frontmatter fails to parse, or has no id, is silently dropped, so validateFeatures reports ok:true and skips its ACs, anchors and links. feature-schema.json is never applied by production code. | packages/accord-core/src/knowledge/feature-doc.ts:126 |  |
| 43 | AC-18 | F-018 | unresolved (advisory) | open | warning | decodeURI throws on a malformed percent sequence in a body link, which aborts the whole validation run. | packages/accord-core/src/knowledge/feature-doc.ts:171 |  |
| 43 | AC-18 | F-019 | unresolved (advisory) | open | warning | Index table cells are escaped inconsistently, so common frontmatter produces malformed Markdown rows. Title and status are unescaped, and description escapes only `\|`. | packages/accord-core/src/knowledge/index-gen.ts:44 |  |
| 43 | AC-18 | F-020 | unresolved (advisory) | open | warning | index.json is written with raw writeFileSync instead of the mandated writeJson. The write is non-atomic, so a crash leaves a truncated index.json. | packages/accord-core/src/knowledge/index-gen.ts:59 |  |
| 44 | AC-18 | F-017 | accepted (advisory) | wont_fix_accepted | suggestion | Pre-existing (task 43). Feature docs with invalid YAML or no `id` are skipped without an error, so the validator and index ignore them and the script exits 0. | packages/accord-core/src/knowledge/feature-doc.ts:121 | wont_fix_accepted by C2/review-code — Pre-existing task 43 behaviour in feature-doc.ts, outside this task's files; suggestion severity only. Track a malformed-doc validation code as a follow-up. |
| 44 | AC-18 | F-022 | accepted (advisory) | wont_fix_accepted | suggestion | A feature doc that fails to parse (no frontmatter, invalid YAML, or missing `id`) is silently dropped, so validate:features exits 0 and the doc is checked by nothing and left out of the index. | packages/accord-core/src/knowledge/feature-doc.ts:126 | wont_fix_accepted by C5/review-code — Advisory, and the fix is in knowledge/feature-doc.ts, outside task 44's files. Not a regression from this diff. Worth a follow-up in the knowledge module. |
| 44 | AC-18 | F-023 | accepted (advisory) | wont_fix_accepted | suggestion | The validator rewrites index.md and index.json unconditionally and never fails when the committed index is stale, so CI cannot catch an index that was not regenerated. | scripts/validate-features.ts:65 | wont_fix_accepted by C5/review-code — Optional; AC-18 requires only regeneration. A --check flag or CI drift check belongs to the later drift-check task. |
| 44 | AC-31 | F-009 | accepted (advisory) | wont_fix_accepted | suggestion | AC-31 enforcement (validate:okf, validate:ste, check:biome) for this task's files is not exercised by this file. docs-validation.test.ts runs validate:okf/ste over the whole bundle, but its biome step covers only task-17/32 files. | packages/accord-core/tests/validate-features-script.test.ts:92 | wont_fix_accepted by T2/review-test — The enforcement half of AC-31 (validate:okf, validate:ste, check:biome) is verify-category. phase-verify-task should run `bun run validate:features && bun run validate:okf && bun run validate:ste && bun run check:biome && bun test`, per the plan's verify step. |
| 45 | AC-19 | F-003 | accepted (advisory) | dispute_upheld | warning | Relation `new` is listed in AC-19 but is never produced or asserted. Related features accept any of the 5 relations, so labelling audit-log `modifies` or `deprecates` passes. | packages/accord-core/tests/feature-impact.test.ts:114 | dispute_upheld by T2/review-test — Related row is now pinned to exactly 'depends_on' (that part is met). The 'new' half is upheld: AC-19's Given is anchor intersection, which cannot produce 'new', and spec-schema marks the AC feature slug as PROPOSED/unread. A human must decide when 'new' applies. The schema accepts 'new' (AC-30 it.each). |
| 45 | AC-19 | F-017 | unresolved (advisory) | open | warning | Impact hook gates only on knowledge.enabled and ignores the typed and documented knowledge.impact_analysis switch. | packages/accord-core/src/contract/pr0.ts:40 |  |
| 46 | AC-20 | F-004 | accepted (advisory) | dispute_upheld | suggestion | The commitWorkItemArtifacts hook is tested only with stack.enabled false. The plan requires the hook to run 'independent of stack.enabled'. In the stack.enabled path, commitWorkItemArtifacts first refuses to close out if the working tree is dirty. Two wrong placements pass every test: (a) the hook runs first at the top of the function, writes billing.md, and every stack closeout is refused with 'working tree is not clean'; (b) the hook runs only in the non-stack branch, so stack closeouts never update feature docs. | packages/accord-core/tests/feature-drift.test.ts:242 | dispute_upheld by T3/review-test — The AC-20 part is met: the clean-tree stack test commits BILLING and leaves docs/features clean, and the refused dirty-tree closeout writes no feature docs. The closeout.json co-commit assertion was not added. Phase-test's reason is wrong: state/closeout.ts:22 sets markerRel = `${devRel}/evidence/closeout.json`. That marker belongs to state closeout (task 36), not to AC-20, and the plan keeps this hook independent of task 36. This is the second unchanged dispute, so I am not re-raising it. A human can decide whether the marker check belongs here. |
| 46 | AC-20 | F-015 | accepted (advisory) | wont_fix_accepted | suggestion | The seeded-doc test (added for F-001) sets tags, owners, depends_on, related, supersedes and anchors.interfaces to [] and has no extra frontmatter keys. parseFeatureDoc defaults missing arrays to [], so a hand-rolled serializer that writes only id/type/title/description/status/acs/anchors.code/changes still passes, even though it drops real metadata from existing docs. This defeats the new test but goes beyond what F-001's Done-when asked for, so it is a suggestion. | packages/accord-core/tests/feature-drift.test.ts:374 | wont_fix_accepted by T3/review-test — Advisory and beyond F-001's Done-when. The reason is acceptable. |
| 46 | AC-20 | F-021 | unresolved (advisory) | open | warning | Closeout derives the changed set from plan.json task files only, not from what the work item actually changed. | packages/accord-core/src/knowledge/closeout-update.ts:159 |  |
| 46 | AC-20 | F-022 | unresolved (advisory) | open | warning | The production caller never supplies `pr`, so changes[] entries never link a PR, which AC-20 requires. | packages/accord-core/src/orchestration/commit-on-task-done.ts:341 |  |
| 46 | AC-20 | F-023 | unresolved (advisory) | open | warning | Docs are written one by one inside the loop but `paths` is lost if a later doc throws, leaving written docs unstaged and the tree dirty. | packages/accord-core/src/knowledge/closeout-update.ts:217 |  |
| 46 | AC-20 | F-024 | unresolved (advisory) | open | warning | The hook receives the git root, but docs/dev/<ID>/ lives under the nested scope cwd, so closeout silently does nothing in nested-package repos. | packages/accord-core/src/orchestration/commit-on-task-done.ts:341 |  |
| 46 | AC-20 | F-025 | unresolved (advisory) | open | warning | Test discovery matches any quoted string containing the qualified id, not test names, so acs[].tests can list incidental strings and garbage refs. | packages/accord-core/src/knowledge/closeout-update.ts:112 |  |
| 47 | AC-22 | F-009 | accepted (advisory) | wont_fix_accepted | suggestion | The rule loads config from the PR's working tree. A PR can set knowledge.drift_check to off or enabled to false in AGENTS.md together with an anchored edit and pass. contract-lock trusts base-side state instead. | packages/accord-ci/tests/feature-drift-ci.test.ts:203 | wont_fix_accepted by T2/review-test — The spec does not say whether config is read from base or head. This was suggestion level; leave it to a human or the implementer. |
| 47 | AC-31 | F-011 | accepted (advisory) | wont_fix_accepted | suggestion | AC-31 enforcement (ASD-STE100 procedure text, okf validity, biome) can only be proved by running the commands, not by unit tests. |  | wont_fix_accepted by T2/review-test — This is a verify-category item: phase-verify-task runs validate:okf, validate:ste and biome. Not phase-test scope. |
| 48 | AC-21 | F-001 | unresolved (advisory) | reraised | warning | Progressive disclosure (index → feature → change → evidence, read only as deep as needed) is checked only against the function's own `reads` log. The 'non-matching docs must never be read' guard is vacuous because billing.md and session-store.md are absent. No test makes deeper files unreadable at a shallower depth. Depth feature and change do not assert that the data at that depth is populated, and reads[2].path (change level) is never asserted. | packages/accord-core/tests/feature-query.test.ts:70 | reraised by T2/review-test — Unmet part of Done-when: 'every findFeatures test asserts the complete reads array with toEqual'. The custom-root test at line 190 asserts only `result.reads[0]` (line 194). Adversary: findFeatures resolves doc paths as join(repoRoot,'docs/features',entry.path) and skips a missing doc. That impl passes this test and the dev_feature_find custom-root test, because parity compares against the same function. I narrowed the target to this test; depth-index tests that check only ids are covered by dedicated reads tests. Done when: the line-190 test asserts `result.reads` toEqual [{level:'index',path:'custom/kb/index.json'},{level:'feature',path:'custom/kb/auth-refresh.md'},{level:'change',path:'custom/kb/auth-refresh.md'},{level:'evidence',path:EVIDENCE_PATH}], asserts `result.matches[0].evidence` toEqual [{path:EVIDENCE_PATH, content:'EVIDENCE-SENTINEL-4471\n'}], and asserts that existsSync(join(repo,'docs/features/auth-refresh.md')) is false. |
| 48 | AC-21 | F-015 | unresolved (advisory) | open | warning | Features index.json and plan.json are read/written with raw fs + JSON.parse/writeFileSync instead of the mandated readJson/writeJson helpers. | packages/accord-core/src/knowledge/query.ts:132 |  |
| 49 | AC-21 | F-016 | unresolved (advisory) | open | warning | `feature find` treats an argument as a code path only if it contains '/', so slash-less anchors (package.json, AGENTS.md, Makefile) and backslash paths cannot use the tool's path mode. | packages/accord-cli/src/commands/feature.ts:42 |  |
| 49 | AC-28 | F-010 | accepted (advisory) | wont_fix_accepted | suggestion | Most of AC-28's enforcement cannot be shown by a unit test: check:types and check:bundle. TC-29's file is packages/accord-core/tests/layering.test.ts. That file exists and is unchanged, and it covers the 'Pi never enters accord-core' half. | packages/accord-cli/tests/feature-cli.test.ts:291 | wont_fix_accepted by T2/review-test — The enforcement half belongs to phase-verify-task: bun run check:types, bun run check:bundle and bun test packages/accord-core/tests/layering.test.ts. |
| 49 | AC-31 | F-012 | accepted (advisory) | wont_fix_accepted | suggestion | AC-31 requires a dated okf/log.md entry. No test asserts one, and okf/log.md is not in task 49's files. Plan task 50 (depends_on 49) owns the feature-knowledge log entry. TC-32's file docs-validation.test.ts is not touched by this task, but its generic validate:okf and validate:ste tests still apply. | packages/accord-cli/tests/feature-cli.test.ts:306 | wont_fix_accepted by T2/review-test — okf/log.md is not in task 49's files, and task 50 owns the dated entry. validate:okf, validate:ste and biome run in phase-verify-task. |
| 50 | AC-30 | F-004 | unresolved (advisory) | open | warning | The schema-description negation checks are case-sensitive and match substrings, so a description that still says the layer is proposed and unread passes. | packages/accord-core/tests/docs-validation.test.ts:698 |  |
| 50 | AC-31 | F-001 | unresolved (advisory) | open | warning | The okf/log.md test does not enforce append-only. It passes when the existing ASDLC-1 feature-knowledge bullet is edited, and it will fail on later valid appends because it requires the new bullet to be last. | packages/accord-core/tests/docs-validation.test.ts:750 |  |
| 50 | AC-31 | F-002 | unresolved (advisory) | open | warning | knowledge-config.md tests pass after a one-line edit. 5 of the 7 required terms already exist, and the 'not proposed' test only checks that three exact strings are gone. The tests do not check that the concept describes the implemented layer or binds its sources. | packages/accord-core/tests/docs-validation.test.ts:729 |  |
| 50 | AC-31 | F-003 | unresolved (advisory) | open | warning | The tool-surface.md test accepts the feature tool names anywhere in the file, including the Stack row, which says the tools need stack.enabled. The tools actually need knowledge.enabled. | packages/accord-core/tests/docs-validation.test.ts:744 |  |
| 50 | AC-31 | F-008 | unresolved (advisory) | open | warning | `impact_analysis` is documented as an active key, and the schema, intro and log entry say all keys are read by the harness, but nothing reads it. | okf/references/knowledge-config.md:25 |  |
| 50 | AC-31 | F-009 | unresolved (advisory) | open | warning | `dev_feature_impact` is described as listing features that 'a set of paths' impacts; it takes a work item id. | okf/references/knowledge-config.md:40 |  |
| 51 | AC-25 | F-001 | unresolved (advisory) | open | warning | TC-26 is integration tier ('Run the CI entry point ... assert non-zero exit'), but every AC-25 test calls assertCiDrivenEnv() in-process. No process runs, no exit code is checked, and stderr is not checked at the process boundary. | packages/accord-ci/tests/ci-driven-startup.test.ts:75 |  |
| 51 | AC-25 | F-002 | unresolved (advisory) | open | warning | The 'no default / no substitute' partition is only partly tested. GH_TOKEN, the gh CLI's own env var, is not tested as a fallback. The 'lowercase near-miss' test sets accord_ci_push_token_x, which is not the lowercase name, so it cannot detect case-insensitive lookup. | packages/accord-ci/tests/ci-driven-startup.test.ts:106 |  |
| 51 | AC-25 | F-003 | unresolved (advisory) | open | warning | The leak test runs at the default log level 'error'. accord-core createLogger writes debug, info and warn through console.error only when the level allows it, so a debug log of the token passes. The test also checks only for the full token, so partial leaks pass. | packages/accord-ci/tests/ci-driven-startup.test.ts:122 |  |
| 51 | AC-30 | F-004 | unresolved (advisory) | open | warning | The types check matches /cost_cap_usd\?:\s*number/ anywhere in types.ts. It does not check that the key is under DevHarnessStackConfig.ci, so a misalignment between types and schema passes. Preventing that misalignment is the purpose of AC-30. | packages/accord-ci/tests/ci-driven-startup.test.ts:154 |  |
| 51 | AC-31 | F-005 | unresolved (advisory) | open | warning | The test name says 'documents the server-only secret', but nothing asserts server-only. The 'section' is everything from the first mention of the token to the end of the file, so 'cshirley' and '90-day' can be in unrelated text. | packages/accord-ci/tests/ci-driven-startup.test.ts:161 |  |
| 52 | AC-23 | F-005 | unresolved (advisory) | reraised | warning | The diff range and history shape are never varied. Every fixture branch has exactly one commit, main never advances, and baseRef is always 'main'. All of these pass: diffing HEAD~1..HEAD (last commit only), a two-dot `git diff main HEAD` (no merge-base), and a hard-coded 'main'. In real CI, main usually moves (the two-dot diff sees main's new files and never triggers) and the base is origin/<default>. | packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts:71 | reraised by T2/review-test — Target changed (my Done-when was incomplete). The four cases exist, but mainAdvance (line 139) commits only to the local base. refs/remotes/origin/<base> stays at init (update-ref at line 129 runs before the branch). Adversarial: runPr0 diffs two-dot `git diff --name-only origin/${baseRef} HEAD`, so every test is green. In CI origin/main moves, main's new files show as branch-side deletions, and the run is never triggered. Also, no case uses the actions/checkout shape (no local base branch), so `git merge-base ${baseRef} HEAD` with baseRef 'main' passes the tests and fails in CI. Corrected Done when: (i) mainAdvance also runs `sh('update-ref', `refs/remotes/origin/${base}`, base)` after the 'main moves' commit; (ii) a new in-process case uses fixture({branch: BRANCH, mainAdvance: true}) then `sh('branch','-D','main')` (only the advanced refs/remotes/origin/main remains), and run({baseRef: 'main'}) → status 'gate', `${sha}^` == branch tip, HEAD == result.sha. |
| 52 | AC-23 | F-009 | unresolved (advisory) | reraised | warning | The leak check captures only console.log and console.error at the default log level. A token printed through process.stdout.write or process.stderr.write (the run-phase.ts style), or through createLogger debug/info (suppressed at the default 'error' level), passes. | packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts:182 | reraised by T2/review-test — Target changed (my original recommendation was wrong). captured() (line 245) sets process.env.ACCORD_LOG_LEVEL='debug', but createLogger binds to the default LogContext, whose level stays 'error' until setLogLevel() is called (logging.ts). No accord-ci/accord-cli path calls it. Adversarial: runPr0 does logger.debug(`git ${args.join(' ')}`) with an http.extraheader basic-auth value. That is suppressed in the test, but emitted in CI once a caller sets the level (GitHub masks the raw secret, not its base64). Corrected Done when: captured() imports setLogLevel/getLogLevel from @clive.shirley/accord-core/logging.js, saves getLogLevel(), calls setLogLevel('debug') before fn(), and restores the prior level in finally. Both the success and push-failure runs still assert no TOKEN/TOKEN_B64 in the capture. |
| 52 | AC-23 | F-016 | unresolved (advisory) | open | warning | Workflow scripts run under a fake that does not model GitHub Actions. materialize() replaces every unknown ${{ }} expression with 'main'. The gate and pr0-CLI fixtures keep a local 'main' branch, which a CI checkout on a push to accord/** does not have. origin/main never advances in the gate rows. A gate or pr0 step that uses a wrong base expression passes every test, and in real CI it never triggers or errors. | packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts:566 |  |
| 52 | AC-23 | F-019 | unresolved (advisory) | open | warning | A01 — Broken Access Control: the trust check (stack.enabled and only brief.md + spec.json added) runs in code from the pushed branch, and the next step gives ACCORD_CI_PUSH_TOKEN and ANTHROPIC_API_KEY to more code from that branch. Anyone who can push an accord/* branch can change gate.ts or pr0.ts to always trigger and run their own code with the PAT. This also works for an actor without the `workflow` permission, who cannot edit .github/workflows. | .github/workflows/accord-driven.yml:32 |  |
| 52 | AC-23 | F-020 | unresolved (advisory) | open | warning | A04 — Insecure Design: ACCORD_CI_PUSH_TOKEN stays in process.env while phase-plan runs, so the LLM agent inherits it. The agent reads untrusted brief.md and spec.json and has bash, read and write tools. Text injected into those files can make it read the token (env or /proc/self/environ) and copy it into plan.json (which is committed and pushed) or send it out. | packages/accord-ci/src/ci-driven/pr0.ts:94 |  |
| 52 | AC-23 | F-021 | unresolved (advisory) | open | warning | A04 — Insecure Design: the credentialed push runs in a workspace the agent has already changed. The Authorization extraheader is not scoped to a host, and the push uses the mutable 'origin' remote with repository hooks enabled. An agent that edits .git/config (remote.origin.url) can send the token to a host it controls. An agent that adds .git/hooks/pre-push or pre-commit runs code during the commit and push; for the push, that code can read the header from GIT_CONFIG_PARAMETERS. | packages/accord-ci/src/ci-driven/pr0.ts:148 |  |
| 52 | AC-23 | F-022 | unresolved (advisory) | open | warning | A05 — Security Misconfiguration: the job gives GITHUB_TOKEN contents:write that it never uses. Checkout does not keep credentials, and the push uses ACCORD_CI_PUSH_TOKEN. The write-scoped token is still passed to third-party actions pinned by tag (oven-sh/setup-bun@v2 takes github.token as its default `token` input). | .github/workflows/accord-driven.yml:12 |  |
| 52 | AC-23 | F-026 | unresolved (advisory) | open | warning | PR0 commit hand-rolls `Accord: id=<ID> outcome=pr0` and a `chore(<ID>)` subject instead of using buildCommitMessage, so the trailer breaks the commit grammar and no stack.commit.created event is emitted. | packages/accord-ci/src/ci-driven/pr0.ts:143 |  |
| 52 | AC-23 | F-027 | unresolved (advisory) | open | warning | The planned 'then the startup check' step is not wired: assertCiDrivenEnv() has no production caller, runPr0 re-implements the token check inline, and the git diff in detectPr0Trigger runs before that check. | packages/accord-ci/src/ci-driven/pr0.ts:94 |  |
| 53 | AC-24 | F-017 | unresolved (advisory) | reraised | warning | The production default advance never has to produce gate_failed or read ctx.gates. Every createCiAdvance test passes `gates: NO_GATES` (793) and commitBackend, which always returns parsedReturn status 'done'. A wrong implementation passes every test: run the backend; if a new typed commit exists, push and return {done:false, ref}; else return {done:true}. In CI, a blocked or stuck task then ends runResume as 'completed' with no stack.ci.alert and no PR comment, so 'a failed gate raises the same alert' is never exercised on the real advance. An '/accord unblock' comment starts a run that behaves the same as no comment. The gate_failed tests (1049) cover only an injected advance. | packages/accord-ci/tests/ci-driven-resume.test.ts:776 | reraised by T3/review-test — Rows 1-3 and the runResume+createCiAdvance wiring test are met. TARGET CHANGED for row 4: the observable I suggested (backendCalls.phase) led to pinning phase 'unblock' (line 1086-1104). The production run-phase.ts defaultRunBackend handles only align/spec/plan/check/code/resume/verify/finish and returns {exitCode:1} for any other phase, so the unblock gate reaches only the fake. Also, the extraArgs check (/task/, /3/, the reason) accepts argv such as ['--task','3','--note','fixture was flaky'], which the real parseUnblockArgs rejects ('--note needs a target'). No test pins what happens when the unblock call fails. Corrected recommendation: (1) Replace the regex checks with the real parser: `const parsed = parseUnblockArgs([ID, ...unblockArgv]); expect(parsed.errors).toEqual([]); expect(parsed.taskId).toBe(3); expect(parsed.force ?? parsed.decisions[0]?.reason).toBe('fixture was flaky')`. (2) Prove the route works in production. Either pin an exec route (spyExec records the accord CLI with `unblock ASDLC-1 --task 3 …`, matching guidance (d) 'accord unblock <ID> --task <n>'), or export the backend the resume CLI wires and assert that it dispatches phase 'unblock' to accord-cli unblock (not the unknown-phase fallback). If PhaseRunBackend cannot carry (d), escalate stuck. (3) Add a case where the unblock call returns exitCode 1: no 'resume' backend call, zero pushes, and the result pinned (gate_failed matching /unblock/ or a rejection without TOKEN; pick one). Done when: (1) and (3) exist, and (2) exists or a stuck escalation names it. |
| 53 | AC-24 | F-024 | unresolved (advisory) | open | warning | readGates is tested with one unblock comment only. If the code takes the first matching comment (the oldest, because gh lists comments in time order), a new '/accord unblock 4 …' re-applies an old task-3 unblock and the new request is ignored. | packages/accord-ci/tests/ci-driven-resume.test.ts:460 |  |
| 53 | AC-24 | F-025 | unresolved (advisory) | open | warning | On a push trigger, ghExec answers `gh pr list` without checking GH_TOKEN. The resume step env pins only ACCORD_CI_PUSH_TOKEN. A lookup exec without GH_TOKEN passes every test, but real gh in Actions exits 4. Because the alert path never fails, the result is log-only, and every push-trigger alert (gate or cost cap) posts no PR comment. AC-24 needs the comment through the existing push token. The cost-cap path on a push trigger is also never combined with the lookup. | packages/accord-ci/tests/ci-driven-resume.test.ts:746 |  |
| 53 | AC-24 | F-026 | unresolved (advisory) | open | warning | Branch derivation is tested only with a one-task plan. Guidance q_guidance_6(b) says resume derives the next unfinished PR through computeStack over the committed plan and tree state. An impl that always uses branchFor(id, 1), or the first task PR, passes. A rerun of the push trigger after task 1 finishes would then advance on pr-1 again instead of pr-2. | packages/accord-ci/tests/ci-driven-resume.test.ts:768 |  |
| 53 | AC-24 | F-030 | unresolved (advisory) | reraised | warning | A04 — Insecure Design: ACCORD_CI_PUSH_TOKEN stays in process.env while the resume loop runs phase agents (phase-test/phase-code/review with bash) through the exec harness. The Claude subprocess inherits the full env, so an injected agent can read the PAT (env, /proc/self/environ) and exfiltrate it, or write it into files that CI then commits and pushes. Same root cause as F-020 (task 52), now with more agents and more rounds. | packages/accord-ci/src/ci-driven/resume.ts:670 | reraised by C2/review-security — Partly fixed. main() deletes ACCORD_CI_PUSH_TOKEN before createCliBackend, and claude-code-exec spawns with live process.env, so agents no longer inherit it. But unsetenv does not scrub the initial environ block: /proc/<bun pid>/environ and the parent `bash -e` step shell (GitHub sets the token in the step env) still hold it, and any same-uid agent bash can read them (`cat /proc/*/environ`). GitHub-hosted runners also have passwordless sudo (Runner.Worker memory). A stolen PAT can also post '/accord unblock' comments as OWNER, which then authorise themselves. The outgoing-diff token check and the harness env strip are still missing. Durable fix: run agents in a job without ACCORD_CI_PUSH_TOKEN, hand off the typed commits as a git bundle artifact, and push from a separate push-only job that runs no agent code. |
| 53 | AC-24 | F-031 | accepted (advisory) | wont_fix_accepted | warning | A01 — Broken Access Control: an issue_comment gate makes the secret-bearing resume job check out and run code from the PR head branch, resolved by name only. The approval is not bound to the commit the human reviewed (TOCTOU between comment and checkout). That head contains agent commits pushed by CI, so an injected change to packages/accord-ci/src/ci-driven/*.ts or package.json persists and runs with ACCORD_CI_PUSH_TOKEN and ANTHROPIC_API_KEY on the next authorised comment. There is no cross-repository check either. | .github/workflows/accord-driven.yml:110 | wont_fix_accepted by C2/review-security — Cross-repo heads are now rejected (resume-gate.ts: view.isCrossRepository ? "" : headRefName, then PR_BRANCH fails). The residual TOCTOU needs write access or a compromised agent run, which F-030 already covers. Track the follow-up: pin the run to the gated headRefOid, run tooling from a default-branch checkout (bun install on the PR head runs the root package lifecycle scripts), and reject comments on closed or merged PRs (the gate does not check state). |
| 53 | AC-24 | F-032 | accepted (advisory) | wont_fix_accepted | warning | A01 — Broken Access Control: gate commands are authorised by comment author_association (OWNER/MEMBER/COLLABORATOR), not by repository permission. MEMBER covers any org member, even without access to the repo. COLLABORATOR covers read/triage outside collaborators. These users can trigger LLM spend (ANTHROPIC_API_KEY), PAT pushes, and /accord unblock decisions that are logged as actor:human. | packages/accord-ci/src/ci-driven/resume.ts:52 | wont_fix_accepted by C2/review-security — Accepted for this repo only: it is owned by a personal account (cshirley), so MEMBER cannot occur and COLLABORATOR implies write. 'Tests assert it' is not a security rationale. Replace it with the collaborators/<login>/permission check (admin\|maintain\|write) before the workflow is adopted in an org-owned repo, and update the tests and pre-merge-smoke.md. |
| 53 | AC-24 | F-033 | unresolved (advisory) | reraised | warning | A04 — Insecure Design (authorisation replay): readGates scans the whole PR comment history. The newest `/accord unblock <task> <reason>` is applied again at the start of every run on that PR, including runs triggered later by `/accord approve`. One human decision therefore clears blockers that appear after it (including review-security critical/warning findings in the C loop). Each replay is logged as actor:human, which corrupts the audit trail. | packages/accord-ci/src/ci-driven/resume.ts:177 | reraised by C2/review-security — The F-039 mitigation only covers tasks that are not blocked. If the same task is blocked again later (for example a new review-security critical or warning in a later C round), the next comment-triggered run (any '/accord approve') reads the old '/accord unblock <task> <reason>' (readGates resume.ts:168 scans all history; consumedUnblock only resets inside one run). createCliBackend (resume.ts:687-692) then emits `--note <F-n> <old reason>` for every current blocker, recorded as a human decision. This is a security-gate bypass and an audit-trail error. Bind the unblock to github.event.comment.id (resume-gate output -> ACCORD_CI_COMMENT_ID), or ignore unblock comments older than the task's latest blocked timestamp. |
| 53 | AC-24 | F-036 | accepted (advisory) | wont_fix_accepted | suggestion | Supply chain — the resume job holds ACCORD_CI_PUSH_TOKEN and ANTHROPIC_API_KEY but uses tag-pinned actions (actions/checkout@v4, oven-sh/setup-bun@v2) and an unpinned toolchain (`bun-version: latest`). A moved tag or a compromised Bun release runs in the secret-bearing job. | .github/workflows/accord-driven.yml:115 | wont_fix_accepted by C2/review-security — Suggestion-level follow-up. Pin actions/checkout and oven-sh/setup-bun to commit SHAs and bun-version to the tested version before GA; this applies to the pr0, resume-gate and resume jobs. |
| 53 | AC-24 | F-038 | unresolved (advisory) | reraised | warning | pushHead pushes HEAD to ctx.branch, which is fixed once before the loop, but the orchestrator switches branches when it starts the next PR's task. | packages/accord-ci/src/ci-driven/resume.ts:532 | reraised by C2/review-code — pushHead now pushes the current validated branch plus other ahead stack branches, but the `others` filter (resume.ts:577) requires `refs/remotes/origin/<name>` to exist. A stack branch created in this job (deriveBranch/ensureTaskBranch) has no remote ref, so it is never pushed. Trace: fresh job, pr-1 created locally → typed commits → `accord resume` crosses to task 2 (preflight-runner calls ensureTaskBranch, which switches to a new pr-2) → pushHead pushes only pr-2 → pr-1 commits are lost with the runner, and the next run redoes task 1. Fix: when the remote ref is absent, push the local stack/<ID>/* branch (it is job-created) instead of skipping it. Done when: a test where the backend switches from a new, never-pushed pr-1 to pr-2 shows both stack/<ID>/pr-1 and stack/<ID>/pr-2 pushed without force. |
| 53 | AC-24 | F-040 | accepted (advisory) | wont_fix_accepted | warning | The cost cap is enforced per job, not per work item. Spend from earlier jobs is not carried into a resumed run. | packages/accord-ci/src/ci-driven/resume.ts:355 | wont_fix_accepted by C2/review-code — Accepted as scope: cross-job cost persistence needs a state design change. docs/ci/pre-merge-smoke.md:130 says the cap applies 'per run', so the limit is documented. A human should confirm that this satisfies AC-24's 'per-work-item' wording. |
| 53 | AC-24 | F-042 | unresolved (advisory) | reraised | warning | The resume step has no GH_TOKEN, and checkout does not persist credentials. The closeout path calls gh and fetches origin, and both will fail in Actions. | packages/accord-ci/src/ci-driven/resume.ts:333 | reraised by C2/review-code — The cited test constraint covers the workflow YAML only. The gap is still real in code: the closeout path (resume.ts:351) calls ensureCloseoutBranch, whose gh StackProvider runs `gh pr list` inheriting process.env. main() deletes ACCORD_CI_PUSH_TOKEN and sets no GH_TOKEN, and the resume step has none, so gh in Actions fails with 'set the GH_TOKEN environment variable'. Closeout derivation then throws and the job fails once every task PR is done. Pass the token without touching the YAML or leaking it to the agent subprocess: set process.env.GH_TOKEN only around the ensureCloseoutBranch call in deriveBranch (restore it in finally), or give resolveStackProvider an env. Done when: a test with GH_TOKEN unset and ACCORD_CI_PUSH_TOKEN set shows the closeout gh call receives GH_TOKEN, and GH_TOKEN is absent from process.env after deriveBranch returns. |
| 53 | AC-24 | F-043 | accepted (advisory) | wont_fix_accepted | warning | raiseAlert throws on a failed PR comment, so a failed comment masks the cost_capped/gate_failed result. It also runs gh without the repo cwd. | packages/accord-ci/src/ci-driven/alert.ts:55 | wont_fix_accepted by C2/review-code — Tests assert that a comment failure rejects with the alert logged once, and phase-code cannot edit tests. The job exits 1 either way. cwd is now passed. |
| 53 | AC-24 | F-045 | accepted (advisory) | wont_fix_accepted | suggestion | Duplicated helpers, and a mixed import style for accord-core. | packages/accord-ci/src/ci-driven/alert.ts:20 | wont_fix_accepted by C2/review-code — Style only. trigger.ts uses the same relative import style as alert.ts. |
| 53 | AC-24 | F-046 | accepted (advisory) | wont_fix_accepted | suggestion | Some gate values are read but never used. A bare `/accord unblock` triggers a run that cannot unblock anything. | packages/accord-ci/src/ci-driven/resume.ts:473 | wont_fix_accepted by C2/review-code — Tests require a bare /accord unblock to select resume. The bare form clears the task, so it is harmless. |
| 53 | AC-24 | F-048 | unresolved (advisory) | open | warning | A04 — Insecure Design: the credentialed git push runs in the agent-writable checkout, so repo-local hooks and config reach the push token | packages/accord-ci/src/ci-driven/resume.ts:543 |  |
| 53 | AC-24 | F-049 | unresolved (advisory) | open | warning | A stale `/accord unblock <task> <reason>` comment is re-applied to a task that was blocked again later, so the human blocked-task gate is bypassed. | packages/accord-ci/src/ci-driven/resume.ts:600 |  |
| 53 | AC-24 | F-050 | unresolved (advisory) | open | warning | deriveBranch treats a merged PR as unfinished when its head branch was deleted after merge, so resume restarts finished work. | packages/accord-ci/src/ci-driven/resume.ts:343 |  |
| 53 | AC-31 | F-014 | accepted (advisory) | wont_fix_accepted | suggestion | The smoke-doc declaration is pinned here. A unit test cannot prove enforcement of okf concept and log.md updates, ASD-STE100 style or biome. The okf and log.md work is planned in task 54. | packages/accord-ci/tests/ci-driven-resume.test.ts:1029 | wont_fix_accepted by T2/review-test — The smoke-doc declaration is pinned. validate:okf, validate:ste and check:biome enforcement belongs to phase-verify-task. The okf/log.md entry is task 54's scope. |
| 54 | AC-31 | F-001 | unresolved (advisory) | open | warning | The docs/ci/autopipeline.md test checks keywords anywhere in the whole file, and one assertion is already satisfied by existing text. A doc that leaves out half of the task step's subjects (trigger, gates, cost cap, alert channel, token) still passes. | packages/accord-core/tests/docs-validation.test.ts:782 |  |
| 54 | AC-31 | F-002 | unresolved (advisory) | open | warning | The playbook test does not pin the plan's 'ASD-STE100 for the playbook' requirement or a push-token step. adopt-autopipeline.md has no `style: ste`, so scripts/validate-ste.ts returns [] for it and the TC-32 validate:ste test passes whatever the prose looks like. The keyword checks also accept the terms anywhere, for example a trailing note instead of a numbered step. | packages/accord-core/tests/docs-validation.test.ts:797 |  |
| 54 | AC-31 | F-003 | unresolved (advisory) | open | warning | The log-ordering assertions are wrong in both directions. The new ci-driven test requires `index === bullets.length - 1`, which breaks on the next unrelated okf/log.md append, so the suite stays red on main afterwards. The task-50 test (line 761), changed in this round, now uses `toBeLessThanOrEqual(bullets.length - 1)`, which is always true for any found index. It no longer checks that the feature-knowledge bullet comes after the prior bullets, as its test name says. | packages/accord-core/tests/docs-validation.test.ts:816 |  |
| 54 | AC-31 | F-006 | unresolved (advisory) | open | warning | AC-31 affected OKF concepts left stale: the evidence-stack concept still calls CI-driven mode 'long-term', and stack-config.md has no stack.ci.cost_cap_usd row. | okf/architecture/evidence-stack.md:99 |  |
| 54 | AC-31 | F-007 | unresolved (advisory) | open | warning | Trigger description is wrong and incomplete: it conflates the PR0 build trigger and the resume trigger. | docs/ci/autopipeline.md:59 |  |
| 54 | AC-31 | F-008 | unresolved (advisory) | open | warning | Setup steps omit `stack.enabled: true` and say CI reads accord.json. Without them CI-driven mode silently does nothing. | okf/playbooks/adopt-autopipeline.md:68 |  |
| 54 | AC-31 | F-009 | unresolved (advisory) | open | warning | Step 1 tells consumers to copy `accord-driven.yml` into their repo, but the workflow only runs inside a repo that contains packages/accord-ci. | okf/playbooks/adopt-autopipeline.md:66 |  |

307 unresolved suggestion-level advisories not shown — see the trace.

## Decisions and deviations

- Decision `phase-code-stuck-1` (resolved): check:biome fails on files outside task scope: docs/dev/ASDLC-1/trace.json (format) and packages/accord-core/scripts/update-model-pricing.ts:84 (useOptionalChain). Authorize fixing them, or accept? → Do not fix out-of-scope files. Accept the baseline check:biome failures (docs/dev/ASDLC-1/trace.json, scripts/update-model-pricing.ts); task 14 is markdown-only.
- Decision `esc-ASDLC-1-14-T2/phase-test#0` (resolved): check:biome fails on the baseline for reasons outside task 14 files: lint error in packages/accord-core/scripts/update-model-pricing.ts and format error in docs/dev/ASDLC-1/trace.json. Fix both, or exclude generated docs/dev/**/trace.json from Biome, before phase-code can turn that test green. → Fixed both baseline biome failures manually (formatted trace.json, optional-chain in update-model-pricing.ts). check:biome is green; proceed.
- Decision `phase-code-stuck-2` (resolved): 2 tests write .git/hooks/pre-commit without creating .git/hooks (absent here because the git template dir is missing). Fix tests (mkdir -p hooks) so they can pass? → Yes: tests must mkdir -p .git/hooks before writing pre-commit (git template dir may be absent). Respawn phase-test to fix those 2 tests; phase-code must not edit tests.
- Decision `phase-code-stuck-3` (resolved): Two tests in stack-cli.test.ts (`stack sync` and `stack submit`) cannot pass: cliIn spawns the CLI with a stale PATH. Fix the test? → Test bug fixed by hand: cliIn now passes the live process.env.PATH so the fake gh is found. 19/19 pass in stack-cli.test.ts; proceed.
- Decision `phase-test-stuck-1` (resolved): Task 42 files[] omits okf/references/stack-config.md and okf/references/artifacts-and-state.md. Both are affected by trunk-hardening, and AC-31 requires updating the affected okf/ concepts. Can the plan add both to task 42's files[]? The tests already assert their updates. → Yes. Edit okf/references/stack-config.md and okf/references/artifacts-and-state.md as part of task 42 (AC-31). Recorded as a scope deviation; plan.json is unchanged.
- Decision `phase-test-stuck-2` (resolved): Task 42 files[] lacks okf/references/stack-config.md and okf/references/artifacts-and-state.md, but AC-31 ('update the affected okf/ concepts') requires updating both for trunk-hardening. Add them to task 42 files[]? → Yes: added okf/references/stack-config.md and okf/references/artifacts-and-state.md to task 42 files[] in plan.json (modify). Proceed.
- Decision `esc-ASDLC-1-42-T2/phase-test#0` (resolved): Add okf/references/stack-config.md and okf/references/artifacts-and-state.md to task 42 files[] so phase-code may edit them. → Done: both files added to task 42 files[] in plan.json. Proceed.
- Decision `esc-ASDLC-1-42-T2/phase-test.2#0` (resolved): Add okf/references/stack-config.md and okf/references/artifacts-and-state.md to task 42 files[]? → Done: both files added to task 42 files[] in plan.json. Proceed.
- Decision `esc-ASDLC-1-46-T2/phase-test#0` (resolved): AC-20 requires changes[] to link the PR, but commitWorkItemArtifacts takes no PR input and the plan defines no PR source for finalize. Should the PR come from gh discovery behind the StackProvider port, a work-item field, or an explicit null? → Use an explicit optional input: closeout/feature-update takes pr?: number|string|null, default null. No gh discovery inside finalize (keeps closeout offline and deterministic; provider failures must never block closeout). changes[].pr is nullable in the feature schema; a callers that know the PR (stack service, CI mode) pass it. AC-20 is met by the changes[] entry carrying work item, evidence, contract sha and pr (null when unknown).
- Decision `phase-test-stuck-3` (resolved): Spec/plan leave the post-PR0 branch and PR topology undefined. Please define: (a) which branch the CI advance pushes typed commits to after PR0 merges (today the tests read typed refs from origin main, which is wrong); (b) how a merge-trigger (push to main touching contract.lock.json) rerun finds that task branch, since the gate currently outputs ref=main; (c) which PR is 'the work item PR' for stack.ci.alert comments on a push trigger, where github.event.issue.number is empty; (d) how '/accord unblock' reaches the orchestrator via the backend call; (e) which phase name the CI advance passes to the backend. → Decisions for task 53 (CI resume), grounded in existing code and the plan 3.2b: (a) Branch: after PR0 merges, typed commits go to the per-PR branch from core branchFor(id, pr) = stack/<ID>/pr-<N> (closeout: stack/<ID>/closeout), created via ensureTaskBranch/ensureCloseoutBranch, based on the tag accord/<ID>/contract. Never push typed commits to main. Tests must read typed refs from that branch, not origin main. (b) Merge-trigger rerun: the push-to-main gate resolves <ID> from the changed docs/dev/<ID>/contract.lock.json path, then runs stack computation (computeStack over committed plan + tree state) to find the next unfinished PR and its branch via branchFor. The gate outputs id (not ref=main); ref is derived by resume, not by the trigger. (c) Work-item PR for stack.ci.alert on push triggers (no issue number): the open PR for the current stack/<ID>/pr-<N> branch found with gh pr list --head <branch>; if none exists, fall back to the PR0 PR (head accord/<ID>/*). If still none, emit only the log event (stack.ci.alert at error) and skip the comment; never fail the alert path. (d) /accord unblock: the issue_comment handler parses '/accord unblock <task> <reason>' (authorised users only), and calls the existing accord-core unblock path through the accord-cli backend (accord unblock <ID> --task <n> with the matching --note/--accept/--waive flags) before resuming. Answers to decisions[] use accord answer the same way. (e) Phase name: the CI advance does not pass a fixed phase; it calls the backend resume entry (accord resume <ID>, i.e. the orchestrator picks the next agent from tree state), with phase left to the orchestrator's resolution. Only PR0 build passes plan. Keep it small: implement these as pure functions with injected gh/backend so tests stay offline.
- Decision `phase-test-stuck-4` (resolved): After PR0 merges, (a) which branch does the CI resume advance push typed commits to (today tests push to origin main, which a correct impl pushing to a task branch would fail); (b) how does a merge-trigger (push to main touching docs/dev/<ID>/contract.lock.json) rerun find that branch (gate currently outputs ref=main); (c) which PR is 'the work item PR' for stack.ci.alert comments on a push trigger (event.issue.number is empty there); and (d) how does an '/accord unblock' gate reach the orchestrator on the createCiAdvance backend call (phase/extraArgs)? → Binding design decisions are now in plan.json guidance[] (q_guidance_6): task branch stack/<ID>/pr-<N> via branchFor; push trigger yields <ID> only; alert PR = open PR for the task branch with PR0 fallback; /accord unblock routes via accord unblock CLI; CI advance calls accord resume with no fixed phase. Re-read the brief and proceed; do not ask again.
- Decision `esc-ASDLC-1-53-T3/phase-test#0` (resolved): Define post-PR0 branch/PR topology for CI resume: (a) task branch for typed commits, (b) merge-trigger branch lookup, (c) PR number for alerts on push triggers, (d) unblock delivery to orchestrator, (e) backend phase name. → Resolved in plan.json guidance q_guidance_6; task already progressed to review-code.
- Decision `esc-ASDLC-1-53-T3/phase-test.2#0` (resolved): Post-PR0 CI advance: which branch receives typed commits, how does the merge trigger find it, which PR receives alerts on a push trigger, and how does /accord unblock reach the backend? → Resolved in plan.json guidance q_guidance_6; task already progressed to review-code.
- Deviation, task 2 (accepted): layering.test.ts import-boundary tests pass without impl
- Deviation, task 4 (accepted): Added a test requiring an okf concept to list the evidence-check script or workflow as a source and mention accord/evidence.
- Deviation, task 4 (accepted): Modified okf/architecture/monorepo-packages.md (sources + accord-ci row) outside task.files
- Deviation, task 6 (accepted): Pinned unspecified contract: guardStagedPaths returns {kept,rejected,rule?,respawn?}; guardTrailer(workItemId, trailer, ctx) returns {ok,rule,errors}; event ref = commitType (paths) / trailer.ref (trailer); phase-test unrestricted; state/evidence/verify scopes as documented.
- Deviation, task 6 (accepted): redact.test.ts covers AC-12 (named in the plan step) though task covers_ac is AC-3/AC-29; ac_ids for it set to AC-3 only for attribution.
- Deviation, task 8 (accepted): Pinned the row shape, column set, md/tsv exact text, and the chdir-based cwd for readTimeline in the test header. The spec only names ref, outcome, counts, tokens, cost and 'the documented awk extraction'.
- Deviation, task 9 (accepted): Exported runEvidenceCommand from commands/index.ts (not in task.files)
- Deviation, task 11 (accepted): AC-30 has no dedicated test in qualified-ac-refs.test.ts; the trace-schema ac_id widening is covered indirectly via validateArtifact on a qualified trace.json.
- Deviation, task 13 (accepted): Edited phase-commits.test.ts (not in task.files) to add wiring cases and fix the V1-is-last assertion
- Deviation, task 13 (accepted): Stubbed registerCloseoutBranchHook(hook|undefined) and getCloseoutBranchHook() with an opaque hook type
- Deviation, task 15 (accepted): The review-code re-raise rows (F-001) pass review-code's own gate to applyRechecks and applyReviewFindings. Making them pass likely needs a change in review-code.ts, which is outside task.files.
- Deviation, task 15 (accepted): Modified review-code.ts (not in task.files) to pass securityGate to recordReview
- Deviation, task 17 (accepted): Added tests for okf/architecture/agents.md, okf/architecture/crucible-verification.md and okf/references/task-file.md, which are outside plan task 17 files[].
- Deviation, task 17 (accepted): Edited okf/architecture/agents.md, okf/architecture/crucible-verification.md, okf/references/task-file.md outside task.files[]
- Deviation, task 18 (accepted): Suite passes against the existing phase-code implementation, so red_confirmed is false.
- Deviation, task 19 (accepted): Spec leaves the API of buildContractPr0, registerPreLockHook and applyContractAmend open. Tests fix it: buildContractPr0(id, devConfig, cwd) returns {ok, skipped?, reason?, hash?, tag?}; applyContractAmend(id, {diff: string, reason, affected_acs}, cwd) records amendments[] in contract.lock.json; state/work-item.json is seeded by the test, not generated by PR0.
- Deviation, task 19 (accepted): Amend tests assert the amended contract.lock.json is schema-valid, which needs an `amendments` array ({diff, reason, affected_acs, stale_task_ids}) in contract-lock-schema.json.
- Deviation, task 19 (accepted): Tests expect buildContractPr0 to derive and redact docs/dev/<ID>/state/work-item.json from .tasks/<ID>.json (id, pattern), via redactText in state/redact.ts.
- Deviation, task 19 (accepted): Added optional amendments[] to contract-lock-schema.json
- Deviation, task 21 (accepted): Assumed verifyAfterSpawn(workItemId, cwd, agent?: string) with a third agent-name argument, and commit type 'amend' for guardStagedPaths; rules locked-file-written / locked-path.
- Deviation, task 21 (accepted): process.ts calls verifyAfterSpawn for every attributed result rather than only when contract.lock.json exists on disk
- Deviation, task 22 (accepted): Test contract chosen for amend-session.ts: openAmend(id,{reason,replan},cwd) returns {ok:true,nonce}|{ok:false,reason}; closeAmend(id,cwd); cancelAmend(id,cwd); affectedAcsFromSpecDiff(id,cwd) compares .tasks/<ID>-amend/spec.json with docs/dev/<ID>/spec.json. `/dev amend-spec` rawArgs are '<ID> <reason words> [--replan] | --cancel', via the synchronous resolveDevSubcommandOrchestration.
- Deviation, task 22 (accepted): Phase-spec and phase-plan done packets in the tests omit spec_path and plan_path so the amended fixture files are not schema-validated. Stale tasks are asserted as status=blocked with a blocked.reason containing 'stale after contract-amend'; blocked.kind is not asserted. Unblock is tested via unblockTask(..., {force}).
- Deviation, task 23 (accepted): Edited evidence-check-runner.test.ts: registry-empty assertion now expects the contract-lock rule, and main() is called with rules: [] so the real rule does not run on fake shas.
- Deviation, task 25 (accepted): alignment.test.ts already existed (task 17); appended new describe blocks instead of adding the file.
- Deviation, task 26 (accepted): Defined StackPlan/PrGroup/StackFlag output shape and the sizing input type in types.ts, because the spec does not fix them. Tests and the golden fixture pin that shape.
- Deviation, task 29 (accepted): No work-item-scoped resolver test (F-011)
- Deviation, task 30 (accepted): Test for 'closeout hook runs before any closeout artifact write' covers hook registration and delegation only; wiring into commit-on-task-done.ts is not in this task's files. Stub created at stack/branches.ts (in task.files) and does not register the hook.
- Deviation, task 30 (accepted): Added side-effect import of ./branches.js in stack/service.ts (not in task.files)
- Deviation, task 31 (accepted): Tests require edits outside task.files[]: packages/accord-cli/src/commands/index.ts (export runStackCommand), packages/accord-cli/src/ui/command-catalog.ts (help lists stack), okf/log.md (dated bullet).
- Deviation, task 31 (accepted): Added the stack entry to packages/accord-cli/src/ui/command-catalog.ts
- Deviation, task 35 (accepted): Pinned restoreStateFromTree(id, cwd?) -> Result<{restored, task_ids}> and next ref = allocateRef(task, nextAgent); spec leaves both open.
- Deviation, task 35 (accepted): No test for artifact-discovery.ts 'skip state/' step.
- Deviation, task 36 (accepted): Closeout commit returns full HEAD sha (not short) when stack.enabled
- Deviation, task 38 (accepted): Added task-38 tests to existing packages/accord-core/tests/docs-validation.test.ts (TC-32 glob) rather than a new file; no stub needed (docs-only task).
- Deviation, task 39 (accepted): Size persisted in task sidecar size.json instead of task file; trace-artifact reads it
- Deviation, task 39 (accepted): measureActualLines (evidence/lines.ts) now excludes .tasks/
- Deviation, task 40 (accepted): TC-18 squash-merge advance scenarios (add/add resolved by rule, differing conflict raising a decision, rebase/merge-commit bases) are not tested in this task.
- Deviation, task 40 (accepted): Tests pin require_flag absent = off, but accord-schema.json:425 and okf/references/stack-config.md:51 document 'Default: true'.
- Deviation, task 41 (accepted): Added no-op retarget to fake providers in stack-branches.test.ts and stack-service.test.ts, and 'retarget' to the port-method list in stack-provider-gh.test.ts
- Deviation, task 41 (accepted): Touched tests/state-redact.test.ts (outside task.files) to fix a biome useTemplate error
- Deviation, task 44 (accepted): Added test file packages/accord-core/tests/validate-features-script.test.ts (not in task.files); CLI --root semantics: dir containing docs/features is a repo, else each child dir with docs/features is validated and errors aggregated.
- Deviation, task 44 (accepted): Tests pass without new impl: scripts/validate-features.ts already implemented in earlier rounds.
- Deviation, task 45 (accepted): Defined analyseImpact return shape ({rows, decisions}) and 'contradiction' as modifying a deprecated feature's anchor, since the spec leaves both undefined
- Deviation, task 45 (accepted): AC-30 alignment of spec features[] is covered by schema accept/reject tests here; manifest/registry alignment for this task is enforced by validate:schemas and validate:assets in phase-verify-task
- Deviation, task 45 (accepted): PR0 test requires spec.md with the Impacted features table to be committed in PR0 (F-006)
- Deviation, task 46 (accepted): Defined the public signatures and changes[] entry shape (work_item, pr, evidence, contract_sha, ac_map) for the closeout updater and drift check in the tests and stubs.
- Deviation, task 47 (accepted): Spec does not define the CI rule API or the no-change declaration form; tests pin createFeatureDriftRule(cwd,{config}), doc-change = owning feature doc in diff, and a 'Feature-Unchanged: <slug>' commit-message line.
- Deviation, task 47 (accepted): AC-31 is architectural (okf log, STE, biome, pre-merge-smoke.md); no runtime test written. Covered by TC-32 docs-validation.test.ts and verification commands validate:okf, validate:ste, check:biome.
- Deviation, task 50 (accepted): Edited packages/accord-core/schemas/spec-schema.json (feature and features[] descriptions) though not in task.files[]
- Deviation, task 52 (accepted): Added trigger.ts and gate.ts (dependency-free gate via relative accord-core import)
- Deviation, task 52 (accepted): Bootstrap writes work item phase/brief/spec directly instead of devTransition
- Deviation, task 53 (accepted): Edited packages/accord-ci/tests/e2e/ci-driven-pr0.test.ts: on.push.branches now uses toContain, and workflowSteps is scoped to the pr0 job
- Deviation, task 53 (accepted): Pinned a minimal createCiAdvance contract: one runBackend call per advance, the orchestrator's typed commit pushed once without force, done:true when no new typed commit exists. Also pinned the resume-gate job topology including a ref output.
- Deviation, task 53 (accepted): Added AdvanceContext.branch, optional RunResumeOpts.prNumber/RaiseAlertOpts.prNumber and Gates.unblock to the stubs; gate comments accepted on stack/<ID>/pr-<N> and closeout branches; PR0 lock file on the tree counts as pr0_approved.
- Deviation, task 53 (accepted): Added packages/accord-ci/src/ci-driven/resume-gate.ts, a new gate script not in task.files, and exported defaultRunBackend from run-phase.ts
- Deviation, task 53 (accepted): okf/ concepts and okf/log.md not updated in this task

## Discrepancies (verify vs trace)

_None._

Next: `/dev gaps ASDLC-1`.
