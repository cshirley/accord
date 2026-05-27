/**
 * `/dev resume` — resolve which agent to run (registry ids + coarse phase map).
 */

import { agentRequiresConfig, getAgentMeta } from "../../agents/registry.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { devResumeState } from "../../queries/resume-state.js";
import { loadWorkItem } from "../../work-items/io.js";
import { isWorkItemPattern, resolveResumeAgentId } from "../phase-coarse-routing.js";
import { buildImplementSpawnTaskBrief } from "../../briefing/task-requirements.js";
import { appendReviewFeedbackToResumeBrief } from "../review-feedback.js";
import type { OrchestrationMessage, ResumeOrchestrationResolution } from "../types.js";
import {
  describeImplementingResumeBlocked,
  resolveImplementingResumeAgentId,
  resolvePrimaryTaskResumeAgentId,
} from "./primary-task.js";

export function parseLeadingWorkItemId(args: string): string | null {
  const trimmed = args.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}

export function buildResumeTaskBrief(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
}): string {
  const lines = [
    "ACCORD harness resume (orchestrator).",
    "",
    `work_item_id: ${input.workItemId}`,
    `work_item_phase: ${input.phase}`,
    `dispatch_agent: ${input.dispatchAgent}`,
    `pattern: ${input.pattern}`,
    ...(input.variant ? [`variant: ${input.variant}`] : []),
    `title: ${input.title}`,
    "",
    "Continue this phase. Read the work item JSON under `.tasks/` and any checkpoint file.",
    "Return the structured result packet required by your agent contract.",
  ];
  return lines.join("\n");
}

export function resolveResumeOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  const wi = loadWorkItem(workItemId);
  if (wi?.completed_at && wi.terminal_outcome) {
    const messages: OrchestrationMessage[] = [
      {
        level: "info",
        text: `Work item ${workItemId} is already terminal (${wi.terminal_outcome}). Nothing to resume.`,
      },
    ];
    return { outcome: "complete", messages };
  }

  const rsAfterReconcile = devResumeState(workItemId);
  if (!rsAfterReconcile.ok) {
    return { outcome: "blocked", messages: [{ level: "warning", text: rsAfterReconcile.error }] };
  }
  const stateAfterReconcile = rsAfterReconcile.value;

  if (!isWorkItemPattern(stateAfterReconcile.pattern)) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: `Unknown work item pattern "${stateAfterReconcile.pattern}".`,
        },
      ],
    };
  }

  const pattern = stateAfterReconcile.pattern;
  const phase = stateAfterReconcile.phase;
  const agent =
    resolveResumeAgentId(phase, pattern) ??
    (phase === "implementing" && pattern === "implement"
      ? resolveImplementingResumeAgentId(workItemId)
      : resolvePrimaryTaskResumeAgentId(workItemId));

  if (!agent) {
    const implementingHint =
      phase === "implementing" && pattern === "implement"
        ? describeImplementingResumeBlocked(workItemId)
        : null;
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text:
            implementingHint ??
            `Phase "${phase}" (pattern ${pattern}) has no harness resume mapping yet.`,
        },
      ],
    };
  }

  if (agentRequiresConfig(agent) && !devConfig) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: "No ACCORD config found. Run /dev init to configure before resuming this phase.",
        },
      ],
    };
  }

  if (!getAgentMeta(agent)) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: `Resolved agent "${agent}" is not in the registry.`,
        },
      ],
    };
  }

  const baseTask =
    buildImplementSpawnTaskBrief({
      workItemId: stateAfterReconcile.id,
      phase,
      title: stateAfterReconcile.title,
      pattern: stateAfterReconcile.pattern,
      variant: stateAfterReconcile.variant,
      dispatchAgent: agent,
      devConfig,
    }) ??
    buildResumeTaskBrief({
      workItemId: stateAfterReconcile.id,
      phase,
      title: stateAfterReconcile.title,
      pattern: stateAfterReconcile.pattern,
      variant: stateAfterReconcile.variant,
      dispatchAgent: agent,
    });
  const task = appendReviewFeedbackToResumeBrief(workItemId, baseTask, agent);

  return {
    outcome: "spawn",
    workItemId: stateAfterReconcile.id,
    agent,
    task,
  };
}
