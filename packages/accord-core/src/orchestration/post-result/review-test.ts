/**
 * After validated **review-test** return — record findings/rechecks on the v2 task file, then
 * gate the test loop: advance to **phase-code** (open `C` round), retry **phase-test** (open next
 * `T` round, consume a test_review slot), or block at the cap.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { createLogger } from "../../logging.js";
import { bumpRetry, capForKey, decideLoop } from "../../tasks/decide.js";
import { claimRef, clearInFlight, logDecision, recordReview } from "../../tasks/record.js";
import { reviewRetryPolicyForAgent, severityGateRemediationLabel } from "../policy.js";
import { isReviewReturnPacket } from "../review-feedback.js";
import {
  analysisFrom,
  footer,
  type PostResultContext,
  pipelineLabel,
  traceHint,
} from "./pipeline.js";
import { advancePrimaryTask } from "./primary-task.js";

const log = createLogger("orchestration:review-test");

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyReviewTestPostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
  context?: PostResultContext,
): string {
  if (!isReviewReturnPacket(packet)) return "";
  const record = packet as unknown as Record<string, unknown>;

  let out = "";
  const applied = advancePrimaryTask(workItemId, ({ workItem, task, timestamp }) => {
    const label = pipelineLabel(workItem);
    if (!label || task.control.phase !== "review-test") {
      // A silent no-op here would mean a critical finding never consumes a retry slot.
      log.warn(
        `guard no-op for ${workItemId}: task phase=${task.control.phase} wi.pattern=${workItem.pattern} wi.phase=${workItem.phase} — review-test findings NOT applied.`,
      );
      return false;
    }
    const ref = claimRef(task, "review-test");
    if (!ref) return false;

    const policy = reviewRetryPolicyForAgent(devConfig, workItem.pattern, "review-test");
    const rec = recordReview(task, ref, "review-test", record, timestamp, {
      gate: policy.severityGate,
      analysis: analysisFrom(record, context),
    });
    clearInFlight(task, "review-test");

    const cap = capForKey("test_review", devConfig, workItem.pattern);
    const decision = decideLoop(task, "T", cap);
    const raisedLine = [
      rec.raised.length ? `raised ${rec.raised.join(", ")}` : "",
      rec.reraised.length ? `re-raised ${rec.reraised.join(", ")}` : "",
      rec.rechecked.length + rec.implicit.length
        ? `verified/rechecked ${[...rec.rechecked, ...rec.implicit].join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");

    if (decision.kind === "blocked") {
      const decisionRef = logDecision(task, timestamp, {
        result: "blocked",
        note: `${decision.reason}; gating ${decision.gating.join(", ")}`,
      });
      task.control.status = "blocked";
      task.control.blocked = {
        kind: "cap",
        reason: decision.reason,
        ref: decisionRef,
        loop: "T",
        lifetime: decision.lifetime,
      };
      out = footer([
        `**${label}:** review-test retry cap reached — task \`blocked\`.`,
        "",
        `- ${decision.reason}.`,
        `- Blocking findings: ${decision.gating.join(", ")}.`,
        "",
        "Decide each blocker (`--note/--fixed/--accept/--waive`) with `accord unblock`, then `accord resume`.",
        traceHint(task),
      ]);
      return true;
    }

    if (decision.kind === "retry") {
      const counter = bumpRetry(task, "test_review");
      logDecision(
        task,
        timestamp,
        {
          result: "retry",
          note: `${String(decision.gating.length)} gating (${decision.gating.join(", ")}) → phase-test (test_review ${String(counter.used)}/${String(cap.maxRetries)})`,
          next_phase: "phase-test",
        },
        "T",
      );
      task.control.phase = "phase-test";
      task.control.status = "pending";
      out = footer([
        `**${label} (review-test):** ${raisedLine || "recorded"}.`,
        "",
        `- Findings at or above the gate (${severityGateRemediationLabel(policy.severityGate)}) — retrying **phase-test** (${String(counter.used)}/${String(cap.maxRetries)}; gate \`${policy.severityGate}\`).`,
        `- Task phase: \`review-test\` → \`phase-test\` (round ${task.control.round}).`,
        "Run `/dev resume` for **phase-test**; open findings are in the brief.",
      ]);
      return true;
    }

    logDecision(
      task,
      timestamp,
      {
        result: "advance",
        note: `No gating test findings → phase-code${rec.raised.length ? " (advisory findings remain open)" : ""}`,
        next_phase: "phase-code",
      },
      "C",
    );
    task.control.phase = "phase-code";
    task.control.pre_impl_gates = "complete";
    task.control.status = "pending";
    out = footer([
      `**${label} (review-test):** ${raisedLine || "clean"}.`,
      "",
      `- Task phase: \`review-test\` → \`phase-code\` (round ${task.control.round}).`,
      packet.verdict === "issues"
        ? `- No findings at or above the gate (\`${policy.severityGate}\`) — advisory only.`
        : undefined,
      "Run `/dev resume` to continue with **phase-code**.",
    ]);
    return true;
  });

  return applied ? out : "";
}
