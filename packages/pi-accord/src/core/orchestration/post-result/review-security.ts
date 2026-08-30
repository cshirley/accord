/**
 * After validated **review-security** return — persist findings; always advance to **review-code**.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { isReviewReturnPacket, persistLastReviewFeedback } from "../review-feedback.js";
import { advancePrimaryTask } from "./primary-task.js";

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyReviewSecurityPostResult(
  workItemId: string,
  packet: unknown,
  _devConfig?: DevHarnessConfig | null,
): string {
  if (!isReviewReturnPacket(packet)) {
    return "";
  }

  let footer = "";

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task, timestamp }) => {
    const onImplement = wi.pattern === "implement" && wi.phase === "implementing";
    const onQuickFix = wi.pattern === "quick_fix" && wi.phase === "fixing";
    if ((!onImplement && !onQuickFix) || task.phase !== "review-security") {
      return false;
    }

    persistLastReviewFeedback(task, "review-security", packet, timestamp);

    const previousPhase = "review-security";
    task.phase = "review-code";
    task.status = "pending";

    const label = onQuickFix ? "Quick-fix" : "Implement";
    footer = [
      "",
      "",
      `**${label} (review-security):** security review complete — **review-code** is required next.`,
      "",
      `- Task phase: \`${previousPhase}\` → \`review-code\`.`,
      `- Findings: \`last_review_feedback\` on the per-task JSON (advisory unless combined with review-code gate).`,
      packet.verdict === "issues"
        ? "- Verdict: `issues` — address critical items before merge; review-code still runs."
        : "- Verdict: `clean`.",
      "",
      "Run `/dev resume` to spawn **review-code**.",
    ].join("\n");

    return {
      event: {
        type: onQuickFix ? "quick_fix_review_security_applied" : "implement_review_security_applied",
        verdict: packet.verdict,
        previous_phase: previousPhase,
        next_phase: "review-code",
      },
    };
  });

  return applied ? footer : "";
}
