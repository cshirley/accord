/**
 * Agent registry — single source of truth for per-agent metadata.
 *
 * Every agent's capabilities, requirements, and schema mappings are
 * defined here. Hooks, tools, and brief injection all read from this.
 */

export interface AgentMeta {
  /** Schemas to inject into the agent's brief (paths relative to schemas/). */
  schemas: string[];
  /** Agent requires devConfig to function (blocked if absent). */
  requiresConfig: boolean;
  /** Run verification commands after this agent completes. */
  verifyAfter: boolean;
  /** Config guard deferred to hook 4 (verify preflight handles these with staleness checks). */
  deferConfigGuard: boolean;
}

/**
 * Registry keyed by agent name (as used in subagent calls).
 * Agents not listed here get no schema injection, no config guard,
 * and no post-code verification.
 */
const REGISTRY: Record<string, AgentMeta> = {
  // ── Phase agents ───────────────────────────────────
  "phase-gather": {
    schemas: ["work-item-schema.json", "return-schemas/phase-gather.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-align": {
    schemas: ["work-item-schema.json", "checkpoint-schema.json", "return-schemas/phase-align.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-explore": {
    schemas: ["spec-schema.json", "return-schemas/phase-explore.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-spec": {
    schemas: ["spec-schema.json", "checkpoint-schema.json", "return-schemas/phase-spec.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-plan": {
    schemas: ["spec-schema.json", "plan-schema.json", "return-schemas/phase-plan.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-code": {
    schemas: ["task-schema.json", "return-schemas/phase-code.json"],
    requiresConfig: true, verifyAfter: true, deferConfigGuard: false,
  },
  "phase-verify-acceptance": {
    schemas: ["verify-schema.json", "spec-schema.json", "return-schemas/phase-verify-acceptance.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: true,
  },
  "phase-verify-infra": {
    schemas: ["verify-schema.json", "return-schemas/phase-verify-infra.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: true,
  },
  "phase-gaps": {
    schemas: ["verify-schema.json", "spec-schema.json", "return-schemas/phase-gaps.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-hypothesise": {
    schemas: ["return-schemas/phase-hypothesise.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "phase-test": {
    schemas: ["spec-schema.json", "task-schema.json", "return-schemas/phase-test.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },

  // ── Review agents ──────────────────────────────────
  "review-code": {
    schemas: ["spec-schema.json", "plan-schema.json", "return-schemas/review.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "review-test": {
    schemas: ["spec-schema.json", "return-schemas/review.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "review-plan": {
    schemas: ["spec-schema.json", "plan-schema.json", "return-schemas/review.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "review-deviation": {
    schemas: ["plan-schema.json", "return-schemas/review.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "review-spec": {
    schemas: ["spec-schema.json", "return-schemas/review.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "review-security": {
    schemas: ["spec-schema.json", "return-schemas/review.json"],
    requiresConfig: true, verifyAfter: false, deferConfigGuard: false,
  },
  "review-design": {
    schemas: ["return-schemas/review.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
  "review-investigation": {
    schemas: ["return-schemas/review.json"],
    requiresConfig: false, verifyAfter: false, deferConfigGuard: false,
  },
};

// ── Public API ─────────────────────────────────────────────

export function getAgentMeta(agentName: string): AgentMeta | undefined {
  return REGISTRY[agentName];
}

export function agentRequiresConfig(agentName: string): boolean {
  return REGISTRY[agentName]?.requiresConfig ?? false;
}

export function agentRequiresVerification(agentName: string): boolean {
  return REGISTRY[agentName]?.verifyAfter ?? false;
}

export function agentDefersConfigGuard(agentName: string): boolean {
  return REGISTRY[agentName]?.deferConfigGuard ?? false;
}

export function agentSchemas(agentName: string): string[] {
  return REGISTRY[agentName]?.schemas ?? [];
}

export function registeredAgentNames(): string[] {
  return Object.keys(REGISTRY).sort();
}

/**
 * Convention: any agent named review-* is a review agent.
 * Used by validate.ts to pick the shared review return schema
 * and normalise findings.
 */
export function isReviewAgent(agentName: string): boolean {
  return agentName.startsWith("review-");
}
