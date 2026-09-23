/**
 * After validated **review-code** return — persist findings on the task file; critical
 * findings retry **phase-code** until `orchestration.review_loop.max_critical_retries`.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { severityGateRemediationLabel } from "../policy.js";
import {
  decideAfterReviewCode,
  isReviewReturnPacket,
  persistLastReviewFeedback,
  readReviewLoopCounters,
  writeReviewLoopCounters,
} from "../review-feedback.js";
import { advancePrimaryTask } from "./primary-task.js";

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyReviewCodePostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
): string {
  if (!isReviewReturnPacket(packet)) {
    return "";
  }

  let footer = "";

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task, timestamp }) => {
    const onImplement = wi.pattern === "implement" && wi.phase === "implementing";
    const onQuickFix = wi.pattern === "quick_fix" && wi.phase === "fixing";
    if ((!onImplement && !onQuickFix) || task.phase !== "review-code") {
      return false;
    }

    persistLastReviewFeedback(task, "review-code", packet, timestamp);

    const counters = readReviewLoopCounters(task);
    const decision = decideAfterReviewCode(counters, packet, devConfig, wi.pattern);

    if ("blocked" in decision) {
      task.status = "blocked";
      const label = onQuickFix ? "Quick-fix" : "Implement";
      footer = [
        "",
        "",
        `**${label}:** review-code critical-issue retry cap reached.`,
        "",
        `- ${decision.reason}`,
        "",
        "Findings are on the task file under `last_review_feedback`. Task `status` is `blocked`.",
      ].join("\n");
      return {
        event: {
          type: onQuickFix ? "quick_fix_review_code_blocked" : "implement_review_code_blocked",
          reason: decision.reason,
          phase: "review-code",
        },
      };
    }

    const previousPhase = "review-code";

    if (decision.bumpCodeRetry) {
      const used = counters.code_review_retries_used + 1;
      writeReviewLoopCounters(task, {
        ...counters,
        code_review_retries_used: used,
      });
      task.phase = "phase-code";
      task.status = "pending";

      const label = onQuickFix ? "Quick-fix" : "Implement";
      const gateLabel = severityGateRemediationLabel(decision.retryPolicy.severityGate);
      footer = [
        "",
        "",
        `**${label} (review-code):** ${gateLabel} — retrying **phase-code** (gate \`${decision.retryPolicy.severityGate}\`).`,
        "",
        `- Task phase: \`${previousPhase}\` → \`phase-code\`.`,
        `- Findings: \`last_review_feedback\` on the per-task JSON.`,
        `- Used ${String(readReviewLoopCounters(task).code_review_retries_used)} / ${String(decision.retryPolicy.maxRetries)} code-review retry slot(s).`,
        "",
        "Run `/dev resume` for **phase-code**; prior feedback is appended to the harness brief.",
      ].join("\n");

      return {
        event: {
          type: onQuickFix ? "quick_fix_review_code_applied" : "implement_review_code_applied",
          verdict: packet.verdict,
          previous_phase: previousPhase,
          next_phase: "phase-code",
          bumped_cycle: true,
          critical_retry: true,
        },
      };
    }

    task.status = "done";
    const label = onQuickFix ? "Quick-fix" : "Implement";
    footer = [
      "",
      "",
      `**${label} (review-code):** code review complete.`,
      "",
      `- Task phase: \`${previousPhase}\` (unchanged); \`status\` → \`done\`.`,
      `- Findings: \`last_review_feedback\` on the per-task JSON.`,
      packet.verdict === "issues"
        ? `- Verdict: \`issues\` below repo gate (\`${decision.retryPolicy.severityGate}\`) — advisory only.`
        : "- Verdict: `clean`.",
      "",
      onQuickFix
        ? "Run `/dev finish` or report when verification is complete."
        : "Run `/dev resume` for the next plan task, or `/dev finish` when all tasks are done.",
    ].join("\n");

    return {
      event: {
        type: onQuickFix ? "quick_fix_review_code_applied" : "implement_review_code_applied",
        verdict: packet.verdict,
        previous_phase: previousPhase,
        status: "done",
        critical_retry: false,
      },
    };
  });

  return applied ? footer : "";
}
