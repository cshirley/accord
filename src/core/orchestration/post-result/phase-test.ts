/**
 * After validated **phase-test** return — advances the primary task to **review-test** when the
 * pipeline calls for a pre-impl review pass.
 *
 * Applies to:
 * - `quick_fix` + `fixing`: primary task carries `quick_fix_contract.test.strategy === "new_red_test"`.
 * - `implement` + `implementing`: standard pipeline (no contract gate; same done packet shape).
 */

import { advancePrimaryTask } from "./primary-task.js";

interface PhaseTestDonePacket {
  status: "done";
  test_files: string[];
  red_confirmed?: boolean;
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
      if (contract?.test?.strategy !== "new_red_test") {
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
