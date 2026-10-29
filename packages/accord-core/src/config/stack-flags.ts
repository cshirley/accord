import type { DevHarnessConfig } from "./types.js";

export type ReviewSecurityGate = "advisory" | "none" | "warn" | "block";

export type ResolvedStackConfig = {
  enabled: boolean;
  commits: "task" | "phase";
  provider: "git" | "gh" | "graphite" | "spr";
  state: {
    persist: "tree" | "notes" | "none";
    path: string;
    redact: boolean;
    max_bytes: number;
  };
  sizing: {
    max_pr_lines: number;
    min_pr_lines: number;
    max_files: number;
    max_depth: number;
    overrun_factor: number;
  };
};

export type ResolvedKnowledgeConfig = {
  enabled: boolean;
  root: string;
  drift_check: "off" | "warn" | "block";
  max_acs_per_feature: number;
};

export function resolveStackConfig(
  config: DevHarnessConfig | null | undefined,
): ResolvedStackConfig {
  const stack = config?.stack;
  return {
    ...(stack ?? {}),
    enabled: stack?.enabled ?? false,
    commits: stack?.commits ?? "task",
    provider: stack?.provider ?? "gh",
    state: {
      persist: stack?.state?.persist ?? "tree",
      path: stack?.state?.path ?? "docs/dev/{id}/state",
      redact: stack?.state?.redact ?? true,
      max_bytes: stack?.state?.max_bytes ?? 262144,
    },
    sizing: {
      ...(stack?.sizing ?? {}),
      max_pr_lines: stack?.sizing?.max_pr_lines ?? 400,
      min_pr_lines: stack?.sizing?.min_pr_lines ?? 30,
      max_files: stack?.sizing?.max_files ?? 10,
      max_depth: stack?.sizing?.max_depth ?? 6,
      overrun_factor: stack?.sizing?.overrun_factor ?? 1.5,
    },
  };
}

export function resolveKnowledgeConfig(
  config: DevHarnessConfig | null | undefined,
): ResolvedKnowledgeConfig {
  const knowledge = config?.knowledge;
  return {
    ...(knowledge ?? {}),
    enabled: knowledge?.enabled ?? false,
    root: knowledge?.root ?? "docs/features",
    drift_check: knowledge?.drift_check ?? "warn",
    max_acs_per_feature: knowledge?.max_acs_per_feature ?? 12,
  };
}

export function resolveReviewSecurityGate(
  config: DevHarnessConfig | null | undefined,
): ReviewSecurityGate {
  const explicit = config?.orchestration?.review_loop?.review_security?.severity_gate;
  if (explicit) return explicit;
  return config?.stack?.enabled === true ? "warn" : "advisory";
}
