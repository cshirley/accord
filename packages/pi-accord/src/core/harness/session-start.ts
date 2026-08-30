/**
 * After session_start reloads config: seed per–work-item cost cache and active item.
 *
 * Caller should run `loadDevHarnessConfig`, `setLogLevel`, and `clearHarnessRunTag` first
 * (see `adapters/pi/hooks.ts` session_start order).
 */

import { discoverWorkItems } from "../telemetry/usage.js";
import type { HarnessMutableState } from "./types.js";

export interface HarnessCostSeed {
  costCache: Map<string, number>;
  activeWorkItem: string | null;
  sessionCost: number;
}

export function seedHarnessSessionCostState(): HarnessCostSeed {
  const costCache = new Map<string, number>();
  const items = discoverWorkItems();
  for (const item of items) {
    costCache.set(item.id, item.cost_usd);
  }
  if (items.length === 1) {
    return { costCache, activeWorkItem: items[0].id, sessionCost: items[0].cost_usd };
  }
  return { costCache, activeWorkItem: null, sessionCost: 0 };
}

export function applyHarnessCostSeed(state: HarnessMutableState, seed: HarnessCostSeed): void {
  state.costCache = seed.costCache;
  state.activeWorkItem = seed.activeWorkItem;
  state.sessionCost = seed.sessionCost;
}
