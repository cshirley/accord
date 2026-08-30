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

export type ReviewLoopAgent = "review-test" | "review-code";

const SEVERITY_RANK: Record<string, number> = {
  suggestion: 1,
  warning: 2,
  critical: 3,
};

/** Highest numeric rank among finding severities (0 when there are no findings). */
export function maxFindingSeverityRank(findings: ReadonlyArray<{ severity?: string }>): number {
  let maxRank = 0;
  for (const finding of findings) {
    const rank = SEVERITY_RANK[finding.severity ?? ""] ?? 0;
    if (rank > maxRank) maxRank = rank;
  }
  return maxRank;
}

/**
 * When `review-test` or `review-code` verdict is `issues`, only findings at or above `gate`
 * consume a retry slot (`none` = any finding).
 */
export function findingsTriggerReviewRetry(
  findings: ReadonlyArray<{ severity?: string }>,
  gate: PolicySeverityGate,
): boolean {
  if (gate === "none") {
    return findings.length > 0;
  }
  const maxRank = maxFindingSeverityRank(findings);
  if (gate === "warn") {
    return maxRank >= SEVERITY_RANK.warning;
  }
  if (gate === "block") {
    return maxRank >= SEVERITY_RANK.critical;
  }
  return true;
}

export function severityGateRemediationLabel(gate: PolicySeverityGate): string {
  if (gate === "none") {
    return "all reported findings";
  }
  if (gate === "warn") {
    return "warning-or-critical findings";
  }
  return "critical findings";
}

export interface ResolvedReviewRetryPolicy {
  severityGate: PolicySeverityGate;
  maxRetries: number;
}

export function defaultReviewLoopPolicy(): ResolvedReviewRetryPolicy {
  return {
    severityGate: "block",
    maxRetries: DEFAULT_MAX_CRITICAL_REVIEW_RETRIES,
  };
}

function parseSeverityGate(raw: unknown, fallback: PolicySeverityGate): PolicySeverityGate {
  if (typeof raw === "string" && SEVERITY_GATES.has(raw as PolicySeverityGate)) {
    return raw as PolicySeverityGate;
  }
  return fallback;
}

/**
 * Per-repo retry policy for **review-test** / **review-code** post-result routing.
 * Quick-fix **review-test** uses `orchestration.quick_fix_loop`; implement (and quick-fix **review-code**) use `orchestration.review_loop`.
 */
export function reviewRetryPolicyForAgent(
  config: DevHarnessConfig | null | undefined,
  pattern: string,
  agent: ReviewLoopAgent,
): ResolvedReviewRetryPolicy {
  if (pattern === "quick_fix" && agent === "review-test") {
    const qf = quickFixLoopPolicyFromDevConfig(config);
    return { severityGate: qf.severityGate, maxRetries: qf.maxTestReviewLoops };
  }

  const base = defaultReviewLoopPolicy();
  let severityGate = base.severityGate;
  let maxRetries = base.maxRetries;
  const raw = config?.orchestration?.review_loop;
  if (raw && typeof raw === "object") {
    if (raw.severity_gate !== undefined) {
      severityGate = parseSeverityGate(raw.severity_gate, severityGate);
    }
    const maxRaw = raw.max_critical_retries;
    if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) {
      maxRetries = Math.max(0, Math.floor(maxRaw));
    }
    const agentRaw = agent === "review-test" ? raw.review_test : raw.review_code;
    if (agentRaw && typeof agentRaw === "object") {
      if (agentRaw.severity_gate !== undefined) {
        severityGate = parseSeverityGate(agentRaw.severity_gate, severityGate);
      }
      const agentMax = agentRaw.max_retries;
      if (typeof agentMax === "number" && Number.isFinite(agentMax)) {
        maxRetries = Math.max(0, Math.floor(agentMax));
      }
    }
  }

  return { severityGate, maxRetries };
}

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
/** Default agents that pause the resume replan loop before the next spawn. */
export const DEFAULT_RESUME_NO_AUTO_CHAIN_AGENTS: readonly string[] = ["phase-code"];

export const DEFAULT_MAX_SEQUENTIAL_RESUME_SPAWNS = 8;

export interface ResumeReplanPolicy {
  noAutoChainAgents: ReadonlySet<string>;
  maxSequentialSpawns: number;
}

export function defaultResumeReplanPolicy(): ResumeReplanPolicy {
  return {
    noAutoChainAgents: new Set(DEFAULT_RESUME_NO_AUTO_CHAIN_AGENTS),
    maxSequentialSpawns: DEFAULT_MAX_SEQUENTIAL_RESUME_SPAWNS,
  };
}

/**
 * Resolves resume replan caps from `orchestration.resume` in Dev Harness JSON.
 */
export function resumeReplanPolicyFromDevConfig(
  config: DevHarnessConfig | null | undefined,
): ResumeReplanPolicy {
  const base = defaultResumeReplanPolicy();
  const raw = config?.orchestration?.resume;
  if (!raw || typeof raw !== "object") {
    return base;
  }

  let noAutoChainAgents = base.noAutoChainAgents;
  const agentsRaw = raw.no_auto_chain_agents;
  if (Array.isArray(agentsRaw)) {
    const ids = agentsRaw.filter((a): a is string => typeof a === "string" && a.length > 0);
    noAutoChainAgents = new Set(ids);
  }

  let maxSequentialSpawns = base.maxSequentialSpawns;
  const maxRaw = raw.max_sequential_spawns;
  if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) {
    const floored = Math.floor(maxRaw);
    if (floored >= 1) {
      maxSequentialSpawns = floored;
    }
  }

  return { noAutoChainAgents, maxSequentialSpawns };
}

/** @deprecated Use {@link resumeReplanPolicyFromDevConfig} + {@link resumeAllowsAutoReplanToAgent}. */
export const RESUME_NO_AUTO_CHAIN_AGENTS: ReadonlySet<string> = new Set(
  DEFAULT_RESUME_NO_AUTO_CHAIN_AGENTS,
);

export function resumeAllowsAutoReplanToAgent(
  agent: string,
  config?: DevHarnessConfig | null,
): boolean {
  const policy = resumeReplanPolicyFromDevConfig(config ?? null);
  return !policy.noAutoChainAgents.has(agent);
}

export function commitOnTaskDoneFromDevConfig(
  config: DevHarnessConfig | null | undefined,
): boolean {
  return config?.orchestration?.commit?.on_task_done !== false;
}

/** @deprecated Use {@link reviewRetryPolicyForAgent} for severity gate + cap. */
export function criticalReviewLoopPolicyFromDevConfig(
  config: DevHarnessConfig | null | undefined,
): CriticalReviewLoopPolicy {
  const policy = reviewRetryPolicyForAgent(config, "implement", "review-test");
  return { maxCriticalRetries: policy.maxRetries };
}
