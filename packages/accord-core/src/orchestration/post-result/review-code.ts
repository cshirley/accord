/**
 * After validated **review-code** return — record findings/rechecks, then gate the code loop:
 * advance to **phase-verify-task** (open `V` round; or `done` when the verify loop is disabled),
 * retry **phase-code** (open next `C` round, consume a code_review slot), or block at the cap.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { bumpRetry, capForKey, decideLoop } from "../../tasks/decide.js";
import { claimRef, clearInFlight, logDecision, recordReview } from "../../tasks/record.js";
import {
  reviewRetryPolicyForAgent,
  severityGateRemediationLabel,
  verifyLoopPolicyFromDevConfig,
} from "../policy.js";
import { isReviewReturnPacket } from "../review-feedback.js";
import {
  analysisFrom,
  footer,
  type PostResultContext,
  pipelineLabel,
  traceHint,
} from "./pipeline.js";
import { advancePrimaryTask } from "./primary-task.js";

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyReviewCodePostResult(
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
    if (!label || task.control.phase !== "review-code") return false;
    const ref = claimRef(task, "review-code");
    if (!ref) return false;

    const policy = reviewRetryPolicyForAgent(devConfig, workItem.pattern, "review-code");
    const rec = recordReview(task, ref, "review-code", record, timestamp, {
      gate: policy.severityGate,
      analysis: analysisFrom(record, context),
    });
    clearInFlight(task, "review-code");

    const cap = capForKey("code_review", devConfig, workItem.pattern);
    const decision = decideLoop(task, "C", cap);

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
        loop: "C",
        lifetime: decision.lifetime,
      };
      out = footer([
        `**${label}:** review-code retry cap reached — task \`blocked\`.`,
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
      const counter = bumpRetry(task, "code_review");
      logDecision(
        task,
        timestamp,
        {
          result: "retry",
          note: `${String(decision.gating.length)} gating (${decision.gating.join(", ")}) → phase-code (code_review ${String(counter.used)}/${String(cap.maxRetries)})`,
          next_phase: "phase-code",
        },
        "C",
      );
      task.control.phase = "phase-code";
      task.control.status = "pending";
      out = footer([
        `**${label} (review-code):** ${severityGateRemediationLabel(policy.severityGate)} — retrying **phase-code** (${String(counter.used)}/${String(cap.maxRetries)}; gate \`${policy.severityGate}\`).`,
        "",
        `- Gating findings: ${decision.gating.join(", ")}.`,
        `- Task phase: \`review-code\` → \`phase-code\` (round ${task.control.round}).`,
        "Run `/dev resume` for **phase-code**; open findings are in the brief.",
      ]);
      return true;
    }

    const verify = verifyLoopPolicyFromDevConfig(devConfig);
    const advisory = packet.verdict === "issues" ? " (advisory findings remain open)" : "";
    if (verify.enabled) {
      logDecision(
        task,
        timestamp,
        {
          result: "advance",
          note: `No gating code findings → phase-verify-task${advisory}`,
          next_phase: "phase-verify-task",
        },
        "V",
      );
      task.control.phase = "phase-verify-task";
      task.control.status = "pending";
      out = footer([
        `**${label} (review-code):** ${rec.raised.length ? `raised ${rec.raised.join(", ")} (below gate)` : "clean"}.`,
        "",
        `- Task phase: \`review-code\` → \`phase-verify-task\` (round ${task.control.round}).`,
        "Run `/dev resume` to spawn **phase-verify-task** (per-AC verification evidence).",
      ]);
      return true;
    }

    logDecision(task, timestamp, {
      result: "done",
      note: `No gating code findings; verify loop disabled → done${advisory}`,
    });
    task.control.status = "done";
    out = footer([
      `**${label} (review-code):** code review complete; \`status\` → \`done\`.`,
      packet.verdict === "issues"
        ? `- Verdict: \`issues\` below repo gate (\`${policy.severityGate}\`) — advisory only.`
        : "- Verdict: `clean`.",
      "",
      label === "Quick-fix"
        ? "Run `/dev finish` or report when verification is complete."
        : "Run `/dev resume` for the next plan task, or `/dev finish` when all tasks are done.",
    ]);
    return true;
  });

  return applied ? out : "";
}
