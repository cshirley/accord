/**
 * `/dev resume` — resolve which agent to run (registry ids + coarse phase map).
 */

import { agentRequiresConfig, getAgentMeta } from "../../agents/registry.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { devResumeState } from "../../queries/resume-state.js";
import { loadWorkItem } from "../../work-items/io.js";
import { isWorkItemPattern, resolveResumeAgentId } from "../phase-coarse-routing.js";
import { buildQuickFixPreImplReviewTestBrief } from "../quick-fix.js";
import type { OrchestrationMessage, ResumeOrchestrationResolution } from "../types.js";
import { resolvePrimaryTaskResumeAgentId } from "./primary-task.js";

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
  const rs = devResumeState(workItemId);
  if (!rs.ok) {
    return { outcome: "forward_skill", reason: rs.error };
  }
  const state = rs.value;

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

  if (!isWorkItemPattern(state.pattern)) {
    return {
      outcome: "forward_skill",
      reason: `Unknown work item pattern "${state.pattern}" — delegate to accord skill.`,
    };
  }

  const pattern = state.pattern;
  const phase = state.phase;
  const agent = resolveResumeAgentId(phase, pattern) ?? resolvePrimaryTaskResumeAgentId(workItemId);

  if (!agent) {
    return {
      outcome: "forward_skill",
      reason: `Phase "${phase}" (pattern ${pattern}) has no harness resume mapping yet — delegate to accord skill.`,
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
      outcome: "forward_skill",
      reason: `Resolved agent "${agent}" is not in the registry — delegate to accord skill.`,
    };
  }

  const task =
    buildQuickFixPreImplReviewTestBrief({
      workItemId: state.id,
      phase,
      title: state.title,
      pattern: state.pattern,
      variant: state.variant,
      dispatchAgent: agent,
    }) ??
    buildResumeTaskBrief({
      workItemId: state.id,
      phase,
      title: state.title,
      pattern: state.pattern,
      variant: state.variant,
      dispatchAgent: agent,
    });

  return {
    outcome: "spawn",
    workItemId: state.id,
    agent,
    task,
  };
}
