/**
 * Full-workflow driver — repeated resume until finish-ready, optional finish.
 */

import { planDevResumeOrchestration } from "@clive.shirley/accord-core/orchestration/plan.js";
import { describeImplementingResumeBlocked } from "@clive.shirley/accord-core/orchestration/resolve/primary-task.js";
import type { ResumeOrchestrationResolution } from "@clive.shirley/accord-core/orchestration/types.js";
import { devResumeState } from "@clive.shirley/accord-core/queries/resume-state.js";
import { loadWorkItem } from "@clive.shirley/accord-core/work-items/io.js";
import type { CliContext } from "../context.js";
import type { AgentHarness } from "../harnesses/types.js";
import { cliNotify } from "../notify.js";
import { runFinishCommand } from "./finish.js";
import { runResumeCommand } from "./resume.js";

export type DriveStatus =
  | "ready_for_finish"
  | "finished"
  | "needs_input"
  | "blocked"
  | "spawn_failed"
  | "max_rounds";

export type DriveWorkflowResult = {
  workItemId: string;
  status: DriveStatus;
  rounds: number;
  phase?: string;
  exitCode: number;
  message?: string;
};

export type DriveWorkflowOptions = {
  finish?: boolean;
  maxRounds?: number;
};

const DEFAULT_MAX_DRIVE_ROUNDS = 32;

function currentWorkItemPhase(workItemId: string): string | undefined {
  const state = devResumeState(workItemId);
  if (state.ok) return state.value.phase;
  return loadWorkItem(workItemId)?.phase;
}

function resolutionMessages(resolution: ResumeOrchestrationResolution): string {
  return (resolution.messages ?? []).map((message) => message.text).join("\n");
}

/** True when resume planner has nothing left to spawn before finish. */
export function isReadyForFinishFromResolution(
  workItemId: string,
  resolution: ResumeOrchestrationResolution,
): boolean {
  if (resolution.outcome === "complete") {
    return true;
  }
  if (resolution.outcome === "blocked") {
    const blob = resolutionMessages(resolution);
    if (/run [`']?\/dev finish[`']?|run [`']?accord finish[`']?/i.test(blob)) {
      return true;
    }
    if (/all implementation tasks/i.test(blob)) {
      return true;
    }
    const implementingHint = describeImplementingResumeBlocked(workItemId);
    if (implementingHint && /all implementation tasks/i.test(implementingHint)) {
      return true;
    }
  }
  return false;
}

export function planDriveStatus(
  workItemId: string,
  resolution: ResumeOrchestrationResolution,
): "continue" | "ready_for_finish" | "blocked" {
  if (isReadyForFinishFromResolution(workItemId, resolution)) {
    return "ready_for_finish";
  }
  if (resolution.outcome === "blocked") {
    return "blocked";
  }
  if (resolution.outcome === "complete") {
    return "ready_for_finish";
  }
  return "continue";
}

/**
 * Repeatedly runs resume orchestration until finish-ready, blocked, needs_input, or cap.
 */
export async function runDriveWorkflow(
  ctx: CliContext,
  harness: AgentHarness,
  workItemId: string,
  options: DriveWorkflowOptions = {},
): Promise<DriveWorkflowResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_DRIVE_ROUNDS;
  ctx.state.activeWorkItem = workItemId;

  for (let round = 1; round <= maxRounds; round++) {
    const plan = planDevResumeOrchestration(workItemId, ctx.devConfig);
    const planStatus = planDriveStatus(workItemId, plan);

    if (planStatus === "ready_for_finish") {
      for (const message of plan.messages ?? []) {
        cliNotify(message.level === "warning" ? "warning" : "info", message.text);
      }
      if (options.finish) {
        const finish = await runFinishCommand(ctx, harness, workItemId);
        const phase = currentWorkItemPhase(workItemId);
        return {
          workItemId,
          status: finish.exitCode === 0 ? "finished" : "spawn_failed",
          rounds: round - 1,
          phase,
          exitCode: finish.exitCode,
          message:
            finish.exitCode === 0
              ? "Workflow finished (acceptance + closeout)."
              : "Finish step failed.",
        };
      }
      const phase = currentWorkItemPhase(workItemId);
      return {
        workItemId,
        status: "ready_for_finish",
        rounds: round - 1,
        phase,
        exitCode: 0,
        message: "Implementation complete — run `accord finish` for acceptance verification.",
      };
    }

    if (planStatus === "blocked") {
      const message = resolutionMessages(plan);
      for (const entry of plan.messages ?? []) {
        cliNotify(entry.level === "warning" ? "warning" : "info", entry.text);
      }
      const phase = loadWorkItem(workItemId)?.phase;
      return {
        workItemId,
        status: "blocked",
        rounds: round - 1,
        phase,
        exitCode: 1,
        message: message || "Resume blocked.",
      };
    }

    cliNotify("info", `Drive round ${String(round)}: resuming ${workItemId}…`);
    const resume = await runResumeCommand(ctx, harness, workItemId);

    if (resume.stalledReason === "needs_input") {
      const phase = loadWorkItem(workItemId)?.phase;
      return {
        workItemId,
        status: "needs_input",
        rounds: round,
        phase,
        exitCode: 2,
        message: "Agent returned needs_input — answer questions, then re-run `accord drive`.",
      };
    }

    if (resume.exitCode !== 0) {
      const phase = loadWorkItem(workItemId)?.phase;
      return {
        workItemId,
        status: resume.stalledReason === "repeat_spawn" ? "blocked" : "spawn_failed",
        rounds: round,
        phase,
        exitCode: resume.exitCode,
        message:
          resume.stalledReason === "repeat_spawn"
            ? "Resume stalled (repeated spawn fingerprint)."
            : "Resume spawn failed.",
      };
    }
  }

  const phase = loadWorkItem(workItemId)?.phase;
  return {
    workItemId,
    status: "max_rounds",
    rounds: maxRounds,
    phase,
    exitCode: 1,
    message: `Drive stopped after ${String(maxRounds)} resume round(s). Re-run \`accord drive ${workItemId}\` to continue.`,
  };
}
