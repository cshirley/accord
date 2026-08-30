/**
 * After validated **phase-code** return:
 * - **`implement` + `implementing`** and **`quick_fix` + `fixing`:** advance to **review-code**
 *   (via **review-security** when paths are security-sensitive). Task completion happens after
 *   **review-code** post-result.
 * - If `phase-code` reported `test_issues_emitted` or modified test files, route back to
 *   **phase-test** and reset `pre_impl_gates` (RGR — tests are never owned by phase-code).
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { devPromoteEvents, type PromotionResult } from "../../work-items/lifecycle.js";
import { nextPhaseAfterPhaseCode, phaseCodeMustRespawnPhaseTest } from "../review-paths.js";
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
  files_changed?: string[];
  test_issues_emitted?: number;
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
 * task is in **`phase-code`**, and the packet is a successful done return, advances `phase` →
 * **phase-test** (test boundary violation), **review-security** (security-sensitive paths),
 * or **review-code** (default).
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
    const filesChanged = Array.isArray(packet.files_changed)
      ? packet.files_changed.filter((f): f is string => typeof f === "string")
      : [];
    const respawnPhaseTest = phaseCodeMustRespawnPhaseTest(filesChanged, {
      testIssuesEmitted: packet.test_issues_emitted,
    });
    const nextPhase = nextPhaseAfterPhaseCode(filesChanged, {
      testIssuesEmitted: packet.test_issues_emitted,
    });
    if (respawnPhaseTest) {
      task.pre_impl_gates = "pending";
    }
    task.phase = nextPhase;
    task.status = "pending";

    const promotion = devPromoteEvents(workItemId, String(primaryTaskId));
    const promotionFooter = formatPromotionFooter(promotion);
    const label = onQuickFix ? "Quick-fix" : "Implement";

    const rgrNote = respawnPhaseTest
      ? [
          "",
          "- **RGR:** `phase-code` must not modify tests. Re-run **phase-test** → **review-test** → **phase-code**.",
          packet.test_issues_emitted
            ? `  (${String(packet.test_issues_emitted)} test_issue event(s) reported.)`
            : "  (Test paths appeared in `files_changed`.)",
        ].join("\n")
      : "";

    footer = [
      "",
      "",
      `**${label} (phase-code):** implementation complete — **${nextPhase}** is required next.`,
      "",
      `- Task phase: \`${previousPhase}\` → \`${nextPhase}\`.`,
      rgrNote,
      "",
      `Run \`/dev resume\` to spawn **${nextPhase}** before marking the task done.`,
      promotionFooter,
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    return {
      event: {
        type: onQuickFix ? "quick_fix_review_code_enqueued" : "implement_review_code_enqueued",
        previous_phase: previousPhase,
        next_phase: nextPhase,
        promotion,
      },
    };
  });

  return applied ? footer : "";
}
