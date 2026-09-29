/**
 * Deterministic follow-up spawns after a phase agent returns (align ↔ gather chain).
 */

import type { DevHarnessConfig } from "../config/index.js";
import { loadWorkItem, mutateJson, now, workItemJsonPath } from "../work-items/io.js";
import type { WorkItem } from "../work-items/types.js";
import type { OrchestrationRuntimeHost } from "./host.js";
import { maxGatherAttemptsFromDevConfig } from "./policy.js";
import { applyStuckPostResult } from "./post-result/stuck.js";
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

  if (input.agent === "phase-gather" && status === "done" && input.phase === "aligning") {
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

  // `stuck` is uniform across every agent's return schema and always halts the auto-replan
  // loop \u2014 there is nothing useful to replan into until the escalation (promoted to
  // decisions[] by `applyStuckPostResult`) is answered.
  if (status === "stuck") {
    return "stop";
  }

  if (agent === "phase-align" && (status === "needs_input" || status === "needs_gather")) {
    return "stop";
  }

  if ((agent === "phase-spec" || agent === "phase-plan") && status === "needs_input") {
    return "stop";
  }

  return "replan";
}

/** True when the work item has used its persisted phase-gather budget. */
export function gatherCapReached(workItemId: string, devConfig: DevHarnessConfig | null): boolean {
  const used = loadWorkItem(workItemId)?.gather_attempts ?? 0;
  return used >= maxGatherAttemptsFromDevConfig(devConfig);
}

function bumpGatherAttempts(workItemId: string): void {
  mutateJson<WorkItem>(workItemJsonPath(workItemId), (wi) => {
    if (!wi) return undefined;
    wi.gather_attempts = (wi.gather_attempts ?? 0) + 1;
    wi.updated = now();
    return wi;
  });
}

/**
 * When phase-align still returns `needs_gather` after the gather budget is spent, escalate to a
 * human via `decisions[]` (same path as a `stuck` packet) and reset the counter so the answer
 * buys a fresh budget. Returns `true` when an escalation was raised — the caller must stop with
 * `stalledReason: "stuck"` instead of returning success (which `accord drive` would loop on).
 */
export function escalateGatherCapIfExhausted(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
  lastSpawn: { agent: string; parsedReturn?: unknown } | undefined,
): boolean {
  if (lastSpawn?.agent !== "phase-align") return false;
  if (extractReturnStatus(lastSpawn.parsedReturn) !== "needs_gather") return false;
  if (!gatherCapReached(workItemId, devConfig)) return false;

  const max = maxGatherAttemptsFromDevConfig(devConfig);
  const hint = parseGatherHint(lastSpawn.parsedReturn);
  applyStuckPostResult(workItemId, "phase-align", {
    status: "stuck",
    question: `phase-align still needs more context after ${String(max)} phase-gather attempt(s). What additional context, source, or decision should alignment use?`,
    context:
      hint?.reason ?? "phase-align returned needs_gather again after the gather budget was spent.",
    tried: `${String(max)} phase-gather spawn(s)${hint?.ticket_id ? ` for ${hint.ticket_id}` : ""}`,
  });
  mutateJson<WorkItem>(workItemJsonPath(workItemId), (wi) => {
    if (!wi) return undefined;
    wi.gather_attempts = 0;
    return wi;
  });
  return true;
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

    if (plan.agent === "phase-gather") {
      // Persisted budget: an align↔gather cycle must stop across resumes / drive rounds too.
      if (gatherCapReached(input.workItemId, input.devConfig)) {
        break;
      }
      bumpGatherAttempts(input.workItemId);
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
