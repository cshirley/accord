/**
 * Review feedback persistence, critical-issue retry policy, and resume brief supplements.
 */

import { loadDevHarnessConfig } from "../config/index.js";
import type { DevHarnessConfig } from "../config/types.js";
import { loadTaskFile, loadWorkItem } from "../work-items/io.js";
import {
  DEFAULT_MAX_CRITICAL_REVIEW_RETRIES,
  findingsTriggerReviewRetry,
  reviewRetryPolicyForAgent,
  severityGateRemediationLabel,
} from "./policy.js";
import { resolvePrimaryTaskIdForMutation } from "./post-result/primary-task.js";

export type ReviewTestVerdict = "clean" | "issues";

export interface ReviewFinding {
  severity?: string;
  issue?: string;
  file?: string;
  line?: number;
  evidence?: string;
  recommendation?: string;
  category?: string;
  ref?: string;
}

export interface ReviewReturnPacket {
  verdict: ReviewTestVerdict;
  findings: ReviewFinding[];
  /** Optional structured summary; prose may also be stored separately as `analysis`. */
  analysis?: string;
}

export interface LastReviewFeedback {
  agent: "review-test" | "review-code" | "review-security";
  verdict: ReviewTestVerdict;
  findings: ReviewFinding[];
  at: string;
  /** Full validated return packet (audit). */
  packet: Record<string, unknown>;
  /** Adversarial / review narrative for audit and remediation briefs. */
  analysis?: string;
}

export interface ReviewLoopCounters {
  test_review_retries_used: number;
  code_review_retries_used: number;
  /**
   * Lifetime cycle counts — incremented alongside the resettable counters above but never
   * cleared by `/dev unblock`. `decideAfterReviewTest` / `decideAfterReviewCode` block once these
   * hit `retryPolicy.maxLifetimeRetries`, independent of how many unblock slots remain.
   */
  lifetime_test_review_cycles: number;
  lifetime_code_review_cycles: number;
  /** Times `/dev unblock` has reset this task's retry counters, ever. Never decremented. */
  unblock_count: number;
}

export function isReviewReturnPacket(packet: unknown): packet is ReviewReturnPacket {
  if (!packet || typeof packet !== "object") {
    return false;
  }
  const record = packet as Record<string, unknown>;
  if (record.verdict !== "clean" && record.verdict !== "issues") {
    return false;
  }
  if (!Array.isArray(record.findings)) {
    return false;
  }
  return record.findings.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).severity === "string",
  );
}

/** True when findings meet the default implement gate (`block` = critical only). */
export function hasCriticalFindings(findings: ReadonlyArray<ReviewFinding>): boolean {
  return findingsTriggerReviewRetry(findings, "block");
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function readReviewLoopCounters(task: Record<string, unknown>): ReviewLoopCounters {
  const loop = task.review_loop as
    | {
        test_review_retries_used?: unknown;
        code_review_retries_used?: unknown;
        lifetime_test_review_cycles?: unknown;
        lifetime_code_review_cycles?: unknown;
        unblock_count?: unknown;
      }
    | undefined;
  const legacy = task.quick_fix_loop as { test_review_cycles_used?: unknown } | undefined;

  const testRaw = loop?.test_review_retries_used ?? legacy?.test_review_cycles_used;

  return {
    test_review_retries_used: nonNegativeInt(testRaw),
    code_review_retries_used: nonNegativeInt(loop?.code_review_retries_used),
    // Lifetime counters have no legacy fallback: a task written before this field existed had
    // zero prior lifetime cycles recorded, so defaulting to 0 (not to the resettable counter) is
    // correct — it does *not* retroactively grant extra budget on first read.
    lifetime_test_review_cycles: nonNegativeInt(loop?.lifetime_test_review_cycles),
    lifetime_code_review_cycles: nonNegativeInt(loop?.lifetime_code_review_cycles),
    unblock_count: nonNegativeInt(loop?.unblock_count),
  };
}

export function writeReviewLoopCounters(
  task: Record<string, unknown>,
  counters: ReviewLoopCounters,
): void {
  task.review_loop = {
    test_review_retries_used: counters.test_review_retries_used,
    code_review_retries_used: counters.code_review_retries_used,
    lifetime_test_review_cycles: counters.lifetime_test_review_cycles,
    lifetime_code_review_cycles: counters.lifetime_code_review_cycles,
    unblock_count: counters.unblock_count,
  };
  task.quick_fix_loop = { test_review_cycles_used: counters.test_review_retries_used };
}

export function persistLastReviewFeedback(
  task: Record<string, unknown>,
  agent: LastReviewFeedback["agent"],
  packet: ReviewReturnPacket,
  at: string,
  options?: { analysis?: string; packet?: Record<string, unknown> },
): void {
  const findings = packet.findings.map((f) => ({
    severity: f.severity,
    issue: f.issue,
    file: f.file,
    line: f.line,
    evidence: f.evidence,
    recommendation: f.recommendation,
    category: f.category,
    ref: f.ref,
  }));
  const packetRecord =
    options?.packet ?? (JSON.parse(JSON.stringify(packet)) as Record<string, unknown>);
  const analysis =
    options?.analysis ??
    (typeof packet.analysis === "string" && packet.analysis.trim().length > 0
      ? packet.analysis.trim()
      : undefined);

  task.last_review_feedback = {
    agent,
    verdict: packet.verdict,
    findings,
    at,
    packet: packetRecord,
    ...(analysis ? { analysis } : {}),
  } satisfies LastReviewFeedback;
}

/** Read adversarial review state from the task file for orchestrator routing / briefs. */
export function readLastReviewFeedback(task: Record<string, unknown>): LastReviewFeedback | null {
  const raw = task.last_review_feedback;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.agent !== "review-test" && record.agent !== "review-code") {
    return null;
  }
  if (record.verdict !== "clean" && record.verdict !== "issues") {
    return null;
  }
  if (!Array.isArray(record.findings)) {
    return null;
  }
  const packet =
    record.packet && typeof record.packet === "object"
      ? (record.packet as Record<string, unknown>)
      : {
          verdict: record.verdict,
          findings: record.findings,
        };
  return {
    agent: record.agent,
    verdict: record.verdict,
    findings: record.findings as ReviewFinding[],
    at: typeof record.at === "string" ? record.at : "",
    packet,
    ...(typeof record.analysis === "string" && record.analysis.trim().length > 0
      ? { analysis: record.analysis.trim() }
      : {}),
  };
}

export function decideAfterReviewTest(
  counters: ReviewLoopCounters,
  packet: ReviewReturnPacket,
  devConfig: DevHarnessConfig | null | undefined,
  pattern: string,
):
  | {
      nextPhase: "phase-test" | "phase-code";
      bumpTestRetry: boolean;
      retryPolicy: ReturnType<typeof reviewRetryPolicyForAgent>;
    }
  | { blocked: true; reason: string } {
  const retryPolicy = reviewRetryPolicyForAgent(devConfig, pattern, "review-test");

  if (packet.verdict === "clean") {
    return { nextPhase: "phase-code", bumpTestRetry: false, retryPolicy };
  }
  if (!findingsTriggerReviewRetry(packet.findings, retryPolicy.severityGate)) {
    return { nextPhase: "phase-code", bumpTestRetry: false, retryPolicy };
  }
  if (counters.lifetime_test_review_cycles >= retryPolicy.maxLifetimeRetries) {
    return {
      blocked: true,
      reason: `Review-test LIFETIME retry cap reached (${String(retryPolicy.maxLifetimeRetries)} cycles across ${String(counters.unblock_count)} unblock(s); severity_gate=${retryPolicy.severityGate}). \`/dev unblock\` will not lift this — the findings in \`last_review_feedback\` must actually be fixed, or raise orchestration.review_loop.max_lifetime_retries deliberately.`,
    };
  }
  if (counters.test_review_retries_used >= retryPolicy.maxRetries) {
    return {
      blocked: true,
      reason: `Review-test retry cap reached (${String(retryPolicy.maxRetries)}; severity_gate=${retryPolicy.severityGate}). Delegate to accord skill or raise orchestration.review_loop / quick_fix_loop limits.`,
    };
  }
  return { nextPhase: "phase-test", bumpTestRetry: true, retryPolicy };
}

export function decideAfterReviewCode(
  counters: ReviewLoopCounters,
  packet: ReviewReturnPacket,
  devConfig: DevHarnessConfig | null | undefined,
  pattern: string,
):
  | {
      nextPhase: "phase-code";
      bumpCodeRetry: boolean;
      markDone: boolean;
      retryPolicy: ReturnType<typeof reviewRetryPolicyForAgent>;
    }
  | { blocked: true; reason: string } {
  const retryPolicy = reviewRetryPolicyForAgent(devConfig, pattern, "review-code");

  if (packet.verdict === "clean") {
    return { nextPhase: "phase-code", bumpCodeRetry: false, markDone: true, retryPolicy };
  }
  if (!findingsTriggerReviewRetry(packet.findings, retryPolicy.severityGate)) {
    return { nextPhase: "phase-code", bumpCodeRetry: false, markDone: true, retryPolicy };
  }
  if (counters.lifetime_code_review_cycles >= retryPolicy.maxLifetimeRetries) {
    return {
      blocked: true,
      reason: `Review-code LIFETIME retry cap reached (${String(retryPolicy.maxLifetimeRetries)} cycles across ${String(counters.unblock_count)} unblock(s); severity_gate=${retryPolicy.severityGate}). \`/dev unblock\` will not lift this — the findings in \`last_review_feedback\` must actually be fixed, or raise orchestration.review_loop.max_lifetime_retries deliberately.`,
    };
  }
  if (counters.code_review_retries_used >= retryPolicy.maxRetries) {
    return {
      blocked: true,
      reason: `Review-code retry cap reached (${String(retryPolicy.maxRetries)}; severity_gate=${retryPolicy.severityGate}). Delegate to accord skill or raise orchestration.review_loop limits.`,
    };
  }
  return { nextPhase: "phase-code", bumpCodeRetry: true, markDone: false, retryPolicy };
}

const REMEDIATION_AGENT_FOR_REVIEW: Record<LastReviewFeedback["agent"], string> = {
  "review-test": "phase-test",
  "review-code": "phase-code",
  "review-security": "phase-code",
};

/** Appends persisted `last_review_feedback` when the next spawn should address review findings. */
export function appendReviewFeedbackToResumeBrief(
  workItemId: string,
  baseBrief: string,
  dispatchAgent: string,
): string {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return baseBrief;
  }

  // Only the task this spawn targets — the same resolution the implement brief builder uses.
  // Scanning every task_id let a finished task's stale feedback (e.g. advisory review-code
  // findings on task 1) leak into task 2's phase-code / phase-test brief, while the active
  // task's own findings were never shown.
  const candidates = [resolvePrimaryTaskIdForMutation(wi)];

  for (const taskId of candidates) {
    const task = loadTaskFile(workItemId, String(taskId));
    if (!task) {
      continue;
    }
    const feedback = readLastReviewFeedback(task as Record<string, unknown>);
    if (!feedback) {
      continue;
    }
    const hasFindings = feedback.findings.length > 0;
    const hasAnalysis =
      typeof feedback.analysis === "string" && feedback.analysis.trim().length > 0;
    if (!hasFindings && !hasAnalysis) {
      continue;
    }
    const remediate = REMEDIATION_AGENT_FOR_REVIEW[feedback.agent];
    if (remediate !== dispatchAgent) {
      continue;
    }

    const devConfig = loadDevHarnessConfig();
    const policyAgent = feedback.agent === "review-security" ? "review-code" : feedback.agent;
    const retryPolicy = reviewRetryPolicyForAgent(
      devConfig,
      String(wi.pattern ?? "implement"),
      policyAgent,
    );
    const remediation = severityGateRemediationLabel(retryPolicy.severityGate);

    const lines = [
      "",
      "## Prior review feedback (harness)",
      "",
      `Source agent: \`${feedback.agent}\` · verdict: \`${feedback.verdict}\` · recorded: ${feedback.at}`,
      "",
      `Retry policy: \`severity_gate=${retryPolicy.severityGate}\` (max ${String(retryPolicy.maxRetries)} retries). Address **${remediation}** before returning; lower severities are advisory unless the gate is \`none\`.`,
      "",
    ];
    if (dispatchAgent === "phase-test") {
      lines.push(
        "**Required on this retry:** edit the existing `test_files` (and create Step 3 stub skeletons for any unresolved import) — do not start over. Return `review_responses[]` with one entry per finding above (`issue`, `resolution: fixed|disputed`, `note`, plus `ref`/`file` when the finding had them). `disputed` needs concrete evidence; review-test re-checks every entry.",
        "",
      );
    }
    if (hasAnalysis) {
      lines.push("### Analysis (from task file)", "", feedback.analysis ?? "", "");
    }
    lines.push(
      "### Return packet (from task file)",
      "",
      "```json",
      JSON.stringify(
        {
          work_item_id: workItemId,
          task_id: taskId,
          agent: feedback.agent,
          verdict: feedback.verdict,
          ...(hasAnalysis ? { analysis: feedback.analysis } : {}),
          findings: feedback.findings,
          packet: feedback.packet,
        },
        null,
        2,
      ),
      "```",
      "",
    );
    return `${baseBrief}${lines.join("\n")}`;
  }

  return baseBrief;
}

export { DEFAULT_MAX_CRITICAL_REVIEW_RETRIES };
