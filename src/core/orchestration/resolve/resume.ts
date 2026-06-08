/**
 * `/dev resume` — resolve which agent to run (registry ids + coarse phase map).
 */

import { agentRequiresConfig, getAgentMeta } from "../../agents/registry.js";
import { buildImplementSpawnTaskBrief } from "../../briefing/task-requirements.js";
import type { DevHarnessConfig } from "../../config/index.js";
import {
  agentRequiresSpawnPreflight,
  runSubagentSpawnPreflightCheck,
} from "../../queries/subagent-preflight.js";
import { devResumeState } from "../../queries/resume-state.js";
import { ensureWorkItemHydrated } from "../../work-items/rehydrate.js";
import { loadWorkItem } from "../../work-items/io.js";
import { reconcileCoarsePhaseWithMessages } from "../reconcile-coarse-phase.js";
import { isWorkItemPattern, resolveResumeAgentId } from "../phase-coarse-routing.js";
import { appendReviewFeedbackToResumeBrief } from "../review-feedback.js";
import type { OrchestrationMessage, ResumeOrchestrationResolution } from "../types.js";
import {
  describeImplementingResumeBlocked,
  resolveImplementingResumeAgentId,
  resolvePrimaryTaskResumeAgentId,
} from "./primary-task.js";
import { buildAlignResumeTaskOrGeneric } from "./align-task.js";

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
  const messages: OrchestrationMessage[] = [];

  const hydrated = ensureWorkItemHydrated(workItemId);
  if (!hydrated.ok) {
    return { outcome: "blocked", messages: [{ level: "warning", text: hydrated.error }] };
  }
  if ((hydrated.value.reconcile_steps ?? 0) > 0) {
    messages.push({ level: "info", text: hydrated.value.message });
  }

  const reconcile = reconcileCoarsePhaseWithMessages(workItemId);
  for (const advance of reconcile.advances) {
    const from = advance.fromPhase ?? "?";
    const to = advance.toPhase ?? "?";
    const boot =
      advance.tasksBootstrapped && advance.tasksBootstrapped > 0
        ? `; bootstrapped ${String(advance.tasksBootstrapped)} task file(s)`
        : "";
    messages.push({
      level: "info",
      text: `Reconciled coarse phase from on-disk artifacts: ${from} → ${to}${boot}.`,
    });
  }

  const wi = loadWorkItem(workItemId);
  if (wi?.completed_at && wi.terminal_outcome) {
    messages.push({
      level: "info",
      text: `Work item ${workItemId} is already terminal (${wi.terminal_outcome}). Nothing to resume.`,
    });
    return { outcome: "complete", messages };
  }

  const rsAfterReconcile = devResumeState(workItemId);
  if (!rsAfterReconcile.ok) {
    return {
      outcome: "blocked",
      messages: [...messages, { level: "warning", text: rsAfterReconcile.error }],
    };
  }
  const stateAfterReconcile = rsAfterReconcile.value;

  if (!isWorkItemPattern(stateAfterReconcile.pattern)) {
    return {
      outcome: "blocked",
      messages: [
        ...messages,
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
        ...messages,
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
        ...messages,
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
        ...messages,
        {
          level: "warning",
          text: `Resolved agent "${agent}" is not in the registry.`,
        },
      ],
    };
  }

  if (agentRequiresSpawnPreflight(agent)) {
    const preflight = runSubagentSpawnPreflightCheck(agent);
    for (const warning of preflight.warnings) {
      messages.push({ level: "info", text: warning });
    }
    if (!preflight.ok) {
      return {
        outcome: "blocked",
        messages: [
          ...messages,
          {
            level: "warning",
            text: `Subagent preflight failed for **${agent}** — fix before spawn:\n${preflight.blocks.map((b) => `- ${b}`).join("\n")}\n\nRun \`dev_subagent_preflight\` with agent="${agent}" for details.`,
          },
        ],
      };
    }
  }

  const implementBrief = buildImplementSpawnTaskBrief({
    workItemId: stateAfterReconcile.id,
    phase,
    title: stateAfterReconcile.title,
    pattern: stateAfterReconcile.pattern,
    variant: stateAfterReconcile.variant,
    dispatchAgent: agent,
    devConfig,
  });
  if (!implementBrief.ok) {
    return {
      outcome: "blocked",
      messages: [...messages, { level: "warning", text: implementBrief.error }],
    };
  }

  const baseTask =
    implementBrief.value ??
    buildAlignResumeTaskOrGeneric({
      workItemId: stateAfterReconcile.id,
      phase,
      title: stateAfterReconcile.title,
      pattern: stateAfterReconcile.pattern,
      variant: stateAfterReconcile.variant,
      dispatchAgent: agent,
      devConfig,
    });
  const task = appendReviewFeedbackToResumeBrief(workItemId, baseTask, agent);

  return {
    outcome: "spawn",
    workItemId: stateAfterReconcile.id,
    agent,
    task,
    messages: messages.length > 0 ? messages : undefined,
  };
}
