/**
 * Resolution-to-plan helpers + the `dev_orchestrate` MCP/tool payload builder.
 *
 * Pure functions over {@link ResumeOrchestrationResolution} and {@link NextStep}.
 * Adapters that just want to know "what would the runner do?" (MCP, contract
 * tests, the `dev_orchestrate` tool) call into here without going through the
 * executing runner.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { buildWorkflowCostReport } from "../queries/workflow-cost.js";
import { isOrchestrationJudgmentConfigured, mergeResumeTaskWithJudgment } from "./judgment.js";
import { resolveFinishOrchestration } from "./resolve/finish.js";
import { resolveResumeOrchestration } from "./resolve/resume.js";
import type { NextStep, ResumeOrchestrationResolution } from "./types.js";

export function planDevResumeOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  return resolveResumeOrchestration(workItemId, devConfig);
}

export function planDevFinishOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  return resolveFinishOrchestration(workItemId, devConfig);
}

export function resumeResolutionToNextSteps(resolution: ResumeOrchestrationResolution): NextStep[] {
  switch (resolution.outcome) {
    case "complete":
      return [
        ...resolution.messages.map((message) => ({ kind: "notify_user" as const, message })),
        { kind: "stop" as const, reason: "complete" as const },
      ];
    case "blocked":
      return [
        ...resolution.messages.map((message) => ({ kind: "notify_user" as const, message })),
        { kind: "stop" as const, reason: "blocked" as const },
      ];
    case "spawn":
      return [
        ...(resolution.messages ?? []).map((message) => ({
          kind: "notify_user" as const,
          message,
        })),
        {
          kind: "spawn_subagent" as const,
          workItemId: resolution.workItemId,
          request: { agent: resolution.agent, task: resolution.task },
        },
        { kind: "stop" as const, reason: "spawned_subagent" as const },
      ];
  }
}

export type DevOrchestrateCommand = "resume" | "finish";

export interface DevOrchestratePayload {
  command: DevOrchestrateCommand;
  resolution: ResumeOrchestrationResolution;
  next_steps: NextStep[];
  /** MCP / headless hosts cannot spawn Pi subagents; clients use this hint. */
  programmatic_spawn_supported: boolean;
  /**
   * True only for `command: "resume"` when the plan is a spawn and Dev Harness enables
   * judgment for that dispatch agent. Pi may still skip the LLM (`ACCORD_ORCHESTRATION_JUDGMENT`);
   * MCP never runs judgment — use {@link spawn_task_after_template_judgment} for template parity.
   */
  judgment_configured_for_spawn: boolean;
  /**
   * When {@link judgment_configured_for_spawn} is true, the outbound task after the same
   * template-only merge `runResumeOrchestrationWithReplans` applies when `runJudgment`
   * is absent or returns nothing parseable. Matches Pi when the judgment LLM is off or fails;
   * diverges when Pi merges validated model JSON.
   */
  spawn_task_after_template_judgment?: string;
  /** Present for `finish`: current usage rollup (re-run after verify for final totals). */
  workflow_cost?: ReturnType<typeof buildWorkflowCostReport>;
}

export function buildDevOrchestratePayload(
  command: DevOrchestrateCommand,
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): DevOrchestratePayload {
  const resolution =
    command === "resume"
      ? resolveResumeOrchestration(workItemId, devConfig)
      : resolveFinishOrchestration(workItemId, devConfig);
  const judgmentConfiguredForSpawn =
    command === "resume" &&
    resolution.outcome === "spawn" &&
    isOrchestrationJudgmentConfigured(devConfig, resolution.agent);
  const spawnTaskAfterTemplateJudgment =
    judgmentConfiguredForSpawn && resolution.outcome === "spawn"
      ? mergeResumeTaskWithJudgment({
          baseTask: resolution.task,
          rawLlmText: undefined,
          workItemId: resolution.workItemId,
          dispatchAgent: resolution.agent,
        })
      : undefined;
  const workflowCost =
    command === "finish" ? (buildWorkflowCostReport(workItemId) ?? undefined) : undefined;

  return {
    command,
    resolution,
    next_steps: resumeResolutionToNextSteps(resolution),
    programmatic_spawn_supported: false,
    judgment_configured_for_spawn: judgmentConfiguredForSpawn,
    ...(spawnTaskAfterTemplateJudgment !== undefined
      ? { spawn_task_after_template_judgment: spawnTaskAfterTemplateJudgment }
      : {}),
    ...(workflowCost ? { workflow_cost: workflowCost } : {}),
  };
}
