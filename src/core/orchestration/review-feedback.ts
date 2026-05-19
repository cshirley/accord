/**
 * Review feedback persistence, critical-issue retry policy, and resume brief supplements.
 */

import type { DevHarnessConfig } from "../config/types.js";
import { loadTaskFile, loadWorkItem } from "../work-items/io.js";
import {
  DEFAULT_MAX_CRITICAL_REVIEW_RETRIES,
  criticalReviewLoopPolicyFromDevConfig,
} from "./policy.js";
import { maxFindingSeverityRank } from "./quick-fix.js";

export type ReviewTestVerdict = "clean" | "issues";

export interface ReviewFinding {
  severity?: string;
  issue?: string;
  file?: string;
  line?: number;
  evidence?: string;
  recommendation?: string;
}

export interface ReviewReturnPacket {
  verdict: ReviewTestVerdict;
  findings: ReviewFinding[];
  /** Optional structured summary; prose may also be stored separately as `analysis`. */
  analysis?: string;
}

export interface LastReviewFeedback {
  agent: "review-test" | "review-code";
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
}

const SEVERITY_CRITICAL_RANK = 3;

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

export function hasCriticalFindings(findings: ReadonlyArray<ReviewFinding>): boolean {
  return maxFindingSeverityRank(findings) >= SEVERITY_CRITICAL_RANK;
}

export function readReviewLoopCounters(task: Record<string, unknown>): ReviewLoopCounters {
  const loop = task.review_loop as
    | { test_review_retries_used?: unknown; code_review_retries_used?: unknown }
    | undefined;
  const legacy = task.quick_fix_loop as { test_review_cycles_used?: unknown } | undefined;

  const testRaw = loop?.test_review_retries_used ?? legacy?.test_review_cycles_used;
  const codeRaw = loop?.code_review_retries_used;

  const test =
    typeof testRaw === "number" && Number.isFinite(testRaw) ? Math.max(0, Math.floor(testRaw)) : 0;
  const code =
    typeof codeRaw === "number" && Number.isFinite(codeRaw) ? Math.max(0, Math.floor(codeRaw)) : 0;

  return { test_review_retries_used: test, code_review_retries_used: code };
}

export function writeReviewLoopCounters(
  task: Record<string, unknown>,
  counters: ReviewLoopCounters,
): void {
  task.review_loop = {
    test_review_retries_used: counters.test_review_retries_used,
    code_review_retries_used: counters.code_review_retries_used,
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
  }));
  const packetRecord =
    options?.packet ??
    (JSON.parse(JSON.stringify(packet)) as Record<string, unknown>);
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
export function readLastReviewFeedback(
  task: Record<string, unknown>,
): LastReviewFeedback | null {
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
):
  | { nextPhase: "phase-test" | "phase-code"; bumpTestRetry: boolean }
  | { blocked: true; reason: string } {
  const policy = criticalReviewLoopPolicyFromDevConfig(devConfig);

  if (packet.verdict === "clean") {
    return { nextPhase: "phase-code", bumpTestRetry: false };
  }
  if (!hasCriticalFindings(packet.findings)) {
    return { nextPhase: "phase-code", bumpTestRetry: false };
  }
  if (counters.test_review_retries_used >= policy.maxCriticalRetries) {
    return {
      blocked: true,
      reason: `Review-test critical-issue retry cap reached (${String(policy.maxCriticalRetries)}). Delegate to accord skill or raise orchestration.review_loop.max_critical_retries.`,
    };
  }
  return { nextPhase: "phase-test", bumpTestRetry: true };
}

export function decideAfterReviewCode(
  counters: ReviewLoopCounters,
  packet: ReviewReturnPacket,
  devConfig: DevHarnessConfig | null | undefined,
):
  | { nextPhase: "phase-code"; bumpCodeRetry: boolean; markDone: boolean }
  | { blocked: true; reason: string } {
  const policy = criticalReviewLoopPolicyFromDevConfig(devConfig);

  if (packet.verdict === "clean") {
    return { nextPhase: "phase-code", bumpCodeRetry: false, markDone: true };
  }
  if (!hasCriticalFindings(packet.findings)) {
    return { nextPhase: "phase-code", bumpCodeRetry: false, markDone: true };
  }
  if (counters.code_review_retries_used >= policy.maxCriticalRetries) {
    return {
      blocked: true,
      reason: `Review-code critical-issue retry cap reached (${String(policy.maxCriticalRetries)}). Delegate to accord skill or raise orchestration.review_loop.max_critical_retries.`,
    };
  }
  return { nextPhase: "phase-code", bumpCodeRetry: true, markDone: false };
}

const REMEDIATION_AGENT_FOR_REVIEW: Record<LastReviewFeedback["agent"], string> = {
  "review-test": "phase-test",
  "review-code": "phase-code",
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

  const taskIds = [...(wi.task_ids ?? [])].sort((a, b) => a - b);
  const candidates = taskIds.length > 0 ? taskIds : [1];

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

    const lines = [
      "",
      "## Prior review feedback (harness)",
      "",
      `Source agent: \`${feedback.agent}\` · verdict: \`${feedback.verdict}\` · recorded: ${feedback.at}`,
      "",
      "Address **critical** items before returning. Non-critical findings are advisory.",
      "",
    ];
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
