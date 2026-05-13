/**
 * After validated **phase-code** return — optional **review-code** step for `implement` pipeline (policy).
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { readJson } from "../../work-items/io.js";
import { implementCodeReviewPolicyFromDevConfig } from "../policy.js";
import { advancePrimaryTask } from "./primary-task.js";

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
 * When the work item is **`implement` + `implementing`**, the primary task is in **`phase-code`**, and
 * policy + plan/packet say an advisory **review-code** pass is required, advances task `phase` → `review-code`.
 *
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseCodePostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
): string {
  if (!isPhaseCodeDonePacket(packet)) {
    return "";
  }

  const policy = implementCodeReviewPolicyFromDevConfig(devConfig);

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task, primaryTaskId }) => {
    if (
      wi.pattern !== "implement" ||
      wi.phase !== "implementing" ||
      !wi.plan ||
      task.phase !== "phase-code"
    ) {
      return false;
    }

    const plan = readJson<Record<string, unknown>>(wi.plan);
    if (!plan) {
      return false;
    }

    const tasks = (plan.tasks as unknown[] | undefined) ?? [];
    const taskRow = tasks.find(
      (t) => String((t as Record<string, unknown>).id) === String(primaryTaskId),
    ) as Record<string, unknown> | undefined;
    const challenge = Boolean(taskRow?.challenge);

    const reviewsRequested =
      typeof packet.reviews_requested === "number" && Number.isFinite(packet.reviews_requested)
        ? Math.max(0, Math.floor(packet.reviews_requested))
        : 0;

    const needReview =
      (policy.codeReviewOnChallenge && challenge) ||
      (policy.codeReviewOnReviewsRequested && reviewsRequested > 0);
    if (!needReview) {
      return false;
    }

    const previousPhase = typeof task.phase === "string" ? task.phase : "phase-code";
    task.phase = "review-code";
    return {
      event: {
        type: "implement_review_code_enqueued",
        previous_phase: previousPhase,
        next_phase: "review-code",
        challenge,
        reviews_requested: reviewsRequested,
      },
    };
  });

  if (!applied) {
    return "";
  }
  return [
    "",
    "",
    "**Implement (phase-code):** policy routed this task to **review-code** before verification.",
    "",
    "Run `/dev resume` to spawn **review-code**, then continue the pipeline when ready.",
  ].join("\n");
}
