/**
 * After validated **phase-test** return — advances the primary task to **review-test** when the
 * pipeline calls for a pre-impl review pass.
 *
 * Applies to:
 * - `quick_fix` + `fixing`: any strategy except `no_test` (which routes straight to **review-test** at bootstrap).
 * - `implement` + `implementing`: standard pipeline (same done packet shape).
 */

import { loadWorkItem } from "../../work-items/io.js";
import { advancePrimaryTask, resolveActivePrimaryTaskId } from "./primary-task.js";
import { applyPhaseVerifyTaskPostResult } from "./phase-verify-task.js";
import { resolvePlanTaskProfile } from "../../plan/load-task-profile.js";

interface PhaseTestDonePacket {
  status: "done";
  test_files: string[];
  red_confirmed?: boolean;
  test_output?: string;
  ac_covered?: string[];
}

function isPhaseTestImplementDonePacket(packet: unknown): packet is PhaseTestDonePacket {
  if (!packet || typeof packet !== "object") {
    return false;
  }
  const record = packet as Record<string, unknown>;
  if (record.status !== "done") {
    return false;
  }
  if (typeof record.hypothesis_id === "string") {
    return false;
  }
  const files = record.test_files;
  if (!Array.isArray(files) || files.length === 0) {
    return false;
  }
  return files.every((item) => typeof item === "string");
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseTestPostResult(workItemId: string, packet: unknown): string {
  const wi = loadWorkItem(workItemId);
  if (wi) {
    const taskId = resolveActivePrimaryTaskId(wi);
    if (taskId !== null) {
      const resolved = resolvePlanTaskProfile(workItemId, taskId);
      if (resolved?.profile.verifyOnly) {
        const verifyFooter = applyPhaseVerifyTaskPostResult(workItemId, packet);
        if (verifyFooter) {
          return verifyFooter;
        }
      }
    }
  }

  if (!isPhaseTestImplementDonePacket(packet)) {
    return "";
  }

  let footerLines: string[] = [];

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task }) => {
    if (task.phase !== "phase-test") {
      return false;
    }

    let eventType: "quick_fix_phase_test_applied" | "implement_phase_test_applied";
    if (wi.pattern === "quick_fix" && wi.phase === "fixing") {
      const contract = task.quick_fix_contract as { test?: { strategy?: string } } | undefined;
      if (contract?.test?.strategy === "no_test") {
        return false;
      }
      eventType = "quick_fix_phase_test_applied";
      footerLines = [
        "**Quick-fix (phase-test):** persisted `test_files` / `red_confirmed` and set task `phase` to `review-test`.",
        "",
        "Run `/dev resume` to spawn **review-test** (pre-impl) before **phase-code**.",
      ];
    } else if (wi.pattern === "implement" && wi.phase === "implementing") {
      eventType = "implement_phase_test_applied";
      footerLines = [
        "**Implement (phase-test):** persisted `test_files` / `red_confirmed` and set task `phase` to `review-test`.",
        "",
        "Run `/dev resume` to spawn **review-test** (pre-impl) before **phase-code**.",
      ];
    } else {
      return false;
    }

    task.test_files = packet.test_files;
    if (typeof packet.red_confirmed === "boolean") {
      task.red_confirmed = packet.red_confirmed;
    }
    if (typeof packet.test_output === "string" && packet.test_output.length > 0) {
      task.test_output = packet.test_output;
    }
    if (
      Array.isArray(packet.ac_covered) &&
      packet.ac_covered.every((id) => typeof id === "string")
    ) {
      task.ac_covered = packet.ac_covered;
    }

    const previousPhase = typeof task.phase === "string" ? task.phase : "phase-test";
    task.phase = "review-test";

    return {
      event: {
        type: eventType,
        previous_phase: previousPhase,
        next_phase: "review-test",
      },
    };
  });

  if (!applied) {
    return "";
  }
  return ["", "", ...footerLines].join("\n");
}
