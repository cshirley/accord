/**
 * After validated **review-test** return — persist findings on the task file, then advance
 * per pattern: critical findings may retry **phase-test** (cap from `orchestration.review_loop`).
 */

import type { DevHarnessConfig } from "../../config/types.js";
import {
  decideAfterReviewTest,
  isReviewReturnPacket,
  persistLastReviewFeedback,
  readReviewLoopCounters,
  writeReviewLoopCounters,
} from "../review-feedback.js";
import { advancePrimaryTask } from "./primary-task.js";

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyReviewTestPostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
): string {
  if (!isReviewReturnPacket(packet)) {
    return "";
  }

  let footer = "";

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task, timestamp }) => {
    const onQuickFix = wi.pattern === "quick_fix" && wi.phase === "fixing" && task.quick_fix_contract;
    const onImplement = wi.pattern === "implement" && wi.phase === "implementing";
    if ((!onQuickFix && !onImplement) || task.phase !== "review-test") {
      return false;
    }

    persistLastReviewFeedback(task, "review-test", packet, timestamp);

    const counters = readReviewLoopCounters(task);
    const decision = decideAfterReviewTest(counters, packet, devConfig);

    if ("blocked" in decision) {
      task.status = "blocked";
      const label = onQuickFix ? "Quick-fix" : "Implement";
      footer = [
        "",
        "",
        `**${label}:** review-test critical-issue retry cap reached.`,
        "",
        `- ${decision.reason}`,
        "",
        "Findings are on the task file under `last_review_feedback`. Task `status` is `blocked`.",
      ].join("\n");
      return {
        event: {
          type: onQuickFix ? "quick_fix_loop_blocked" : "implement_review_test_blocked",
          reason: decision.reason,
          phase: "review-test",
        },
      };
    }

    const previousPhase = "review-test";
    const next = decision.nextPhase;

    if (decision.bumpTestRetry) {
      const used = counters.test_review_retries_used + 1;
      writeReviewLoopCounters(task, {
        ...counters,
        test_review_retries_used: used,
      });
    }

    task.phase = next;
    if (next === "phase-code") {
      task.pre_impl_gates = "complete";
    }
    if (task.status === "blocked") {
      task.status = "pending";
    }

    const label = onQuickFix ? "Quick-fix" : "Implement";
    const loopNote = decision.bumpTestRetry
      ? `Critical findings — retrying **phase-test** (used ${String(readReviewLoopCounters(task).test_review_retries_used)} retry slot(s)).`
      : packet.verdict === "issues"
        ? "No critical findings — continuing to **phase-code** (advisory issues only)."
        : "";

    footer = [
      "",
      "",
      `**${label} (review-test):** persisted findings on task file; updated task phase.`,
      "",
      `- Task phase: \`${previousPhase}\` → \`${next}\`.`,
      `- Findings: \`last_review_feedback\` on the per-task JSON.`,
      loopNote ? `- ${loopNote}` : "",
      next === "phase-code"
        ? "Run `/dev resume` to continue with **phase-code**."
        : "Run `/dev resume` for **phase-test** with prior feedback in the brief.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      event: {
        type: onQuickFix ? "quick_fix_review_test_applied" : "implement_review_test_applied",
        verdict: packet.verdict,
        previous_phase: previousPhase,
        next_phase: next,
        bumped_cycle: decision.bumpTestRetry,
        critical_retry: decision.bumpTestRetry,
      },
    };
  });

  return applied ? footer : "";
}
