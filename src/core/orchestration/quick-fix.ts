/**
 * Quick-fix orchestration — task-file loop counters and severity-gate policy.
 *
 * Post-result side-effects (mutating the primary task file) live in
 * `post-result/{phase-test,review-test}.ts`; resume routing for the
 * `fixing`/`implementing` coarse phases lives in `resolve/primary-task.ts`.
 * This module is the pure-decision core: counters, severity gates, and the
 * policy-aware "what should we do next?" predicates.
 */

import * as path from "node:path";
import { buildImplementSpawnTaskBrief } from "../briefing/task-requirements.js";
import type { DevHarnessConfig } from "../config/types.js";
import { readJson, TASKS_DIR, writeJson } from "../work-items/io.js";
import type { PolicySeverityGate, QuickFixLoopPolicy } from "./policy.js";
import { findingsTriggerReviewRetry } from "./policy.js";
import { decideAfterReviewTest, readReviewLoopCounters } from "./review-feedback.js";

export { RESUMABLE_PIPELINE_TASK_PHASES } from "../types/phases.js";
export { findingsTriggerReviewRetry, maxFindingSeverityRank } from "./policy.js";
export type { ReviewTestVerdict } from "./review-feedback.js";

import type { ReviewTestVerdict } from "./review-feedback.js";

/**
 * When `review-test` verdict is `issues`, only findings at or above `severityGate`
 * consume a quick-fix retry slot (see `QuickFixLoopPolicy.severityGate`).
 */
export function reviewIssuesConsumeQuickFixRetrySlot(
  findings: ReadonlyArray<{ severity?: string }>,
  gate: PolicySeverityGate,
): boolean {
  return findingsTriggerReviewRetry(findings, gate);
}

function devConfigFromQuickFixPolicy(policy: QuickFixLoopPolicy): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "unknown",
    test: { command: "true" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
    orchestration: {
      quick_fix_loop: {
        max_test_review_loops: policy.maxTestReviewLoops,
        severity_gate: policy.severityGate,
      },
    },
  };
}

export function readQuickFixLoopCounters(task: Record<string, unknown>): {
  test_review_cycles_used: number;
} {
  const counters = readReviewLoopCounters(task);
  return { test_review_cycles_used: counters.test_review_retries_used };
}

/**
 * After `review-test` completes with verdict `issues` that already passed the severity gate,
 * decide whether to retry `phase-test`, proceed to `phase-code`, or block on the loop cap.
 */
export function decideQuickFixAfterReviewTest(
  counters: { test_review_cycles_used: number },
  verdict: ReviewTestVerdict,
  policy: QuickFixLoopPolicy,
):
  | { nextAgent: "phase-test" | "phase-code"; bumpCycle: boolean }
  | { blocked: true; reason: string } {
  if (verdict === "clean") {
    return { nextAgent: "phase-code", bumpCycle: false };
  }
  if (counters.test_review_cycles_used >= policy.maxTestReviewLoops) {
    return {
      blocked: true,
      reason: `Quick-fix test/review loop cap reached (${String(policy.maxTestReviewLoops)} cycles). Delegate to accord skill or raise the cap in policy.`,
    };
  }
  return { nextAgent: "phase-test", bumpCycle: true };
}

/**
 * Full branch from a validated `review.json` packet: clean → `phase-code`;
 * gated soft issues → `phase-code` without bump; gated hard issues → retry cap logic.
 */
export function decideQuickFixAfterReviewPacket(
  counters: { test_review_cycles_used: number },
  packet: { verdict: ReviewTestVerdict; findings: ReadonlyArray<{ severity?: string }> },
  policy: QuickFixLoopPolicy,
):
  | { nextAgent: "phase-test" | "phase-code"; bumpCycle: boolean }
  | { blocked: true; reason: string } {
  const decision = decideAfterReviewTest(
    {
      test_review_retries_used: counters.test_review_cycles_used,
      code_review_retries_used: 0,
    },
    { verdict: packet.verdict, findings: [...packet.findings] },
    devConfigFromQuickFixPolicy(policy),
    "quick_fix",
  );
  if ("blocked" in decision) {
    return { blocked: true, reason: decision.reason };
  }
  return {
    nextAgent: decision.nextPhase,
    bumpCycle: decision.bumpTestRetry,
  };
}

export function bumpQuickFixTestReviewCycle(
  workItemId: string,
  taskId: number,
): { ok: true; test_review_cycles_used: number } | { ok: false; error: string } {
  const filePath = path.join(TASKS_DIR, `${workItemId}-task-${taskId}.json`);
  const raw = readJson<Record<string, unknown>>(filePath);
  if (!raw) {
    return { ok: false, error: `Missing task file ${filePath}` };
  }
  const prev = readQuickFixLoopCounters(raw);
  const used = prev.test_review_cycles_used + 1;
  raw.quick_fix_loop = { test_review_cycles_used: used };
  writeJson(filePath, raw);
  return { ok: true, test_review_cycles_used: used };
}

/**
 * Rich `review-test` task body for **quick_fix** or **implement** pre-impl (after `phase-test` wrote `test_files`).
 * Returns `null` when stubs or `test_files` are missing — caller should fall back to a generic resume brief.
 */
export function buildQuickFixPreImplReviewTestBrief(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
  devConfig?: DevHarnessConfig | null;
}): string | null {
  if (input.dispatchAgent !== "review-test") {
    return null;
  }
  const brief = buildImplementSpawnTaskBrief({
    workItemId: input.workItemId,
    dispatchAgent: input.dispatchAgent,
    phase: input.phase,
    title: input.title,
    pattern: input.pattern,
    variant: input.variant,
    devConfig: input.devConfig ?? null,
  });
  if (!brief.ok) {
    return null;
  }
  return brief.value;
}
