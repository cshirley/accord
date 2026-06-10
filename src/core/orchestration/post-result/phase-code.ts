/**
 * After validated **phase-code** return:
 * - **`implement` + `implementing`** and **`quick_fix` + `fixing`:** always advance to **review-code**
 *   (mandatory post-impl review). Task completion happens after **review-code** post-result.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { devPromoteEvents, type PromotionResult } from "../../work-items/lifecycle.js";
import { advancePrimaryTask } from "./primary-task.js";

function formatPromotionFooter(promotion: PromotionResult): string {
  const lines = ["", "", "**Event promotion (phase-code):**", ""];
  if (promotion.escalations_added > 0) {
    lines.push(`- Promoted ${String(promotion.escalations_added)} escalation(s) to the work item.`);
  }
  if (promotion.deviations_added > 0) {
    lines.push(`- Promoted ${String(promotion.deviations_added)} deviation(s) to the work item.`);
  }
  if (promotion.review_requested) {
    lines.push(
      `- Review requested — agents: ${promotion.review_agents.map((a) => `\`${a}\``).join(", ") || "(none)"}.`,
    );
  }
  if (lines.length === 4) {
    lines.push("- No escalations, deviations, or review requests to promote.");
  }
  return lines.join("\n");
}

interface PhaseCodeDonePacket {
  status: "done";
  reviews_requested?: number;
}

function isPhaseCodeDonePacket(packet: unknown): packet is PhaseCodeDonePacket {
  if (!packet || typeof packet !== "object") {
    return false;
  }
  const record = packet as Record<string, unknown>;
  return record.status === "done";
}

/**
 * When the work item is **`implement` + `implementing`** or **`quick_fix` + `fixing`**, the primary
 * task is in **`phase-code`**, and the packet is a successful done return, advances `phase` → **review-code**.
 *
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseCodePostResult(
  workItemId: string,
  packet: unknown,
  _devConfig?: DevHarnessConfig | null,
): string {
  if (!isPhaseCodeDonePacket(packet)) {
    return "";
  }

  let footer = "";

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task, primaryTaskId }) => {
    if (task.phase !== "phase-code") {
      return false;
    }

    const onQuickFix = wi.pattern === "quick_fix" && wi.phase === "fixing";
    const onImplement = wi.pattern === "implement" && wi.phase === "implementing";
    if (!onQuickFix && !onImplement) {
      return false;
    }

    const previousPhase = typeof task.phase === "string" ? task.phase : "phase-code";
    task.phase = "review-code";
    task.status = "pending";

    const promotion = devPromoteEvents(workItemId, String(primaryTaskId));
    const promotionFooter = formatPromotionFooter(promotion);
    const label = onQuickFix ? "Quick-fix" : "Implement";

    footer = [
      "",
      "",
      `**${label} (phase-code):** implementation complete — **review-code** is required next.`,
      "",
      `- Task phase: \`${previousPhase}\` → \`review-code\`.`,
      "",
      "Run `/dev resume` to spawn **review-code** before marking the task done.",
      promotionFooter,
    ].join("\n");

    return {
      event: {
        type: onQuickFix ? "quick_fix_review_code_enqueued" : "implement_review_code_enqueued",
        previous_phase: previousPhase,
        next_phase: "review-code",
        promotion,
      },
    };
  });

  return applied ? footer : "";
}
