/**
 * After validated **review-test** return — for `quick_fix` + `fixing`, advance / block the primary
 * task per the configured quick-fix loop policy.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { quickFixLoopPolicyFromDevConfig } from "../policy.js";
import {
  decideQuickFixAfterReviewPacket,
  type ReviewTestVerdict,
  readQuickFixLoopCounters,
} from "../quick-fix.js";
import { advancePrimaryTask } from "./primary-task.js";

interface ReviewReturnPacket {
  verdict: ReviewTestVerdict;
  findings: Array<{ severity?: string }>;
}

function isReviewReturnPacket(packet: unknown): packet is ReviewReturnPacket {
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

  const policy = quickFixLoopPolicyFromDevConfig(devConfig ?? null);
  let footer: string = "";

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task }) => {
    if (wi.pattern !== "quick_fix" || wi.phase !== "fixing" || !task.quick_fix_contract) {
      return false;
    }

    const counters = readQuickFixLoopCounters(task);
    const decision = decideQuickFixAfterReviewPacket(counters, packet, policy);

    if (!("nextAgent" in decision)) {
      task.status = "blocked";
      footer = [
        "",
        "",
        "**Quick-fix:** test/review loop cap reached for this work item.",
        "",
        `- ${decision.reason}`,
        "",
        "The per-task file `status` is set to `blocked`. Resolve policy or delegate to the accord skill before resuming.",
      ].join("\n");
      return {
        event: {
          type: "quick_fix_loop_blocked",
          reason: decision.reason,
          phase: typeof task.phase === "string" ? task.phase : undefined,
        },
      };
    }

    const next = decision.nextAgent;
    const previousPhase = typeof task.phase === "string" ? task.phase : "";

    if (decision.bumpCycle) {
      const used = counters.test_review_cycles_used + 1;
      task.quick_fix_loop = { test_review_cycles_used: used };
    }

    task.phase = next;
    if (task.status === "blocked") {
      task.status = "pending";
    }

    const cyclesNow = readQuickFixLoopCounters(task).test_review_cycles_used;
    const loopNote = decision.bumpCycle
      ? `Loop counter incremented (used ${String(cyclesNow)}/${String(policy.maxTestReviewLoops)} max).`
      : "";

    footer = [
      "",
      "",
      "**Quick-fix (review-test):** updated primary task file.",
      "",
      `- Task phase: \`${previousPhase || "(none)"}\` → \`${next}\`.`,
      loopNote ? `- ${loopNote}` : "",
      next === "phase-code"
        ? "Run `/dev resume` or continue with **phase-code** when ready."
        : "Address review findings, then run `/dev resume` for **phase-test**.",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      event: {
        type: "quick_fix_review_test_applied",
        verdict: packet.verdict,
        previous_phase: previousPhase,
        next_phase: next,
        bumped_cycle: decision.bumpCycle,
      },
    };
  });

  return applied ? footer : "";
}
