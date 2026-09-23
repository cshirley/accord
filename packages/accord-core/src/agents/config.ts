/**
 * Agent discovery and model/provider resolution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePiAgentDir } from "../config/paths.js";
import { CURSOR_PROVIDER, hasCursorCredentials } from "./credentials.js";
import { loadAgentFromFile } from "./load.js";
import type {
  AgentConfig,
  AgentDiscoveryResult,
  AgentScope,
  ModelTier,
  ResolvedModel,
  SubagentConfig,
} from "./types.js";

export { CURSOR_PROVIDER, hasCursorCredentials, readStoredCredential } from "./credentials.js";

const DEFAULT_TIER: ModelTier = "workhorse";

const DEFAULT_CONFIG: SubagentConfig = {
  defaultProfile: "default",
  profiles: {
    default: {
      provider: "anthropic",
      thinkingMode: "flag",
      tiers: {
        reasoning: { model: "claude-opus-4-7", thinking: "high" },
        workhorse: { model: "claude-sonnet-4-6", thinking: "medium" },
        lightweight: { model: "claude-haiku-4-5", thinking: "low" },
      },
    },
  },
};

let _configCache: SubagentConfig | null = null;
let _configCachePath: string | null = null;
let _configWarned = false;
let _credentialFallbackWarned = false;

export function findCursorProfileName(cfg: SubagentConfig): string | null {
  if (!hasCursorCredentials()) return null;
  if (cfg.profiles["cursor-claude"]?.provider === CURSOR_PROVIDER) return "cursor-claude";
  for (const [name, profile] of Object.entries(cfg.profiles)) {
    if (profile.provider === CURSOR_PROVIDER) return name;
  }
  return null;
}

export function resolveProfileForCredentials(
  cfg: SubagentConfig,
  requestedProfileName: string,
): string {
  const profile = cfg.profiles[requestedProfileName];
  if (profile?.provider !== "anthropic" || process.env.ANTHROPIC_API_KEY) {
    return requestedProfileName;
  }

  const cursorProfile = findCursorProfileName(cfg);
  if (!cursorProfile) {
    return requestedProfileName;
  }

  if (!_credentialFallbackWarned) {
    console.error(
      `[subagent] profile "${requestedProfileName}" uses provider "anthropic" but ANTHROPIC_API_KEY is unset; ` +
        `using "${cursorProfile}" (${cfg.profiles[cursorProfile].provider}). ` +
        `Set ANTHROPIC_API_KEY or change activeProfile in subagent.json.`,
    );
    _credentialFallbackWarned = true;
  }
  return cursorProfile;
}

function isValidConfig(parsed: unknown): parsed is SubagentConfig {
  if (!parsed || typeof parsed !== "object") return false;
  const cfg = parsed as Partial<SubagentConfig>;
  if (typeof cfg.defaultProfile !== "string") return false;
  if (!cfg.profiles || typeof cfg.profiles !== "object") return false;
  if (!cfg.profiles[cfg.defaultProfile]) return false;
  for (const [name, profile] of Object.entries(cfg.profiles)) {
    if (!profile || typeof profile !== "object") return false;
    if (typeof profile.provider !== "string") return false;
    if ((profile.thinkingMode as string) === "embedded") profile.thinkingMode = "flag";
    if (!profile.thinkingMode || !["flag", "reasoning_effort", "none"].includes(profile.thinkingMode))
      return false;
    if (!profile.tiers || typeof profile.tiers !== "object") {
      console.error(`[subagent] profile "${name}" missing tiers`);
      return false;
    }
  }
  return true;
}

/** Load cached `subagent.json` from the Pi agent directory (creates defaults when missing). */
export function loadSubagentConfig(): SubagentConfig {
  const configPath = path.join(resolvePiAgentDir(), "subagent.json");
  if (_configCache && _configCachePath === configPath) return _configCache;

  const cacheAndReturn = (cfg: SubagentConfig): SubagentConfig => {
    _configCache = cfg;
    _configCachePath = configPath;
    return cfg;
  };

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    try {
      fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
      console.error(`[subagent] Created default subagent.json at ${configPath}`);
      return cacheAndReturn(DEFAULT_CONFIG);
    } catch {
      if (!_configWarned) {
        console.error(
          `[subagent] Could not read or create subagent.json at ${configPath}. Using in-code defaults.`,
        );
        _configWarned = true;
      }
      return DEFAULT_CONFIG;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (!_configWarned) {
      console.error(
        `[subagent] subagent.json is not valid JSON: ${(err as Error).message}. Using in-code defaults.`,
      );
      _configWarned = true;
    }
    return cacheAndReturn(DEFAULT_CONFIG);
  }

  if (parsed && typeof parsed === "object" && "tiers" in parsed && !("profiles" in parsed)) {
    if (!_configWarned) {
      console.error(
        `[subagent] subagent.json uses the legacy 'tiers' shape. ` +
          `Migrate to defaultProfile/activeProfile/profiles. Falling back to in-code defaults until then.`,
      );
      _configWarned = true;
    }
    return cacheAndReturn(DEFAULT_CONFIG);
  }

  if (!isValidConfig(parsed)) {
    if (!_configWarned) {
      console.error(
        `[subagent] subagent.json is missing required fields (defaultProfile, profiles, or profiles[defaultProfile]). Using in-code defaults.`,
      );
      _configWarned = true;
    }
    return cacheAndReturn(DEFAULT_CONFIG);
  }

  _configWarned = false;
  return cacheAndReturn(parsed);
}

export function invalidateConfigCache(): void {
  _configCache = null;
  _configCachePath = null;
}

/** @deprecated Use {@link invalidateConfigCache}. */
export const invalidateTierCache = invalidateConfigCache;

export function resolveRequestedProfileName(agent: AgentConfig, cfg: SubagentConfig): string {
  const agentOverride = cfg.agentProfiles?.[agent.name];
  if (agentOverride) return agentOverride;
  if (cfg.reviewProfile && agent.name.startsWith("review-")) return cfg.reviewProfile;
  const skillName = agent.namespace;
  const skillProfileName = skillName ? cfg.skills?.[skillName]?.profile : undefined;
  return skillProfileName ?? cfg.activeProfile ?? cfg.defaultProfile;
}

export function resolveModelConfig(
  agent: AgentConfig,
  config?: SubagentConfig,
): ResolvedModel | null {
  const cfg = config ?? loadSubagentConfig();
  const defaultProfile = cfg.profiles[cfg.defaultProfile];
  if (!defaultProfile) {
    console.error(`[subagent] defaultProfile "${cfg.defaultProfile}" not found in profiles map.`);
    return null;
  }

  const requestedProfileName = resolveProfileForCredentials(
    cfg,
    resolveRequestedProfileName(agent, cfg),
  );
  let targetProfile = cfg.profiles[requestedProfileName];

  if (!targetProfile) {
    console.error(
      `[subagent] profile "${requestedProfileName}" not found; using defaultProfile "${cfg.defaultProfile}".`,
    );
    targetProfile = defaultProfile;
  }

  if (agent.model) {
    const slash = agent.model.indexOf("/");
    const isQualified = slash > 0;
    const provider = isQualified ? agent.model.slice(0, slash) : targetProfile.provider;
    const model = isQualified ? agent.model.slice(slash + 1) : agent.model;
    return {
      provider,
      model,
      thinkingMode: targetProfile.thinkingMode,
      thinking: agent.thinking,
    };
  }

  const tier = agent.tier ?? DEFAULT_TIER;
  if (!agent.tier) {
    console.error(`[subagent] agent "${agent.name}" has no tier; defaulting to "${DEFAULT_TIER}".`);
  }

  let tierConfig = targetProfile.tiers[tier];
  let resolvedProfile = targetProfile;

  if (!tierConfig && targetProfile !== defaultProfile) {
    tierConfig = defaultProfile.tiers[tier];
    if (tierConfig) {
      resolvedProfile = defaultProfile;
      console.error(
        `[subagent] tier "${tier}" not defined in profile "${requestedProfileName}"; ` +
          `using defaultProfile "${cfg.defaultProfile}" → ${defaultProfile.provider}/${tierConfig.model}`,
      );
    }
  }

  if (!tierConfig) {
    console.error(
      `[subagent] tier "${tier}" not defined in profile "${requestedProfileName}" or defaultProfile "${cfg.defaultProfile}". Cannot resolve model.`,
    );
    return null;
  }

  return {
    provider: resolvedProfile.provider,
    model: tierConfig.model,
    thinkingMode: resolvedProfile.thinkingMode,
    thinking: agent.thinking ?? tierConfig.thinking,
    reasoningEffort: tierConfig.reasoningEffort,
  };
}

const MAX_AGENT_DIR_DEPTH = 4;

function tryLoadAgentFile(
  filePath: string,
  namespace: string | undefined,
  source: "user" | "project",
): AgentConfig | null {
  return loadAgentFromFile(filePath, { source, namespace });
}

function loadAgentsFromDir(rootDir: string, source: "user" | "project"): AgentConfig[] {
  if (!fs.existsSync(rootDir)) return [];

  const agents: AgentConfig[] = [];
  const visited = new Set<string>();

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_AGENT_DIR_DEPTH) return;

    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(realDir)) return;
    visited.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const full = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }

      if (!stat.isFile() || !entry.name.endsWith(".md")) continue;

      const namespace = dir === rootDir ? undefined : path.basename(dir);
      const agent = tryLoadAgentFile(full, namespace, source);
      if (agent) agents.push(agent);
    }
  };

  walk(rootDir, 0);
  return agents;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
  const userDir = path.join(resolvePiAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map<string, AgentConfig>();

  const insert = (agent: AgentConfig, allowOverride: boolean): void => {
    const existing = agentMap.get(agent.name);
    if (existing && existing.filePath !== agent.filePath && !allowOverride) {
      const existingLoc = existing.namespace ? `${existing.namespace}/` : "";
      const incomingLoc = agent.namespace ? `${agent.namespace}/` : "";
      console.error(
        `[subagent] agent name collision: "${agent.name}" defined in both ` +
          `"${existingLoc}${path.basename(existing.filePath)}" and ` +
          `"${incomingLoc}${path.basename(agent.filePath)}". Keeping the first.`,
      );
      return;
    }
    agentMap.set(agent.name, agent);
  };

  if (scope === "both") {
    for (const agent of userAgents) insert(agent, false);
    for (const agent of projectAgents) insert(agent, true);
  } else if (scope === "user") {
    for (const agent of userAgents) insert(agent, false);
  } else {
    for (const agent of projectAgents) insert(agent, false);
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function resolveAgentFile(
  agentName: string,
  cwd: string,
  scope: AgentScope = "user",
): string | null {
  const { agents } = discoverAgents(cwd, scope);
  const match = agents.find((candidate) => candidate.name === agentName);
  return match?.filePath ?? null;
}

export function formatAgentList(
  agents: AgentConfig[],
  maxItems: number,
): { text: string; remaining: number } {
  if (agents.length === 0) return { text: "none", remaining: 0 };
  const listed = agents.slice(0, maxItems);
  const remaining = agents.length - listed.length;
  return {
    text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
    remaining,
  };
}
