/**
 * Host-neutral subagent spawn preflight types and optional backend registration.
 */

export const SUBAGENT_SPAWN_PREFLIGHT_AGENTS = new Set([
  "phase-align",
  "phase-spec",
  "phase-plan",
  "phase-gather",
  "phase-test",
  "phase-code",
  "review-test",
  "review-code",
  "review-security",
]);

export function agentRequiresSpawnPreflight(agent: string): boolean {
  return SUBAGENT_SPAWN_PREFLIGHT_AGENTS.has(agent);
}

export interface SubagentPreflightScopedModel {
  provider: string;
  modelId: string;
  thinkingLevel?: string;
}

export interface SubagentPreflightHostHints {
  scoped_models?: SubagentPreflightScopedModel[];
  judgment_model?: { provider: string; model: string } | null;
}

export interface SubagentPreflightCheck {
  ok: boolean;
  agent: string;
  profile: string;
  effective_profile: string;
  provider: string;
  model: string | null;
  spawn_timeout_ms: number;
  agent_file_found: boolean;
  agent_file_path: string | null;
  in_registry: boolean;
  credential_ok: boolean;
  scoped_models: SubagentPreflightScopedModel[];
  judgment_model: { provider: string; model: string } | null;
  blocks: string[];
  warnings: string[];
  formatted: string;
}

export type SpawnPreflightCheckFn = (
  agent: string,
  cwd?: string,
  hints?: SubagentPreflightHostHints,
) => SubagentPreflightCheck;

let spawnPreflightCheckImpl: SpawnPreflightCheckFn | null = null;

export function registerSpawnPreflightCheck(fn: SpawnPreflightCheckFn): void {
  spawnPreflightCheckImpl = fn;
}

function permissiveCheck(agent: string): SubagentPreflightCheck {
  return {
    ok: true,
    agent,
    profile: "default",
    effective_profile: "default",
    provider: "unknown",
    model: null,
    spawn_timeout_ms: 0,
    agent_file_found: true,
    agent_file_path: null,
    in_registry: true,
    credential_ok: true,
    scoped_models: [],
    judgment_model: null,
    blocks: [],
    warnings: [],
    formatted: `Subagent preflight skipped for ${agent} (no host backend registered).`,
  };
}

export function runSubagentSpawnPreflightCheck(
  agent: string,
  cwd: string = process.cwd(),
  hints?: SubagentPreflightHostHints,
): SubagentPreflightCheck {
  if (!spawnPreflightCheckImpl) {
    return permissiveCheck(agent);
  }
  return spawnPreflightCheckImpl(agent, cwd, hints);
}
