/**
 * Review packet helpers and the resume-brief supplement rendered from the v2 findings ledger.
 */

import { renderFindingsBrief } from "../tasks/render.js";
import { loadTaskV2 } from "../tasks/store.js";
import { loadWorkItem } from "../work-items/io.js";
import { DEFAULT_MAX_CRITICAL_REVIEW_RETRIES, findingsTriggerReviewRetry } from "./policy.js";
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
  ac_id?: string;
  tc_id?: string;
  finding_id?: string;
  also_affects?: string[];
}

export interface ReviewReturnPacket {
  verdict: ReviewTestVerdict;
  findings: ReviewFinding[];
  analysis?: string;
  rechecks?: Array<{ finding_id: string; outcome: string; note?: string; severity?: string }>;
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

/**
 * Appends the findings ledger the next spawn of `dispatchAgent` must answer or recheck
 * (requirement → finding → history), rendered from the primary v2 task file.
 */
export function appendReviewFeedbackToResumeBrief(
  workItemId: string,
  baseBrief: string,
  dispatchAgent: string,
): string {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return baseBrief;
  }
  const task = loadTaskV2(workItemId, resolvePrimaryTaskIdForMutation(wi));
  if (!task) {
    return baseBrief;
  }
  const section = renderFindingsBrief(task, dispatchAgent);
  return section ? `${baseBrief}${section}` : baseBrief;
}

export { DEFAULT_MAX_CRITICAL_REVIEW_RETRIES };
