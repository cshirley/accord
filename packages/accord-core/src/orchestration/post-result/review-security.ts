/**
 * After validated **review-security** return — findings are **advisory** (never gate, never
 * consume a retry) but persist under their requirement and reach phase-code's next brief.
 * Always advances to **review-code**.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { claimRef, clearInFlight, recordReview } from "../../tasks/record.js";
import { isReviewReturnPacket } from "../review-feedback.js";
import { analysisFrom, footer, type PostResultContext, pipelineLabel } from "./pipeline.js";
import { advancePrimaryTask } from "./primary-task.js";

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyReviewSecurityPostResult(
  workItemId: string,
  packet: unknown,
  _devConfig?: DevHarnessConfig | null,
  context?: PostResultContext,
): string {
  if (!isReviewReturnPacket(packet)) return "";
  const record = packet as unknown as Record<string, unknown>;

  let out = "";
  const applied = advancePrimaryTask(workItemId, ({ workItem, task, timestamp }) => {
    const label = pipelineLabel(workItem);
    if (!label || task.control.phase !== "review-security") return false;
    const ref = claimRef(task, "review-security");
    if (!ref) return false;

    const rec = recordReview(task, ref, "review-security", record, timestamp, {
      gate: "block",
      analysis: analysisFrom(record, context),
    });
    clearInFlight(task, "review-security");
    task.control.phase = "review-code";
    task.control.status = "pending";

    out = footer([
      `**${label} (review-security):** recorded \`${ref}\` — **review-code** is required next.`,
      "",
      "- Task phase: `review-security` → `review-code`.",
      packet.verdict === "issues"
        ? `- Verdict: \`issues\` — ${String(rec.raised.length + rec.reraised.length)} advisory finding(s) (${[...rec.raised, ...rec.reraised].join(", ")}); phase-code should respond on its next run.`
        : "- Verdict: `clean`.",
      "",
      "Run `/dev resume` to spawn **review-code**.",
    ]);
    return true;
  });

  return applied ? out : "";
}
