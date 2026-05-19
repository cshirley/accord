/**
 * Orchestration policy — caps, severity routing (Phase 3 expands; D2 uses task file counters).
 */

import type { DevHarnessConfig } from "../config/types.js";

/** Default max respawns for adversarial test↔review loops before forcing user / skill. */
export const DEFAULT_MAX_QUICK_FIX_TEST_REVIEW_LOOPS = 5;

/** Default max retries when **review-test** or **review-code** reports critical findings. */
export const DEFAULT_MAX_CRITICAL_REVIEW_RETRIES = 3;

/** Default max gather retries when sources flap (future; hooks own gather today). */
export const DEFAULT_MAX_GATHER_ATTEMPTS = 3;

export type PolicySeverityGate = "none" | "warn" | "block";

export interface QuickFixLoopPolicy {
  maxTestReviewLoops: number;
  /** When `review-test` reports this severity or higher, consume a retry slot. */
  severityGate: PolicySeverityGate;
}

const SEVERITY_GATES: ReadonlySet<PolicySeverityGate> = new Set(["none", "warn", "block"]);

export function defaultQuickFixLoopPolicy(): QuickFixLoopPolicy {
  return {
    maxTestReviewLoops: DEFAULT_MAX_QUICK_FIX_TEST_REVIEW_LOOPS,
    severityGate: "warn",
  };
}

/**
 * Resolves `QuickFixLoopPolicy` from the Dev Harness `orchestration.quick_fix_loop` block
 * (AGENTS.md fenced JSON / project `accord.json` shape), falling back to `defaultQuickFixLoopPolicy`
 * for any missing or invalid field.
 */
export function quickFixLoopPolicyFromDevConfig(
  config: DevHarnessConfig | null | undefined,
): QuickFixLoopPolicy {
  const base = defaultQuickFixLoopPolicy();
  const raw = config?.orchestration?.quick_fix_loop;
  if (!raw || typeof raw !== "object") {
    return base;
  }

  let maxTestReviewLoops = base.maxTestReviewLoops;
  const maxRaw = raw.max_test_review_loops;
  if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) {
    const floored = Math.floor(maxRaw);
    if (floored >= 0) {
      maxTestReviewLoops = floored;
    }
  }

  let severityGate = base.severityGate;
  const gateRaw = raw.severity_gate;
  if (typeof gateRaw === "string" && SEVERITY_GATES.has(gateRaw as PolicySeverityGate)) {
    severityGate = gateRaw as PolicySeverityGate;
  }

  return { maxTestReviewLoops, severityGate };
}

export interface ImplementCodeReviewPolicy {
  /**
   * Legacy config fields — **review-code** is always enqueued after **phase-code** when mandatory
   * review gates are on ({@link mandatoryReviewGatesEnabled}). These flags are ignored for routing.
   */
  codeReviewOnChallenge: boolean;
  codeReviewOnReviewsRequested: boolean;
}

/** Harness always runs adversarial **review-test** (pre-impl) and **review-code** (post-impl) per task. */
export function mandatoryReviewGatesEnabled(): boolean {
  return true;
}

export function defaultImplementCodeReviewPolicy(): ImplementCodeReviewPolicy {
  return {
    codeReviewOnChallenge: true,
    codeReviewOnReviewsRequested: true,
  };
}

/**
 * Optional **implement** pipeline gates from `orchestration.implement_loop` in Dev Harness JSON.
 */
export function implementCodeReviewPolicyFromDevConfig(
  config: DevHarnessConfig | null | undefined,
): ImplementCodeReviewPolicy {
  const base = defaultImplementCodeReviewPolicy();
  const raw = config?.orchestration?.implement_loop;
  if (!raw || typeof raw !== "object") {
    return base;
  }

  let codeReviewOnChallenge = base.codeReviewOnChallenge;
  const ch = raw.code_review_on_challenge;
  if (typeof ch === "boolean") {
    codeReviewOnChallenge = ch;
  }

  let codeReviewOnReviewsRequested = base.codeReviewOnReviewsRequested;
  const rr = raw.code_review_on_reviews_requested;
  if (typeof rr === "boolean") {
    codeReviewOnReviewsRequested = rr;
  }

  return { codeReviewOnChallenge, codeReviewOnReviewsRequested };
}

export interface CriticalReviewLoopPolicy {
  maxCriticalRetries: number;
}

export function defaultCriticalReviewLoopPolicy(): CriticalReviewLoopPolicy {
  return { maxCriticalRetries: DEFAULT_MAX_CRITICAL_REVIEW_RETRIES };
}

/**
 * Caps for critical-finding retries on **review-test** → **phase-test** and **review-code** → **phase-code**.
 * Falls back to `quick_fix_loop.max_test_review_loops` when `review_loop` is omitted.
 */
/**
 * Harness subagents that must not be started via the resume replan loop in the same
 * `/dev resume` after an earlier spawn (user runs `/dev resume` again for implementation).
 */
export const RESUME_NO_AUTO_CHAIN_AGENTS: ReadonlySet<string> = new Set(["phase-code"]);

export function resumeAllowsAutoReplanToAgent(agent: string): boolean {
  return !RESUME_NO_AUTO_CHAIN_AGENTS.has(agent);
}

export function criticalReviewLoopPolicyFromDevConfig(
  config: DevHarnessConfig | null | undefined,
): CriticalReviewLoopPolicy {
  const base = defaultCriticalReviewLoopPolicy();
  const raw = config?.orchestration?.review_loop;
  if (raw && typeof raw === "object") {
    const maxRaw = raw.max_critical_retries;
    if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) {
      const floored = Math.floor(maxRaw);
      if (floored >= 0) {
        return { maxCriticalRetries: floored };
      }
    }
  }

  const qf = config?.orchestration?.quick_fix_loop?.max_test_review_loops;
  if (typeof qf === "number" && Number.isFinite(qf)) {
    const floored = Math.floor(qf);
    if (floored >= 0) {
      return { maxCriticalRetries: floored };
    }
  }

  return base;
}
