/**
 * Host-neutral harness types — Pi, Cursor hooks, or CI can supply a HarnessHost.
 */

import type { DevHarnessConfig } from "../config/index.js";

/** Optional UI / session callbacks for steps that are not pure file+JSON logic. */
export interface HarnessHost {
  notify?(level: "info" | "warning", message: string): void;
  /** When omitted, implementations should treat as `Promise.resolve(true)`. */
  confirm?(title: string, body: string): Promise<boolean>;
  syncHarnessRunMeta?(): void;
  refreshUi?(): void;
}

/** Subset of Pi hook state the harness mutates for usage accounting. */
export interface HarnessMutableState {
  devConfig: DevHarnessConfig | null;
  costCache: Map<string, number>;
  sessionCost: number;
  activeWorkItem: string | null;
}

/** Bounded dedup for orchestrator turn_end usage rows (session replay). */
export interface OrchestratorUsageDedup {
  queue: string[];
  seen: Set<string>;
}

export const ORCHESTRATOR_FP_CAP = 400;
