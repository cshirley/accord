/**
 * Subagent spawn preflight — credentials, model profile, agent file, timeout.
 *
 * Used by `dev_subagent_preflight` and resume orchestration before phase spawns.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  loadSubagentConfig,
  resolveAgentFile,
  resolveModelConfig,
  resolveProfileForCredentials,
  type SubagentConfig,
} from "../../../packages/pi-subagent/src/agents.js";
import {
  DEFAULT_SPAWN_TIMEOUT_MS,
  resolveSpawnTimeoutMs,
} from "../../../packages/pi-subagent/src/spawn/timeout.js";
import { getAgentMeta } from "../agents/registry.js";

/** Registry agents that should pass credential preflight before harness spawn. */
export const SUBAGENT_SPAWN_PREFLIGHT_AGENTS = new Set([
  "phase-align",
  "phase-spec",
  "phase-plan",
  "phase-gather",
  "phase-test",
  "phase-code",
  "review-test",
  "review-code",
]);

export function agentRequiresSpawnPreflight(agent: string): boolean {
  return SUBAGENT_SPAWN_PREFLIGHT_AGENTS.has(agent);
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
  blocks: string[];
  warnings: string[];
  formatted: string;
}

function hasCursorAgentCredentials(): boolean {
  return Boolean(process.env.CURSOR_API_KEY || process.env.CURSOR_ACCESS_TOKEN);
}

function findCursorAgentProfileName(cfg: SubagentConfig): string | null {
  if (cfg.profiles["cursor-claude"]?.provider === "cursor-agent") {
    return "cursor-claude";
  }
  for (const [name, profile] of Object.entries(cfg.profiles)) {
    if (profile.provider === "cursor-agent") return name;
  }
  return null;
}

function evaluateCredentials(
  provider: string,
  requestedProfile: string,
  effectiveProfile: string,
  cfg: SubagentConfig,
): { ok: boolean; blocks: string[]; warnings: string[] } {
  const blocks: string[] = [];
  const warnings: string[] = [];

  if (provider === "anthropic") {
    if (process.env.ANTHROPIC_API_KEY) {
      return { ok: true, blocks, warnings };
    }
    const cursorProfile = findCursorAgentProfileName(cfg);
    if (cursorProfile && hasCursorAgentCredentials() && effectiveProfile === cursorProfile) {
      warnings.push(
        `Profile "${requestedProfile}" targets Anthropic but ANTHROPIC_API_KEY is unset; runtime will use "${effectiveProfile}" (cursor-agent).`,
      );
      return { ok: true, blocks, warnings };
    }
    blocks.push(
      "ANTHROPIC_API_KEY is unset and no Cursor credentials are available for fallback. " +
        "Subagent will hang until spawn timeout. Set ANTHROPIC_API_KEY or configure cursor-agent credentials.",
    );
    return { ok: false, blocks, warnings };
  }

  if (provider === "cursor-agent") {
    if (hasCursorAgentCredentials()) {
      return { ok: true, blocks, warnings };
    }
    blocks.push(
      "CURSOR_API_KEY or CURSOR_ACCESS_TOKEN is required for cursor-agent. Subagent will hang until spawn timeout.",
    );
    return { ok: false, blocks, warnings };
  }

  warnings.push(`Credential preflight does not validate provider "${provider}" — verify manually.`);
  return { ok: true, blocks, warnings };
}

function formatPreflightReport(check: SubagentPreflightCheck): string {
  const lines: string[] = [
    `Subagent preflight: ${check.agent}`,
    `  ok: ${check.ok}`,
    `  profile: ${check.profile} → ${check.effective_profile} (${check.provider}${check.model ? ` / ${check.model}` : ""})`,
    `  spawn_timeout_ms: ${String(check.spawn_timeout_ms)}`,
    `  agent_file: ${check.agent_file_found ? check.agent_file_path : "NOT FOUND"}`,
    `  registry: ${check.in_registry ? "yes" : "no"}`,
  ];
  for (const w of check.warnings) {
    lines.push(`  ⚠ ${w}`);
  }
  for (const b of check.blocks) {
    lines.push(`  ✗ ${b}`);
  }
  return lines.join("\n");
}

/**
 * Validate subagent configuration for a single dispatch agent before spawn.
 */
export function runSubagentSpawnPreflightCheck(
  agent: string,
  cwd: string = process.cwd(),
): SubagentPreflightCheck {
  const cfg = loadSubagentConfig();
  const requestedProfile = cfg.activeProfile ?? cfg.defaultProfile;
  const effectiveProfile = resolveProfileForCredentials(cfg, requestedProfile);
  const profileDef = cfg.profiles[effectiveProfile] ?? cfg.profiles[cfg.defaultProfile];
  const provider = profileDef?.provider ?? "unknown";

  const agentPath = resolveAgentFile(agent, cwd, "user");
  const bundledAccordPath = path.join(process.cwd(), "assets", "agents", "accord", `${agent}.md`);
  const agentFileFound =
    Boolean(agentPath && existsSync(agentPath)) || existsSync(bundledAccordPath);
  const agentFilePath =
    agentPath && existsSync(agentPath)
      ? agentPath
      : existsSync(bundledAccordPath)
        ? bundledAccordPath
        : null;

  const stubAgent = {
    name: agent,
    description: agent,
    tier: "workhorse" as const,
    systemPrompt: "",
    source: "user" as const,
    filePath: agentFilePath ?? "",
  };
  const resolvedModel = resolveModelConfig(stubAgent, cfg);
  const model = resolvedModel?.model ?? null;
  const resolvedProvider = resolvedModel?.provider ?? provider;

  const cred = evaluateCredentials(resolvedProvider, requestedProfile, effectiveProfile, cfg);
  const inRegistry = Boolean(getAgentMeta(agent));
  const blocks = [...cred.blocks];
  const warnings = [...cred.warnings];

  if (!agentFileFound) {
    blocks.push(
      `Agent markdown not found for "${agent}". Expected under Pi agent dir or assets/agents/accord/${agent}.md.`,
    );
  }
  if (!inRegistry) {
    warnings.push(
      `Agent "${agent}" is not in the ACCORD registry — schema injection and post-result hooks may be skipped.`,
    );
  }

  const spawnTimeoutMs = resolveSpawnTimeoutMs(undefined, cfg) ?? DEFAULT_SPAWN_TIMEOUT_MS;

  const check: SubagentPreflightCheck = {
    ok: blocks.length === 0,
    agent,
    profile: requestedProfile,
    effective_profile: effectiveProfile,
    provider: resolvedProvider,
    model,
    spawn_timeout_ms: spawnTimeoutMs,
    agent_file_found: agentFileFound,
    agent_file_path: agentFilePath,
    in_registry: inRegistry,
    credential_ok: cred.ok,
    blocks,
    warnings,
    formatted: "",
  };
  check.formatted = formatPreflightReport(check);
  return check;
}

/** MCP/tool entry — optional agent defaults to phase-plan. */
export function devSubagentPreflight(agent?: string, cwd?: string): SubagentPreflightCheck {
  const target = agent?.trim() || "phase-plan";
  return runSubagentSpawnPreflightCheck(target, cwd ?? process.cwd());
}
