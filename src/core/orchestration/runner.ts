/**
 * Orchestration runner — executes a resolved {@link NextStep} list against a
 * {@link OrchestrationRuntimeHost}.
 *
 * Resume: {@link runResumeOrchestrationWithReplans} re-plans after each
 * successful spawn so quick_fix `phase-test` → `review-test` (and similar
 * chains) progress without a second `/dev resume`.
 *
 * Finish: {@link runFinishOrchestration} spawns `phase-verify-acceptance`
 * once, then on a clean exit derives the terminal outcome from
 * {@link devVerifySummary} and writes it via {@link devFinalizeWorkItem}.
 *
 * Pure planning lives in `./plan.ts`; host port types live in `./host.ts`.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { devVerifySummary } from "../queries/verify-summary.js";
import { buildWorkflowCostReport } from "../queries/workflow-cost.js";
import type { TerminalOutcome } from "../types/domain.js";
import { devFinalizeWorkItem } from "../work-items/lifecycle.js";
import type { OrchestrationRuntimeHost } from "./host.js";
import { isOrchestrationJudgmentConfigured, mergeResumeTaskWithJudgment } from "./judgment.js";
import { planDevResumeOrchestration, resumeResolutionToNextSteps } from "./plan.js";
import { resumeAllowsAutoReplanToAgent, resumeReplanPolicyFromDevConfig } from "./policy.js";
import { reconcileCoarsePhaseUntilStable } from "./reconcile-coarse-phase.js";
import { resolveFinishOrchestration } from "./resolve/finish.js";
import { resolveDevSubcommandOrchestration } from "./resolve/subcommand.js";
import type { NextStep, ResumeOrchestrationResolution, RunUntilStopResult } from "./types.js";

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
  const resumePolicy = resumeReplanPolicyFromDevConfig(devConfig);
  const maxSequentialSpawns = Math.max(
    1,
    options?.maxSequentialSpawns ?? resumePolicy.maxSequentialSpawns,
  );
  let previousSpawnFingerprint: string | undefined;
  let firstResolution: ResumeOrchestrationResolution | undefined;
  let lastRun: RunUntilStopResult = { stopReason: "idle" };

  for (let iter = 0; iter < maxSequentialSpawns; iter++) {
    const resolution = planDevResumeOrchestration(workItemId, devConfig);
    if (iter === 0) {
      firstResolution = resolution;
    }

    if (resolution.outcome === "blocked" || resolution.outcome === "complete") {
      const steps = resumeResolutionToNextSteps(resolution);
      lastRun = await runUntilStop(steps, host);
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

    if (lastRun.stopReason !== "spawned_subagent") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (!lastRun.lastSpawn || lastRun.lastSpawn.exitCode !== 0) {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (resolution.outcome !== "spawn") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }

    const reconcileSteps = reconcileCoarsePhaseUntilStable(workItemId);
    if (reconcileSteps > 0) {
      host.notify(
        "info",
        `Resume: advanced work item coarse phase after ${resolution.agent} (${String(reconcileSteps)} step(s)).`,
      );
    }

    const nextResolution = planDevResumeOrchestration(workItemId, devConfig);
    if (
      nextResolution.outcome === "spawn" &&
      !resumeAllowsAutoReplanToAgent(nextResolution.agent, devConfig)
    ) {
      host.notify(
        "info",
        `Resume: next step is **${nextResolution.agent}**. Run \`/dev resume ${workItemId}\` again to continue (agent is in \`orchestration.resume.no_auto_chain_agents\`).`,
      );
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }

    previousSpawnFingerprint = fingerprint;

    if (iter + 1 >= maxSequentialSpawns) {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
  }

  throw new Error("runResumeOrchestrationWithReplans: loop exited without return");
}

/**
 * Runs an explicit `/dev <subcommand> <ID>` spawn, then resume replans for chained steps.
 */
export async function runDevSubcommandOrchestrationWithReplans(
  subcommand: string,
  workItemId: string,
  rawArgs: string,
  devConfig: DevHarnessConfig | null,
  host: OrchestrationRuntimeHost,
  options?: { maxSequentialSpawns?: number },
): Promise<RunResumeOrchestrationWithReplansResult> {
  const resumePolicy = resumeReplanPolicyFromDevConfig(devConfig);
  const maxSequentialSpawns = Math.max(
    1,
    options?.maxSequentialSpawns ?? resumePolicy.maxSequentialSpawns,
  );
  let previousSpawnFingerprint: string | undefined;
  let firstResolution: ResumeOrchestrationResolution | undefined;
  let lastRun: RunUntilStopResult = { stopReason: "idle" };

  for (let iter = 0; iter < maxSequentialSpawns; iter++) {
    const resolution =
      iter === 0
        ? resolveDevSubcommandOrchestration(subcommand, workItemId, rawArgs, devConfig)
        : planDevResumeOrchestration(workItemId, devConfig);
    if (iter === 0) {
      firstResolution = resolution;
    }

    if (resolution.outcome === "blocked" || resolution.outcome === "complete") {
      const steps = resumeResolutionToNextSteps(resolution);
      lastRun = await runUntilStop(steps, host);
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

    if (lastRun.stopReason !== "spawned_subagent") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (!lastRun.lastSpawn || lastRun.lastSpawn.exitCode !== 0) {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
    if (resolution.outcome !== "spawn") {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }

    const reconcileSteps = reconcileCoarsePhaseUntilStable(workItemId);
    if (reconcileSteps > 0) {
      host.notify(
        "info",
        `Resume: advanced work item coarse phase after ${resolution.agent} (${String(reconcileSteps)} step(s)).`,
      );
    }

    const nextResolution = planDevResumeOrchestration(workItemId, devConfig);
    if (
      nextResolution.outcome === "spawn" &&
      !resumeAllowsAutoReplanToAgent(nextResolution.agent, devConfig)
    ) {
      host.notify(
        "info",
        `Resume: next step is **${nextResolution.agent}**. Run \`/dev resume ${workItemId}\` again to continue (agent is in \`orchestration.resume.no_auto_chain_agents\`).`,
      );
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }

    previousSpawnFingerprint = fingerprint;

    if (iter + 1 >= maxSequentialSpawns) {
      return { firstResolution: firstResolution ?? resolution, lastRun, iterations: iter + 1 };
    }
  }

  throw new Error("runDevSubcommandOrchestrationWithReplans: loop exited without return");
}

function verdictToTerminalOutcome(verdict: string): TerminalOutcome {
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
  /** Token/cost rollup for the full work item (includes verify-acceptance when it ran). */
  workflow_cost_formatted?: string;
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
      const costReport = buildWorkflowCostReport(workItemId);
      const fin = devFinalizeWorkItem(workItemId, {
        terminal_outcome: terminal,
        next_action: nextAction,
        retro: {
          verify_verdict: summary.value.verdict,
          summary: summary.value.formatted.slice(0, 4000),
          ...(costReport
            ? {
                workflow_cost_usd: costReport.total_cost_usd,
                workflow_cost: costReport.formatted.slice(0, 4000),
              }
            : {}),
        },
      });
      closeout = fin.ok ? { ok: true } : { ok: false, error: fin.error };
    }
  }

  const workflow_cost_formatted = buildWorkflowCostReport(workItemId)?.formatted;

  return { resolution, lastRun, closeout, workflow_cost_formatted };
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
    } else if (step.kind === "stop") {
      return { stopReason: step.reason, lastSpawn };
    } else if (step.kind === "spawn_subagent") {
      const r = await host.spawnSubagent(step.request);
      lastSpawn = { agent: step.request.agent, exitCode: r.exitCode };
    } else if (step.kind === "spawn_chain") {
      for (const request of step.request.steps) {
        const r = await host.spawnSubagent(request);
        lastSpawn = { agent: request.agent, exitCode: r.exitCode };
        if (r.exitCode !== 0) break;
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
