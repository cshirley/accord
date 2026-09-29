/**
 * After validated **phase-verify-task** return — per-AC `evidence[]`.
 *
 * - Every AC passes → task `done`; requirements `satisfied`.
 * - Any AC fails → gating V finding under that AC; next `C` round (phase-code → review-security →
 *   review-code) then re-verify. Each bounce consumes `retries.verify`; at the cap the task blocks
 *   for a human.
 * - Verify-only plan tasks use the same handler (their initial round is `V1`).
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { bumpRetry, capForKey, decideLoop } from "../../tasks/decide.js";
import { claimRef, clearInFlight, logDecision, recordVerify } from "../../tasks/record.js";
import { sidecarName, writeTaskSidecar } from "../../tasks/store.js";
import { detectTestRunnerCrash } from "../test-crash-detection.js";
import {
  analysisFrom,
  footer,
  type PostResultContext,
  pipelineLabel,
  traceHint,
} from "./pipeline.js";
import { advancePrimaryTask } from "./primary-task.js";

function isPhaseVerifyTaskDonePacket(packet: unknown): packet is Record<string, unknown> {
  if (!packet || typeof packet !== "object") return false;
  const record = packet as Record<string, unknown>;
  if (record.status !== "done" && record.status !== "failed") return false;
  return typeof record.hypothesis_id !== "string";
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseVerifyTaskPostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
  context?: PostResultContext,
): string {
  if (!isPhaseVerifyTaskDonePacket(packet)) return "";

  let out = "";
  const applied = advancePrimaryTask(workItemId, ({ workItem, task, timestamp }) => {
    const label = pipelineLabel(workItem);
    if (!label) return false;
    const phase = task.control.phase;
    if (phase !== "phase-verify-task" && phase !== "phase-test") return false;
    const ref = claimRef(task, "phase-verify-task");
    if (!ref) return false;

    const verifyOutput = typeof packet.verify_output === "string" ? packet.verify_output : "";
    if (verifyOutput) {
      writeTaskSidecar(workItemId, task.task, sidecarName(ref, "output.txt"), verifyOutput);
    }

    // A crashed verify run masquerading as a pass would ship straight through.
    const crash = detectTestRunnerCrash(verifyOutput);
    if (crash) {
      const decisionRef = logDecision(task, timestamp, {
        result: "blocked",
        note: `Verify run crashed: ${crash.reason} (matched \`${crash.matched}\`)`,
      });
      clearInFlight(task, "phase-verify-task");
      task.control.phase = "phase-verify-task";
      task.control.status = "blocked";
      task.control.blocked = { kind: "crash", reason: crash.reason, ref: decisionRef };
      out = footer([
        `**${label} (phase-verify-task):** test-runner CRASH detected — not a valid pass signal.`,
        "",
        `- ${crash.reason}. Matched: \`${crash.matched}\``,
        "- Task `blocked`; NOT marked `done`.",
        "",
        "Fix the crash, re-run, then `accord unblock` and `accord resume`.",
        traceHint(task),
      ]);
      return true;
    }

    const rec = recordVerify(task, ref, packet, timestamp, {
      analysis: analysisFrom(packet, context),
    });
    clearInFlight(task, "phase-verify-task");
    task.control.phase = "phase-verify-task";
    task.control.pre_impl_gates = "complete";

    const cap = capForKey("verify", devConfig, workItem.pattern);
    const decision = decideLoop(task, "V", cap);

    if (decision.kind === "blocked") {
      const decisionRef = logDecision(task, timestamp, {
        result: "blocked",
        note: `${decision.reason}; failing ${rec.failed.join(", ")}`,
      });
      task.control.status = "blocked";
      task.control.blocked = {
        kind: "cap",
        reason: decision.reason,
        ref: decisionRef,
        loop: "V",
        lifetime: decision.lifetime,
      };
      out = footer([
        `**${label} (phase-verify-task):** verify retry cap reached — task \`blocked\`.`,
        "",
        `- ${decision.reason}.`,
        `- Failing: ${rec.failed.join(", ")} (findings ${decision.gating.join(", ")}).`,
        "",
        "Fix, `--waive AC-n`, or `--accept` with `accord unblock`, then `accord resume`.",
        traceHint(task),
      ]);
      return true;
    }

    if (decision.kind === "retry") {
      const counter = bumpRetry(task, "verify");
      logDecision(
        task,
        timestamp,
        {
          result: "retry",
          note: `Verification failed for ${rec.failed.join(", ")} (${decision.gating.join(", ")}) → phase-code (verify ${String(counter.used)}/${String(cap.maxRetries)})`,
          next_phase: "phase-code",
        },
        "C",
      );
      task.control.phase = "phase-code";
      task.control.status = "pending";
      out = footer([
        `**${label} (phase-verify-task):** verification failed for ${rec.failed.join(", ")}.`,
        "",
        `- Findings ${decision.gating.join(", ")} → **phase-code** (round ${task.control.round}; verify ${String(counter.used)}/${String(cap.maxRetries)}).`,
        "Run `/dev resume` for **phase-code**; review-code and re-verification follow.",
      ]);
      return true;
    }

    logDecision(task, timestamp, {
      result: "done",
      note: `All ACs verified (${rec.passed.join(", ") || "no ACs"})`,
    });
    task.control.status = "done";
    out = footer([
      `**${label} (phase-verify-task):** verification passed; \`status\` → \`done\`.`,
      rec.passed.length ? `- Satisfied: ${rec.passed.join(", ")}.` : undefined,
      "",
      label === "Quick-fix"
        ? "Run `/dev finish` when ready."
        : "Run `/dev resume` for the next plan task, or `/dev finish` when all tasks are done.",
    ]);
    return true;
  });

  return applied ? out : "";
}

export { isPhaseVerifyTaskDonePacket };
