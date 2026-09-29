/**
 * Loop decisions from the v2 findings ledger: advance, retry (consume a slot), or block.
 */

import type { DevHarnessConfig } from "../config/types.js";
import {
  reviewRetryPolicyForAgent,
  rgrRespawnPolicyFromDevConfig,
  verifyLoopPolicyFromDevConfig,
} from "../orchestration/policy.js";
import { gatingFindings } from "./model.js";
import type { LoopKind, RetryCounter, TaskFileV2, TaskRetries } from "./types.js";

export interface LoopCap {
  maxRetries: number;
  maxLifetimeRetries: number;
}

export type LoopDecision =
  | { kind: "advance"; gating: string[] }
  | { kind: "retry"; gating: string[] }
  | { kind: "blocked"; gating: string[]; reason: string; lifetime: boolean };

export type RetryKey = keyof Omit<TaskRetries, "unblocks">;

export const RETRY_KEY_FOR_LOOP: Record<LoopKind, RetryKey> = {
  T: "test_review",
  C: "code_review",
  V: "verify",
};

const LOOP_LABEL: Record<RetryKey, string> = {
  test_review: "Review-test",
  code_review: "Review-code",
  verify: "Verify",
  rgr: "phase-code → phase-test RGR",
};

export function capForKey(
  key: RetryKey,
  devConfig: DevHarnessConfig | null | undefined,
  pattern: string,
): LoopCap & { severityGate?: "none" | "warn" | "block" } {
  if (key === "test_review") return reviewRetryPolicyForAgent(devConfig, pattern, "review-test");
  if (key === "code_review") return reviewRetryPolicyForAgent(devConfig, pattern, "review-code");
  if (key === "verify") {
    const policy = verifyLoopPolicyFromDevConfig(devConfig);
    return { maxRetries: policy.maxRetries, maxLifetimeRetries: policy.maxLifetimeRetries };
  }
  const rgr = rgrRespawnPolicyFromDevConfig(devConfig);
  return { maxRetries: rgr.maxRespawns, maxLifetimeRetries: rgr.maxLifetimeRespawns };
}

/** Decide whether another round of `key` may run, given `counter` and `cap`. */
export function capCheck(
  key: RetryKey,
  counter: RetryCounter,
  cap: LoopCap,
  unblocks: number,
): { ok: true } | { ok: false; reason: string; lifetime: boolean } {
  const label = LOOP_LABEL[key];
  if (counter.lifetime >= cap.maxLifetimeRetries) {
    return {
      ok: false,
      lifetime: true,
      reason: `${label} LIFETIME retry cap reached (${String(cap.maxLifetimeRetries)} across ${String(unblocks)} unblock(s))`,
    };
  }
  if (counter.used >= cap.maxRetries) {
    return {
      ok: false,
      lifetime: false,
      reason: `${label} retry cap reached (${String(cap.maxRetries)})`,
    };
  }
  return { ok: true };
}

/** After a loop's reviewer/verifier returned: gate on findings owned by `loop`. */
export function decideLoop(
  task: TaskFileV2,
  loop: LoopKind,
  cap: LoopCap,
  extraReason?: string,
): LoopDecision {
  const gating = gatingFindings(task, [loop]).map(({ finding }) => finding.id);
  if (gating.length === 0) return { kind: "advance", gating };
  const key = RETRY_KEY_FOR_LOOP[loop];
  const check = capCheck(key, task.control.retries[key], cap, task.control.retries.unblocks);
  if (!check.ok) {
    return {
      kind: "blocked",
      gating,
      reason: extraReason ? `${check.reason}; ${extraReason}` : check.reason,
      lifetime: check.lifetime,
    };
  }
  return { kind: "retry", gating };
}

export function bumpRetry(task: TaskFileV2, key: RetryKey): RetryCounter {
  const counter = task.control.retries[key];
  counter.used += 1;
  counter.lifetime += 1;
  return counter;
}
