/**
 * After validated **phase-code** return:
 * - records changes / review responses on the v2 task file
 * - RGR: `test_issue` events or test files in the change set become T-loop findings and route back
 *   to **phase-test** (new `T` round, `pre_impl_gates` reset, `rgr` retry consumed)
 * - otherwise advances to **review-security** (sensitive paths) or **review-code**
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { bumpRetry, capCheck, capForKey } from "../../tasks/decide.js";
import { applyReviewFindings } from "../../tasks/model.js";
import { claimRef, clearInFlight, logDecision, recordPhaseCode } from "../../tasks/record.js";
import { devPromoteEvents, type PromotionResult } from "../../work-items/lifecycle.js";
import { isTestFilePath, nextPhaseAfterPhaseCode } from "../review-paths.js";
import {
  analysisFrom,
  footer,
  type PostResultContext,
  pipelineLabel,
  traceHint,
} from "./pipeline.js";
import { advancePrimaryTask } from "./primary-task.js";

function formatPromotionFooter(promotion: PromotionResult): string | undefined {
  const lines: string[] = [];
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
  return lines.length ? ["", "**Event promotion (phase-code):**", ...lines].join("\n") : undefined;
}

function isPhaseCodeDonePacket(packet: unknown): packet is Record<string, unknown> {
  return (
    !!packet && typeof packet === "object" && (packet as Record<string, unknown>).status === "done"
  );
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseCodePostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
  context?: PostResultContext,
): string {
  if (!isPhaseCodeDonePacket(packet)) return "";

  let out = "";
  const applied = advancePrimaryTask(workItemId, ({ workItem, task, primaryTaskId, timestamp }) => {
    if (task.control.phase !== "phase-code") return false;
    const label = pipelineLabel(workItem);
    if (!label) return false;
    const ref = claimRef(task, "phase-code");
    if (!ref) return false;

    const rec = recordPhaseCode(task, ref, packet, timestamp, {
      analysis: analysisFrom(packet, context),
      isTestFile: isTestFilePath,
    });
    const reportedIssues =
      typeof packet.test_issues_emitted === "number" ? packet.test_issues_emitted : 0;
    if (reportedIssues > 0 && rec.testIssueFindings.length === 0) {
      const raise = applyReviewFindings(
        task,
        [
          {
            severity: "critical",
            category: "test_issue",
            issue: `phase-code reported ${String(reportedIssues)} test issue(s) without details`,
          },
        ],
        { by: ref, loop: "T", gate: "none" },
      );
      rec.testIssueFindings.push(...raise.raised, ...raise.reraised);
    }
    clearInFlight(task, "phase-code");

    const promotion = devPromoteEvents(workItemId, String(primaryTaskId), task);
    const promotionFooter = formatPromotionFooter(promotion);

    if (rec.testIssueFindings.length > 0) {
      // RGR never touches the review retry counters, so it has its own cap.
      const cap = capForKey("rgr", devConfig, workItem.pattern);
      const check = capCheck("rgr", task.control.retries.rgr, cap, task.control.retries.unblocks);
      if (!check.ok) {
        const decisionRef = logDecision(task, timestamp, {
          result: "blocked",
          note: `${check.reason}; test issues ${rec.testIssueFindings.join(", ")}`,
        });
        task.control.status = "blocked";
        task.control.blocked = {
          kind: "cap",
          reason: check.reason,
          ref: decisionRef,
          loop: "rgr",
          lifetime: check.lifetime,
        };
        out = footer([
          `**${label} (phase-code):** RGR respawn cap reached — task \`blocked\`.`,
          "",
          `- ${check.reason}.`,
          `- Test issues: ${rec.testIssueFindings.join(", ")}.`,
          traceHint(task),
          promotionFooter,
        ]);
        return true;
      }
      const counter = bumpRetry(task, "rgr");
      logDecision(
        task,
        timestamp,
        {
          result: "retry",
          note: `RGR: test issues ${rec.testIssueFindings.join(", ")} → phase-test (rgr ${String(counter.used)}/${String(cap.maxRetries)})`,
          next_phase: "phase-test",
        },
        "T",
      );
      task.control.phase = "phase-test";
      task.control.pre_impl_gates = "pending";
      task.control.status = "pending";
      out = footer([
        `**${label} (phase-code):** recorded \`${ref}\`.`,
        "",
        "- **RGR:** `phase-code` must not modify tests. Re-run **phase-test** → **review-test** → **phase-code**.",
        `  Test issues: ${rec.testIssueFindings.join(", ")} (rgr ${String(counter.used)}/${String(cap.maxRetries)}).`,
        "",
        "Run `/dev resume` to spawn **phase-test**.",
        promotionFooter,
      ]);
      return true;
    }

    const nextPhase = nextPhaseAfterPhaseCode(rec.filesChanged);
    task.control.phase = nextPhase === "phase-test" ? "review-code" : nextPhase;
    task.control.status = "pending";
    out = footer([
      `**${label} (phase-code):** recorded \`${ref}\` — **${task.control.phase}** is required next.`,
      rec.responded.length ? `- Responded to: ${rec.responded.join(", ")}` : undefined,
      "",
      `Run \`/dev resume\` to spawn **${task.control.phase}** before marking the task done.`,
      promotionFooter,
    ]);
    return true;
  });

  return applied ? out : "";
}
