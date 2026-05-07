/**
 * Main-session (orchestrator) usage accounting on turn_end.
 */

import type { PricingConfig } from "../telemetry/usage.js";
import {
  type UsageLine,
  appendUsageLine,
  computeLineCost,
  updateWorkItemCost,
  normalizeUsageCostFields,
  ensureAutoHarnessRunMeta,
} from "../telemetry/usage.js";
import type { HarnessMutableState } from "./types.js";
import { ORCHESTRATOR_FP_CAP, type OrchestratorUsageDedup } from "./types.js";

function isAssistantTurnMessage(m: unknown): m is {
  role: string;
  content?: unknown;
  usage?: unknown;
  id?: string;
  model?: string;
} {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as { role?: string }).role === "assistant" &&
    Array.isArray((m as { content?: unknown }).content)
  );
}

function orchestratorUsageFingerprint(msg: {
  id?: string;
  usage?: unknown;
}): string | null {
  const id = msg.id;
  if (id) return `id:${id}`;
  const u = msg.usage;
  if (!u) return null;
  const norm = normalizeUsageCostFields(u as any);
  const billable = norm.input + norm.output + norm.cost + norm.cacheRead + norm.cacheWrite;
  if (billable === 0) return null;
  return `tok:${norm.input}:${norm.output}:${norm.cost}:${norm.cacheRead}:${norm.cacheWrite}`;
}

export function rememberOrchestratorFingerprint(
  dedup: OrchestratorUsageDedup,
  fp: string,
): boolean {
  if (dedup.seen.has(fp)) return false;
  dedup.seen.add(fp);
  dedup.queue.push(fp);
  if (dedup.queue.length > ORCHESTRATOR_FP_CAP) {
    const old = dedup.queue.shift()!;
    dedup.seen.delete(old);
  }
  return true;
}

export function createOrchestratorUsageDedup(): OrchestratorUsageDedup {
  return { queue: [], seen: new Set() };
}

export interface ProcessOrchestratorTurnParams {
  message: unknown;
  workItemId: string | null;
  state: HarnessMutableState;
  pricing: PricingConfig;
  dedup: OrchestratorUsageDedup;
  host?: { syncHarnessRunMeta?: () => void; refreshUi?: () => void };
}

/** @returns true when a billable usage line was recorded */
export function processOrchestratorTurnEnd(params: ProcessOrchestratorTurnParams): boolean {
  const { message, workItemId, state, pricing, dedup, host } = params;
  if (!isAssistantTurnMessage(message)) return false;
  const msg = message;
  if (!msg.usage) return false;
  const norm = normalizeUsageCostFields(msg.usage as any);
  if (norm.input + norm.output + norm.cost + norm.cacheRead + norm.cacheWrite === 0) return false;

  const fp = orchestratorUsageFingerprint(msg);
  if (!fp || !rememberOrchestratorFingerprint(dedup, fp)) return false;

  if (!workItemId) return false;

  ensureAutoHarnessRunMeta(workItemId);
  host?.syncHarnessRunMeta?.();
  const line: UsageLine = {
    at: new Date().toISOString(),
    work_item_id: workItemId,
    subagent_type: "orchestrator",
    model: msg.model,
    usage: { ...norm, turns: norm.turns > 0 ? norm.turns : 1 },
    source: "orchestrator",
  };
  appendUsageLine(workItemId, line);
  const cached = state.costCache.get(workItemId) ?? 0;
  const totalCost = cached + computeLineCost(line, pricing);
  state.costCache.set(workItemId, totalCost);
  updateWorkItemCost(workItemId, totalCost);
  state.sessionCost = totalCost;
  state.activeWorkItem = workItemId;
  host?.refreshUi?.();
  return true;
}

export { isAssistantTurnMessage };
