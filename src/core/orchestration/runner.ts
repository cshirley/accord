/**
 * Orchestration runner — plan resume, map to {@link NextStep}, optional execute loop.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { devVerifySummary } from "../queries/verify-summary.js";
import { devFinalizeWorkItem } from "../work-items/lifecycle.js";
import type { OrchestrationHost } from "./host.js";
import { isOrchestrationJudgmentConfigured, mergeResumeTaskWithJudgment } from "./judgment.js";
import { resolveFinishOrchestration } from "./resolve/finish.js";
import { resolveResumeOrchestration } from "./resolve/resume.js";
import type {
  NextStep,
  ResumeOrchestrationResolution,
  RunUntilStopResult,
  SubagentSpawnResult,
} from "./types.js";

export function planDevResumeOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  return resolveResumeOrchestration(workItemId, devConfig);
}

export function resumeResolutionToNextSteps(resolution: ResumeOrchestrationResolution): NextStep[] {
  switch (resolution.outcome) {
    case "forward_skill":
      return [{ kind: "delegate_to_skill", reason: resolution.reason }];
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
        {
          kind: "spawn_subagent" as const,
          workItemId: resolution.workItemId,
          request: { agent: resolution.agent, task: resolution.task },
        },
        { kind: "stop" as const, reason: "spawned_subagent" as const },
      ];
  }
}

export function planDevFinishOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  return resolveFinishOrchestration(workItemId, devConfig);
}

export type DevOrchestrateCommand = "resume" | "finish";

export function buildDevOrchestratePayload(
  command: DevOrchestrateCommand,
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): {
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
   * template-only merge {@link runResumeOrchestrationWithReplans} applies when `runJudgment`
   * is absent or returns nothing parseable. Matches Pi when the judgment LLM is off or fails;
   * diverges when Pi merges validated model JSON.
   */
  spawn_task_after_template_judgment?: string;
} {
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
  return {
    command,
    resolution,
    next_steps: resumeResolutionToNextSteps(resolution),
    programmatic_spawn_supported: false,
    judgment_configured_for_spawn: judgmentConfiguredForSpawn,
    ...(spawnTaskAfterTemplateJudgment !== undefined
      ? { spawn_task_after_template_judgment: spawnTaskAfterTemplateJudgment }
      : {}),
  };
}

export type OrchestrationJudgmentRequest = {
  /** Registry id for logging only — host must not use this to route or spawn. */
  dispatchAgent: string;
  workItemId: string;
  baseTask: string;
};

export type OrchestrationRuntimeHost = Pick<OrchestrationHost, "notify"> & {
  spawnSubagent(input: { agent: string; task: string }): Promise<SubagentSpawnResult>;
  /**
   * Optional bounded LLM call returning **raw assistant text** (may include JSON).
   * Core validates against `schemas/orchestration-judgment-packet.json` before merge.
   */
  runJudgment?(request: OrchestrationJudgmentRequest): Promise<string | undefined>;
};

const DEFAULT_MAX_SEQUENTIAL_RESUME_SPAWNS = 8;

export type ResumeOrchestrationStallReason = "repeat_spawn";

export interface RunResumeOrchestrationWithReplansResult {
  firstResolution: ResumeOrchestrationResolution;
  lastRun: RunUntilStopResult;
  iterations: number;
  stalledReason?: ResumeOrchestrationStallReason;
}

/**
 * Plans and runs `/dev resume` one or more times while each subagent exits 0 and the next plan
 * names a different spawn — e.g. quick_fix `phase-test` → `review-test` without a second user `/dev resume`.
 */
export async function runResumeOrchestrationWithReplans(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
  host: OrchestrationRuntimeHost,
  options?: { maxSequentialSpawns?: number },
): Promise<RunResumeOrchestrationWithReplansResult> {
  const maxSequentialSpawns = Math.max(
    1,
    options?.maxSequentialSpawns ?? DEFAULT_MAX_SEQUENTIAL_RESUME_SPAWNS,
  );
  let previousSpawnFingerprint: string | undefined;
  let firstResolution: ResumeOrchestrationResolution | undefined;
  let lastRun: RunUntilStopResult = { stopReason: "idle" };

  for (let iter = 0; iter < maxSequentialSpawns; iter++) {
    const resolution = planDevResumeOrchestration(workItemId, devConfig);
    if (iter === 0) {
      firstResolution = resolution;
    }

    if (resolution.outcome === "forward_skill") {
      lastRun = { stopReason: "delegate_to_skill", delegateReason: resolution.reason };
      return { firstResolution: resolution, lastRun, iterations: iter };
    }

    const fingerprint =
      resolution.outcome === "spawn" ? `${resolution.agent}\u0000${resolution.task}` : "";

    if (resolution.outcome === "spawn" && fingerprint === previousSpawnFingerprint) {
      return {
        firstResolution: firstResolution ?? resolution,
        lastRun,
        iterations: iter,
        stalledReason: "repeat_spawn",
      };
    }

    let executionResolution: ResumeOrchestrationResolution = resolution;
    if (
      resolution.outcome === "spawn" &&
      isOrchestrationJudgmentConfigured(devConfig, resolution.agent)
    ) {
      const raw = await host.runJudgment?.({
        dispatchAgent: resolution.agent,
        workItemId: resolution.workItemId,
        baseTask: resolution.task,
      });
      executionResolution = {
        ...resolution,
        task: mergeResumeTaskWithJudgment({
          baseTask: resolution.task,
          rawLlmText: raw,
          workItemId: resolution.workItemId,
          dispatchAgent: resolution.agent,
        }),
      };
    }

    const steps = resumeResolutionToNextSteps(executionResolution);
    lastRun = await runUntilStop(steps, host);

    if (lastRun.stopReason === "delegate_to_skill") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (lastRun.stopReason !== "spawned_subagent") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (!lastRun.lastSpawn || lastRun.lastSpawn.exitCode !== 0) {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (resolution.outcome !== "spawn") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }

    previousSpawnFingerprint = fingerprint;

    if (iter + 1 >= maxSequentialSpawns) {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
  }

  throw new Error("runResumeOrchestrationWithReplans: loop exited without return");
}

function verdictToTerminalOutcome(
  verdict: string,
): "done" | "blocked" | "partially_achieved" | "unclear" {
  const v = verdict.trim().toLowerCase();
  if (v === "pass") {
    return "done";
  }
  if (v === "fail" || v === "gaps") {
    return "partially_achieved";
  }
  return "unclear";
}

export interface RunFinishOrchestrationResult {
  resolution: ResumeOrchestrationResolution;
  lastRun: RunUntilStopResult;
  closeout?: { ok: true } | { ok: false; error: string };
}

export async function runFinishOrchestrationFromResolution(
  resolution: ResumeOrchestrationResolution,
  workItemId: string,
  _devConfig: DevHarnessConfig | null,
  host: OrchestrationRuntimeHost,
): Promise<RunFinishOrchestrationResult> {
  const steps = resumeResolutionToNextSteps(resolution);
  const lastRun = await runUntilStop(steps, host);

  let closeout: RunFinishOrchestrationResult["closeout"];
  if (
    resolution.outcome === "spawn" &&
    resolution.agent === "phase-verify-acceptance" &&
    lastRun.lastSpawn?.exitCode === 0
  ) {
    const summary = devVerifySummary(workItemId);
    if (!summary.ok) {
      closeout = { ok: false, error: summary.error };
    } else {
      const terminal = verdictToTerminalOutcome(summary.value.verdict);
      const nextAction = terminal === "done" ? "/commit then open a PR" : `/dev gaps ${workItemId}`;
      const fin = devFinalizeWorkItem(workItemId, {
        terminal_outcome: terminal,
        next_action: nextAction,
        retro: {
          verify_verdict: summary.value.verdict,
          summary: summary.value.formatted.slice(0, 4000),
        },
      });
      closeout = fin.ok ? { ok: true } : { ok: false, error: fin.error };
    }
  }

  return { resolution, lastRun, closeout };
}

/**
 * Plans and runs `/dev finish`: one **phase-verify-acceptance** spawn, then on exit 0 runs
 * {@link devVerifySummary} and {@link devFinalizeWorkItem} from the verify verdict.
 */
export async function runFinishOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
  host: OrchestrationRuntimeHost,
): Promise<RunFinishOrchestrationResult> {
  const resolution = resolveFinishOrchestration(workItemId, devConfig);
  return runFinishOrchestrationFromResolution(resolution, workItemId, devConfig, host);
}

/**
 * Executes a linear {@link NextStep} list until a stop or skill delegation.
 * Pi resume uses `createResumeOrchestrationRuntimeHost` from the Pi adapter as the runtime host.
 */
export async function runUntilStop(
  steps: readonly NextStep[],
  host: OrchestrationRuntimeHost,
): Promise<RunUntilStopResult> {
  let lastSpawn: { agent: string; exitCode: number } | undefined;

  for (const step of steps) {
    if (step.kind === "notify_user") {
      host.notify(step.message.level, step.message.text);
    } else if (step.kind === "delegate_to_skill") {
      return { stopReason: "delegate_to_skill", delegateReason: step.reason, lastSpawn };
    } else if (step.kind === "stop") {
      return { stopReason: step.reason, lastSpawn };
    } else if (step.kind === "spawn_subagent") {
      const r = await host.spawnSubagent(step.request);
      lastSpawn = { agent: step.request.agent, exitCode: r.exitCode };
    } else if (step.kind === "spawn_chain") {
      for (const request of step.request.steps) {
        const r = await host.spawnSubagent(request);
        lastSpawn = { agent: request.agent, exitCode: r.exitCode };
      }
    } else if (step.kind === "spawn_parallel") {
      const tasks = step.request.tasks;
      const results = await Promise.all(tasks.map((request) => host.spawnSubagent(request)));
      const firstBadIndex = results.findIndex((r) => r.exitCode !== 0);
      if (firstBadIndex >= 0) {
        lastSpawn = {
          agent: tasks[firstBadIndex].agent,
          exitCode: results[firstBadIndex].exitCode,
        };
      } else if (tasks.length > 0) {
        const lastIndex = tasks.length - 1;
        lastSpawn = { agent: tasks[lastIndex].agent, exitCode: results[lastIndex].exitCode };
      }
    }
  }
  return { stopReason: "idle", lastSpawn };
}
