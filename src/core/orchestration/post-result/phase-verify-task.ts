/**
 * After validated **phase-verify-task** return — verify-only plan tasks skip the
 * test → review-test → code → review-code pipeline and complete in one gate pass.
 */

import { advancePrimaryTask } from "./primary-task.js";

interface PhaseVerifyTaskDonePacket {
  status: "done";
  verify_output?: string;
  ac_covered?: string[];
}

function isPhaseVerifyTaskDonePacket(packet: unknown): packet is PhaseVerifyTaskDonePacket {
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
  return true;
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseVerifyTaskPostResult(workItemId: string, packet: unknown): string {
  if (!isPhaseVerifyTaskDonePacket(packet)) {
    return "";
  }

  let footerLines: string[] = [];

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task }) => {
    if (wi.pattern !== "implement" || wi.phase !== "implementing") {
      return false;
    }
    const phase = typeof task.phase === "string" ? task.phase : "";
    if (phase !== "phase-verify-task" && phase !== "phase-test") {
      return false;
    }

    if (typeof packet.verify_output === "string" && packet.verify_output.length > 0) {
      task.verify_output = packet.verify_output;
    }
    if (
      Array.isArray(packet.ac_covered) &&
      packet.ac_covered.every((id) => typeof id === "string")
    ) {
      task.ac_covered = packet.ac_covered;
    }

    const previousPhase = phase;
    task.phase = "phase-verify-task";
    task.status = "done";
    task.pre_impl_gates = "complete";

    footerLines = [
      "**Implement (verify-only task):** verification gate passed.",
      "",
      `- Task phase: \`${previousPhase}\` → \`phase-verify-task\`; \`status\` → \`done\`.`,
      "- No TDD cycle (`red_confirmed` not applicable).",
      "",
      "Run `/dev resume` for the next plan task, or `/dev finish` when all tasks are done.",
    ];

    return {
      event: {
        type: "implement_verify_task_applied",
        previous_phase: previousPhase,
        next_phase: "phase-verify-task",
        status: "done",
      },
    };
  });

  if (!applied) {
    return "";
  }
  return ["", "", ...footerLines].join("\n");
}

export { isPhaseVerifyTaskDonePacket };
