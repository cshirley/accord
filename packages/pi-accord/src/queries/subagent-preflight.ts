/**
 * Subagent spawn preflight — credentials, model profile, agent file, timeout.
 *
 * Pi/subagent backend for {@link registerSpawnPreflightCheck} in accord-core.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import { getAgentMeta } from "@clive.shirley/accord-core/agents/registry.js";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { AGENTS_ACCORD_DIR } from "@clive.shirley/accord-core/config/paths.js";
import {
  applyScopedPreflightWarnings,
  resolveJudgmentModelRefFromHarness,
} from "@clive.shirley/accord-core/queries/subagent-preflight-scoped.js";
import {
  registerSpawnPreflightCheck,
  type SubagentPreflightCheck,
  type SubagentPreflightHostHints,
} from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import { loadAgentFromFile } from "../../../pi-subagent/src/agent-load.js";
import {
  type AgentConfig,
  CURSOR_PROVIDER,
  findCursorProfileName,
  hasAnthropicCredentials,
  hasCursorCredentials,
  loadSubagentConfig,
  resolveAgentFile,
  resolveModelConfig,
  resolveProfileForCredentials,
  resolveRequestedProfileName,
  type SubagentConfig,
} from "../../../pi-subagent/src/agents.js";
import {
  DEFAULT_SPAWN_TIMEOUT_MS,
  resolveSpawnTimeoutMs,
} from "../../../pi-subagent/src/spawn/timeout.js";

export { resolveJudgmentModelRefFromHarness } from "@clive.shirley/accord-core/queries/subagent-preflight-scoped.js";
export {
  agentRequiresSpawnPreflight,
  SUBAGENT_SPAWN_PREFLIGHT_AGENTS,
  type SubagentPreflightCheck,
  type SubagentPreflightHostHints,
} from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";

function evaluateCredentials(
  provider: string,
  requestedProfile: string,
  effectiveProfile: string,
  cfg: SubagentConfig,
): { ok: boolean; blocks: string[]; warnings: string[] } {
  const blocks: string[] = [];
  const warnings: string[] = [];

  if (provider === "anthropic") {
    // Accept either a raw ANTHROPIC_API_KEY or Pi's own stored OAuth/session credential
    // (~/.config/pi/agent/auth.json). Pi-subscription users authenticate via OAuth and never
    // set ANTHROPIC_API_KEY, so checking the env var alone is a false negative for them.
    if (hasAnthropicCredentials()) {
      return { ok: true, blocks, warnings };
    }
    // resolveModelConfig/resolveProfileForCredentials now throw on this mismatch instead of
    // silently swapping to Cursor — mirror that here as a hard block rather than a warning.
    const cursorProfile = findCursorProfileName(cfg);
    if (cursorProfile) {
      blocks.push(
        `Profile "${requestedProfile}" targets Anthropic but no Anthropic credentials were found ` +
          `(ANTHROPIC_API_KEY unset and no stored Pi OAuth/session credential). Runtime will throw ` +
          `rather than silently use "${cursorProfile}" (${CURSOR_PROVIDER}). Log in to Pi's Anthropic ` +
          `account, set ANTHROPIC_API_KEY, or explicitly set activeProfile/reviewProfile/skills.*.profile ` +
          `to "${cursorProfile}" in subagent.json.`,
      );
      return { ok: false, blocks, warnings };
    }
    blocks.push(
      "No Anthropic credentials found (ANTHROPIC_API_KEY unset, no Pi OAuth/session credential) and no " +
        "Cursor credentials are available for fallback. Subagent will hang until spawn timeout. Log in to " +
        "Pi's Anthropic account, set ANTHROPIC_API_KEY, or log in to Cursor.",
    );
    return { ok: false, blocks, warnings };
  }

  if (provider === "openai") {
    if (process.env.OPENAI_API_KEY) {
      return { ok: true, blocks, warnings };
    }
    blocks.push(
      "OPENAI_API_KEY is unset. Subagent will hang or fail for openai provider. Set OPENAI_API_KEY.",
    );
    return { ok: false, blocks, warnings };
  }

  if (provider === CURSOR_PROVIDER) {
    if (hasCursorCredentials()) {
      return { ok: true, blocks, warnings };
    }
    blocks.push(
      "No Cursor credentials found. Set CURSOR_API_KEY or CURSOR_ACCESS_TOKEN, or log in to Cursor. " +
        "Subagent will hang until spawn timeout.",
    );
    return { ok: false, blocks, warnings };
  }

  warnings.push(`Credential preflight does not validate provider "${provider}" — verify manually.`);
  return { ok: true, blocks, warnings };
}

function inferAgentNamespace(agentFilePath: string): string | undefined {
  const parts = agentFilePath.split(path.sep);
  const agentsIdx = parts.lastIndexOf("agents");
  if (agentsIdx >= 0 && agentsIdx + 2 < parts.length) {
    return parts[agentsIdx + 1];
  }
  return undefined;
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
  if (check.judgment_model) {
    lines.push(`  judgment_model: ${check.judgment_model.provider}/${check.judgment_model.model}`);
  }
  if (check.scoped_models.length > 0) {
    const scopedSummary = check.scoped_models
      .map((entry) =>
        entry.thinkingLevel
          ? `${entry.provider}/${entry.modelId}:${entry.thinkingLevel}`
          : `${entry.provider}/${entry.modelId}`,
      )
      .join(", ");
    lines.push(`  scoped_models: ${scopedSummary}`);
  }
  for (const warning of check.warnings) {
    lines.push(`  ⚠ ${warning}`);
  }
  for (const block of check.blocks) {
    lines.push(`  ✗ ${block}`);
  }
  return lines.join("\n");
}

export function runSubagentSpawnPreflightCheck(
  agent: string,
  cwd: string = process.cwd(),
  hints?: SubagentPreflightHostHints,
): SubagentPreflightCheck {
  const cfg = loadSubagentConfig();
  const agentPath = resolveAgentFile(agent, cwd, "user");
  const bundledAccordPath = path.join(AGENTS_ACCORD_DIR, `${agent}.md`);
  const agentFileFound =
    Boolean(agentPath && existsSync(agentPath)) || existsSync(bundledAccordPath);
  const agentFilePath =
    agentPath && existsSync(agentPath)
      ? agentPath
      : existsSync(bundledAccordPath)
        ? bundledAccordPath
        : null;

  const loadedAgent = agentFilePath
    ? loadAgentFromFile(agentFilePath, {
        namespace: inferAgentNamespace(agentFilePath),
      })
    : null;
  const agentConfig = loadedAgent ?? {
    name: agent,
    description: agent,
    tier: "workhorse" as const,
    systemPrompt: "",
    source: "user" as const,
    filePath: agentFilePath ?? "",
  };

  const requestedProfile = resolveRequestedProfileName(agentConfig, cfg);
  // Simulate the real spawn boundary in strict mode: resolveProfileForCredentials/
  // resolveModelConfig throw there on a credential/provider mismatch (see config.ts) instead
  // of silently swapping providers. This preflight check's job is to report that mismatch
  // ahead of time, not crash, so catch it and let evaluateCredentials() surface the
  // actionable block below.
  let effectiveProfile = requestedProfile;
  try {
    effectiveProfile = resolveProfileForCredentials(cfg, requestedProfile, { strict: true });
  } catch {
    effectiveProfile = requestedProfile;
  }
  const profileDef = cfg.profiles[effectiveProfile] ?? cfg.profiles[cfg.defaultProfile];
  const provider = profileDef?.provider ?? "unknown";

  let resolvedModel: ReturnType<typeof resolveModelConfig> = null;
  try {
    resolvedModel = resolveModelConfig(agentConfig, cfg, { strict: true });
  } catch {
    resolvedModel = null;
  }
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

  const scoped_models = hints?.scoped_models ?? [];
  const judgmentLightweight = resolveModelConfig(JUDGMENT_PREFLIGHT_AGENT, cfg);
  const judgment_model =
    hints?.judgment_model ??
    resolveJudgmentModelRefFromHarness(
      loadDevHarnessConfig(),
      judgmentLightweight
        ? { provider: judgmentLightweight.provider, model: judgmentLightweight.model }
        : null,
    );

  applyScopedPreflightWarnings(
    warnings,
    { provider: resolvedProvider, model },
    scoped_models,
    judgment_model,
  );

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
    scoped_models,
    judgment_model,
    blocks,
    warnings,
    formatted: "",
  };
  check.formatted = formatPreflightReport(check);
  return check;
}

const JUDGMENT_PREFLIGHT_AGENT: AgentConfig = {
  name: "__judgment__",
  description: "",
  tier: "lightweight",
  systemPrompt: "",
  source: "user",
  filePath: "",
};

export function devSubagentPreflight(
  agent?: string,
  cwd?: string,
  hints?: SubagentPreflightHostHints,
): SubagentPreflightCheck {
  const target = agent?.trim() || "phase-plan";
  return runSubagentSpawnPreflightCheck(target, cwd ?? process.cwd(), hints);
}

registerSpawnPreflightCheck(runSubagentSpawnPreflightCheck);
