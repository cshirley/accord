/**
 * Deterministic follow-up spawns after a phase agent returns (align ↔ gather chain).
 */

import type { DevHarnessConfig } from "../config/index.js";
import { loadWorkItem } from "../work-items/io.js";
import type { OrchestrationRuntimeHost } from "./host.js";
import {
  type AlignGatherHint,
  buildAlignSpawnTask,
  buildGatherSpawnTask,
} from "./resolve/align-task.js";
import type { RunUntilStopResult } from "./types.js";

const DEFAULT_MAX_FOLLOW_UPS = 4;

export type PostSpawnReplanDecision = "replan" | "stop";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function extractReturnStatus(parsedReturn: unknown): string | undefined {
  const status = asRecord(parsedReturn)?.status;
  return typeof status === "string" ? status : undefined;
}

function parseGatherHint(parsedReturn: unknown): AlignGatherHint | undefined {
  const hint = asRecord(asRecord(parsedReturn)?.gather_hint);
  if (!hint) {
    return undefined;
  }
  const ticket_id = typeof hint.ticket_id === "string" ? hint.ticket_id : undefined;
  const reason = typeof hint.reason === "string" ? hint.reason : undefined;
  if (!ticket_id && !reason) {
    return undefined;
  }
  return { ticket_id, reason };
}

export interface SpawnFollowUpPlan {
  agent: string;
  task: string;
}

export interface PlanSpawnFollowUpInput {
  workItemId: string;
  agent: string;
  exitCode: number;
  parsedReturn?: unknown;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  devConfig: DevHarnessConfig | null;
}

/**
 * Next orchestrator-owned spawn after a successful subagent, before replanning resume.
 */
export function planSpawnFollowUp(input: PlanSpawnFollowUpInput): SpawnFollowUpPlan | null {
  if (input.exitCode !== 0) {
    return null;
  }

  const status = extractReturnStatus(input.parsedReturn);

  if (input.agent === "phase-align" && status === "needs_gather") {
    return {
      agent: "phase-gather",
      task: buildGatherSpawnTask(
        input.workItemId,
        parseGatherHint(input.parsedReturn),
        input.devConfig,
      ),
    };
  }

  if (
    input.agent === "phase-gather" &&
    status === "done" &&
    input.phase === "aligning"
  ) {
    const gatherResult = asRecord(input.parsedReturn) ?? {};
    return {
      agent: "phase-align",
      task: buildAlignSpawnTask({
        workItemId: input.workItemId,
        title: input.title,
        pattern: input.pattern,
        variant: input.variant,
        devConfig: input.devConfig,
        gatherResult,
      }),
    };
  }

  return null;
}

/**
 * Whether the outer resume replan loop should continue after follow-ups complete.
 */
export function postSpawnReplanDecision(
  parsedReturn: unknown,
  agent: string,
): PostSpawnReplanDecision {
  const status = extractReturnStatus(parsedReturn);

  if (agent === "phase-align") {
    if (status === "needs_input" || status === "needs_gather" || status === "stuck") {
      return "stop";
    }
  }

  if (agent === "phase-spec" || agent === "phase-plan") {
    if (status === "needs_input" || status === "stuck") {
      return "stop";
    }
  }

  if (agent === "phase-gather" && status === "stuck") {
    return "stop";
  }

  return "replan";
}

export interface RunSpawnFollowUpChainInput {
  workItemId: string;
  host: OrchestrationRuntimeHost;
  devConfig: DevHarnessConfig | null;
  initial: { agent: string; exitCode: number; parsedReturn?: unknown };
}

/**
 * Runs align→gather→align (etc.) in one resume without waiting for replan + repeat_spawn guard.
 */
export async function runSpawnFollowUpChain(
  input: RunSpawnFollowUpChainInput,
  options?: { maxFollowUps?: number },
): Promise<RunUntilStopResult> {
  const maxFollowUps = options?.maxFollowUps ?? DEFAULT_MAX_FOLLOW_UPS;
  let agent = input.initial.agent;
  let exitCode = input.initial.exitCode;
  let parsedReturn = input.initial.parsedReturn;

  let lastRun: RunUntilStopResult = {
    stopReason: "spawned_subagent",
    lastSpawn: { agent, exitCode, parsedReturn },
  };

  for (let i = 0; i < maxFollowUps; i++) {
    const wi = loadWorkItem(input.workItemId);
    if (!wi) {
      break;
    }

    const plan = planSpawnFollowUp({
      workItemId: input.workItemId,
      agent,
      exitCode,
      parsedReturn,
      phase: wi.phase,
      title: wi.title,
      pattern: wi.pattern,
      variant: wi.variant,
      devConfig: input.devConfig,
    });

    if (!plan) {
      break;
    }

    const r = await input.host.spawnSubagent({ agent: plan.agent, task: plan.task });
    agent = plan.agent;
    exitCode = r.exitCode;
    parsedReturn = r.parsedReturn;
    lastRun = {
      stopReason: "spawned_subagent",
      lastSpawn: { agent, exitCode, parsedReturn },
    };

    if (exitCode !== 0) {
      break;
    }
  }

  return lastRun;
}
