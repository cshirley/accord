/**
 * Force-spawn a registry agent for explicit `/dev <subcommand> <ID>` invocations
 * (align, spec, plan, check, gaps, …) without inferring from coarse WI phase alone.
 */

import { agentRequiresConfig, getAgentMeta } from "../../agents/registry.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { devResumeState } from "../../queries/resume-state.js";
import { isWorkItemPattern } from "../phase-coarse-routing.js";
import { buildImplementSpawnTaskBrief } from "../../briefing/task-requirements.js";
import { appendReviewFeedbackToResumeBrief } from "../review-feedback.js";
import type { ResumeOrchestrationResolution } from "../types.js";
import { buildResumeTaskBrief } from "./resume.js";

export interface ForcedAgentOrchestrationOptions {
  /** `/dev` subcommand that triggered the spawn (shown in the task brief). */
  subcommand?: string;
  /** Extra lines appended to the outbound task body. */
  taskSuffix?: string;
}

export function resolveForcedAgentOrchestration(
  workItemId: string,
  agentId: string,
  devConfig: DevHarnessConfig | null,
  options: ForcedAgentOrchestrationOptions = {},
): ResumeOrchestrationResolution {
  const wiState = devResumeState(workItemId);
  if (!wiState.ok) {
    return {
      outcome: "blocked",
      messages: [{ level: "warning", text: wiState.error }],
    };
  }

  const state = wiState.value;
  if (!isWorkItemPattern(state.pattern)) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: `Unknown work item pattern "${state.pattern}" — cannot run ${agentId}.`,
        },
      ],
    };
  }

  if (agentRequiresConfig(agentId) && !devConfig) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: "No ACCORD config found. Run /dev init to configure before spawning phase agents.",
        },
      ],
    };
  }

  if (!getAgentMeta(agentId)) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: `Agent "${agentId}" is not registered in the harness.`,
        },
      ],
    };
  }

  const subcommandLine = options.subcommand
    ? `subcommand: /dev ${options.subcommand} ${workItemId}`
    : `forced_agent: ${agentId}`;

  const baseTask =
    buildImplementSpawnTaskBrief({
      workItemId: state.id,
      phase: state.phase,
      title: state.title,
      pattern: state.pattern,
      variant: state.variant,
      dispatchAgent: agentId,
      devConfig,
    }) ??
    buildResumeTaskBrief({
      workItemId: state.id,
      phase: state.phase,
      title: state.title,
      pattern: state.pattern,
      variant: state.variant,
      dispatchAgent: agentId,
    });

  const suffix = options.taskSuffix?.trim();
  const task = appendReviewFeedbackToResumeBrief(
    workItemId,
    suffix ? `${baseTask}\n\n${subcommandLine}\n\n${suffix}` : `${baseTask}\n\n${subcommandLine}`,
    agentId,
  );

  return {
    outcome: "spawn",
    workItemId: state.id,
    agent: agentId,
    task,
  };
}
