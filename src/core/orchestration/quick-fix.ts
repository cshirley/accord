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
import type { DevHarnessConfig } from "../config/types.js";
import { loadWorkItem, readJson, TASKS_DIR, writeJson } from "../work-items/io.js";
import type { PolicySeverityGate, QuickFixLoopPolicy } from "./policy.js";
import { decideAfterReviewTest, readReviewLoopCounters } from "./review-feedback.js";

export { RESUMABLE_PIPELINE_TASK_PHASES } from "../types/phases.js";
export type { ReviewTestVerdict } from "./review-feedback.js";
import type { ReviewTestVerdict } from "./review-feedback.js";

const SEVERITY_RANK: Record<string, number> = {
  suggestion: 1,
  warning: 2,
  critical: 3,
};

/** Highest numeric rank among finding severities (0 when there are no findings). */
export function maxFindingSeverityRank(findings: ReadonlyArray<{ severity?: string }>): number {
  let maxRank = 0;
  for (const finding of findings) {
    const rank = SEVERITY_RANK[finding.severity ?? ""] ?? 0;
    if (rank > maxRank) maxRank = rank;
  }
  return maxRank;
}

/**
 * When `review-test` verdict is `issues`, only findings at or above `severityGate`
 * consume a quick-fix retry slot (see `QuickFixLoopPolicy.severityGate`).
 * `none` disables the gate (any issue behaves like a retry-worthy issue).
 */
export function reviewIssuesConsumeQuickFixRetrySlot(
  findings: ReadonlyArray<{ severity?: string }>,
  gate: PolicySeverityGate,
): boolean {
  if (gate === "none") {
    return true;
  }
  const maxRank = maxFindingSeverityRank(findings);
  if (gate === "warn") {
    return maxRank >= SEVERITY_RANK.warning;
  }
  if (gate === "block") {
    return maxRank >= SEVERITY_RANK.critical;
  }
  return true;
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
  const devConfig = {
    orchestration: { review_loop: { max_critical_retries: policy.maxTestReviewLoops } },
  } as DevHarnessConfig;
  const decision = decideAfterReviewTest(
    {
      test_review_retries_used: counters.test_review_cycles_used,
      code_review_retries_used: 0,
    },
    { verdict: packet.verdict, findings: [...packet.findings] },
    devConfig,
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
}): string | null {
  if (input.dispatchAgent !== "review-test") {
    return null;
  }
  if (input.pattern !== "quick_fix" && input.pattern !== "implement") {
    return null;
  }
  const wi = loadWorkItem(input.workItemId);
  if (!wi?.spec || !wi.plan) {
    return null;
  }
  const spec = readJson<Record<string, unknown>>(wi.spec);
  const plan = readJson<Record<string, unknown>>(wi.plan);
  const primaryTaskId = wi.task_ids[0] ?? 1;
  const taskPath = path.join(TASKS_DIR, `${input.workItemId}-task-${primaryTaskId}.json`);
  const taskFile = readJson<Record<string, unknown>>(taskPath);
  if (!spec || !plan || !taskFile) {
    return null;
  }
  const testFiles = (Array.isArray(taskFile.test_files) ? taskFile.test_files : []).filter(
    (f): f is string => typeof f === "string",
  );
  const testStrategy = (
    taskFile.quick_fix_contract as { test?: { strategy?: string } } | undefined
  )?.test?.strategy;
  if (testFiles.length === 0 && testStrategy !== "no_test") {
    return null;
  }

  const tasks = (plan.tasks as unknown[] | undefined) ?? [];
  const taskRow = tasks.find(
    (t) => String((t as Record<string, unknown>).id) === String(primaryTaskId),
  ) as Record<string, unknown> | undefined;
  if (!taskRow) {
    return null;
  }

  const coveredAcIds = (taskRow.covers_ac as string[] | undefined) ?? [];
  const criteria = (spec.acceptance_criteria as unknown[] | undefined) ?? [];
  const coveredAcs = criteria.filter((ac) =>
    coveredAcIds.includes(String((ac as Record<string, unknown>).id)),
  );

  const verification = spec.verification as Record<string, unknown> | undefined;
  const allTestCases = (verification?.test_cases as unknown[] | undefined) ?? [];
  const testCases = allTestCases.filter((tc) => {
    const covers = (tc as Record<string, unknown>).covers;
    return typeof covers === "string" && coveredAcIds.includes(covers);
  });

  const guidance = (plan.guidance as unknown[] | undefined) ?? [];
  const engineerGuidance = guidance.filter((g) => {
    const gr = g as Record<string, unknown>;
    return gr.source === "engineer";
  });

  const payload = {
    mode: "pre-impl" as const,
    test_files: testFiles,
    production_files: [] as string[],
    test_output: "",
    covered_acs: coveredAcs,
    test_cases: testCases,
    task: taskRow,
    guidance: engineerGuidance,
    quick_fix_contract: taskFile.quick_fix_contract,
    ...(testStrategy === "no_test"
      ? {
          note: "quick_fix_contract.test.strategy is no_test — review scope, stubs, and contract only (no new test files).",
        }
      : {}),
  };

  const pipelineLabel = input.pattern === "quick_fix" ? "quick fix" : "implement";

  const lines = [
    `## review-test — ${pipelineLabel} (pre-impl)`,
    "",
    "ACCORD harness orchestration built this brief from spec/plan stubs and the per-task file.",
    "",
    `**work_item_id:** ${input.workItemId}`,
    `**work_item_phase:** ${input.phase}`,
    `**dispatch_agent:** ${input.dispatchAgent}`,
    `**title:** ${input.title}`,
    ...(input.variant ? [`**variant:** ${input.variant}`] : []),
    "",
    "### Pre-impl payload (read fields below; open test files from disk)",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Return the structured `review-test` result packet required by your agent contract.",
  ];
  return lines.join("\n");
}
