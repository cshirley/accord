/**
 * Agent discovery and model/provider resolution.
 *
 * Resolution model (see docs/agent-refactor/brief.md):
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ Frontmatter `model:` (explicit pin) ──────────┼──► wins
 *   ├───────────────────────────────────────────────┤
 *   │ agentProfiles[agent.name]                     │
 *   │ ↓ else reviewProfile (review-* agents)        │
 *   │ ↓ else skills[ns].profile                     │
 *   │ ↓ else activeProfile                          │
 *   │ ↓ else defaultProfile                         │
 *   ├───────────────────────────────────────────────┤
 *   │ Tier in target profile                        │
 *   │ ↓ if missing, borrow whole tier recipe from   │
 *   │   defaultProfile (provider+thinkingMode+model)│
 *   ├───────────────────────────────────────────────┤
 *   │ subagent.json missing/corrupt → in-code       │
 *   │ DEFAULT_CONFIG (Anthropic-direct only)        │
 *   └───────────────────────────────────────────────┘
 *
 * Profiles own the `provider` prefix and the `thinkingMode` (how thinking is
 * expressed for that provider): `flag` (Anthropic/Google), `embedded` (Cursor —
 * baked into the model id), `reasoning_effort` (OpenAI), `none` (local).
 * That decoupling fixes the bug where switching session provider produced
 * invalid model ids like `openai/claude-opus-4-7`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadAgentFromFile } from "./agent-load.js";

export type AgentScope = "user" | "project" | "both";

export type ModelTier = "reasoning" | "workhorse" | "lightweight";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ThinkingMode = "flag" | "embedded" | "reasoning_effort" | "none";
export type ReasoningEffort = "low" | "medium" | "high";

export interface TierConfig {
  model: string;
  thinking?: ThinkingLevel;
  reasoningEffort?: ReasoningEffort;
}

export interface ProfileConfig {
  provider: string;
  thinkingMode: ThinkingMode;
  tiers: Partial<Record<ModelTier, TierConfig>>;
}

export interface SkillConfig {
  profile?: string;
}

export interface SubagentConfig {
  defaultProfile: string;
  activeProfile?: string;
  skills?: Record<string, SkillConfig>;
  profiles: Record<string, ProfileConfig>;
  /**
   * Per-agent profile override (e.g. cross-vendor review). Takes precedence over
   * {@link SkillConfig.profile} and {@link activeProfile}.
   */
  agentProfiles?: Record<string, string>;
  /**
   * Profile for all `review-*` agents when no {@link agentProfiles} entry matches.
   */
  reviewProfile?: string;
  /**
   * Default wall-clock limit for {@link runSubagent} when the call omits `timeoutMs`.
   * Use `0` to disable. Falls back to 30 minutes when unset.
   */
  spawnTimeoutMs?: number;
}

export interface ResolvedModel {
  provider: string;
  model: string;
  thinkingMode: ThinkingMode;
  thinking?: ThinkingLevel;
  reasoningEffort?: ReasoningEffort;
}

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  tier?: ModelTier;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
  /** Path-derived skill namespace (parent directory under `agents/`). Undefined for root-level agents. */
  namespace?: string;
}

// ── Config loading ─────────────────────────────────────────

const DEFAULT_TIER: ModelTier = "workhorse";

/**
 * Last-resort in-code config used only when `subagent.json` cannot be
 * read or is structurally invalid. Intentionally minimal: one profile, the
 * safest direct provider, full tier coverage.
 */
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

/**
 * When the chosen profile targets Anthropic directly but no API key is present,
 * prefer a cursor-agent profile when Cursor credentials are available. Avoids
 * child `pi` processes that hang until spawn timeout.
 */
export function resolveProfileForCredentials(
  cfg: SubagentConfig,
  requestedProfileName: string,
): string {
  const profile = cfg.profiles[requestedProfileName];
  if (!profile || profile.provider !== "anthropic" || process.env.ANTHROPIC_API_KEY) {
    return requestedProfileName;
  }

  const cursorProfile = findCursorAgentProfileName(cfg);
  if (!cursorProfile || !hasCursorAgentCredentials()) {
    return requestedProfileName;
  }

  if (!_credentialFallbackWarned) {
    console.error(
      `[subagent] profile "${requestedProfileName}" uses provider "anthropic" but ANTHROPIC_API_KEY is unset; ` +
        `using "${cursorProfile}" (cursor-agent). Set ANTHROPIC_API_KEY or change activeProfile in subagent.json.`,
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
  for (const [name, p] of Object.entries(cfg.profiles)) {
    if (!p || typeof p !== "object") return false;
    if (typeof p.provider !== "string") return false;
    if (
      !p.thinkingMode ||
      !["flag", "embedded", "reasoning_effort", "none"].includes(p.thinkingMode)
    )
      return false;
    if (!p.tiers || typeof p.tiers !== "object") {
      console.error(`[subagent] profile "${name}" missing tiers`);
      return false;
    }
  }
  return true;
}

/** Load cached `subagent.json` from the Pi agent directory (creates defaults when missing). */
export function loadSubagentConfig(): SubagentConfig {
  const configPath = path.join(getAgentDir(), "subagent.json");
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
    // File missing — write the in-code default so the user can edit it.
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

  // Legacy shape: { tiers: { reasoning, workhorse, lightweight } }. Surface a one-time
  // warning so the user knows to migrate; fall back to in-code defaults so subagents
  // still run.
  if (parsed && typeof parsed === "object" && "tiers" in parsed && !("profiles" in parsed)) {
    if (!_configWarned) {
      console.error(
        `[subagent] subagent.json uses the legacy 'tiers' shape. ` +
          `Migrate to defaultProfile/activeProfile/profiles (see docs/agent-refactor/brief.md). ` +
          `Falling back to in-code defaults until then.`,
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

/** Invalidate the config cache (e.g. after editing subagent.json). */
export function invalidateConfigCache(): void {
  _configCache = null;
  _configCachePath = null;
}

/**
 * @deprecated Use {@link invalidateConfigCache}. Kept for callers of the old API.
 */
export const invalidateTierCache = invalidateConfigCache;

// ── Resolution ─────────────────────────────────────────────

/**
 * Profile name from config before credential fallback. See module docstring for order.
 */
export function resolveRequestedProfileName(agent: AgentConfig, cfg: SubagentConfig): string {
  const agentOverride = cfg.agentProfiles?.[agent.name];
  if (agentOverride) {
    return agentOverride;
  }
  if (cfg.reviewProfile && agent.name.startsWith("review-")) {
    return cfg.reviewProfile;
  }
  const skillName = agent.namespace;
  const skillProfileName = skillName ? cfg.skills?.[skillName]?.profile : undefined;
  return skillProfileName ?? cfg.activeProfile ?? cfg.defaultProfile;
}

/**
 * Resolve an agent's tier + frontmatter overrides to a concrete provider, model,
 * and thinking-flag recipe. See module-level docstring for the resolution order.
 *
 * Always returns a {@link ResolvedModel}: the in-code DEFAULT_CONFIG guarantees
 * we can always produce one. Returns `null` only when even the default fails
 * (corrupt in-code constant — should be unreachable).
 */
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

  // Frontmatter `model:` is an explicit pin. If fully qualified (`provider/model`)
  // we honour the embedded provider; otherwise we adopt the target profile's
  // provider and thinkingMode.
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

  // Partial-profile fallback: if the target profile doesn't define this tier,
  // borrow the *whole* tier recipe from the default profile (provider +
  // thinkingMode + model). Borrowing piecemeal would recreate the original bug
  // (e.g. cursor-agent provider with an Anthropic-shaped model id).
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

// ── Discovery ──────────────────────────────────────────────

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

/** Maximum recursion depth into `agents/`. Generous enough for `agents/<skill>/<sub>/file.md`
 *  but bounded to stop runaway symlink chains. */
const MAX_AGENT_DIR_DEPTH = 4;

function tryLoadAgentFile(
  filePath: string,
  namespace: string | undefined,
  source: "user" | "project",
): AgentConfig | null {
  return loadAgentFromFile(filePath, { source, namespace });
}

/**
 * Walk the agents directory recursively (up to {@link MAX_AGENT_DIR_DEPTH}
 * levels). Files at the root have `namespace = undefined`; files in any
 * subdirectory inherit that subdirectory's name as their namespace (e.g.
 * `agents/accord/phase-code.md` → namespace `"accord"`).
 *
 * - Skips dotfiles, dotdirs, and `node_modules`.
 * - Follows symlinks (the existing layout has both file and directory
 *   symlinks pointing at the accord repo's assets).
 * - Tracks visited canonical paths to break symlink cycles.
 * - Files lacking agent frontmatter are silently ignored, so non-agent
 *   markdown in subdirectories (e.g. `agents/providers/jira.md`) does not
 *   accidentally become discoverable.
 */
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

      // Use statSync (follows symlinks) so a directory symlink — e.g. the
      // future single-link `agents -> accord/assets/pi/agents` setup — is
      // recursed into, and a file symlink is treated as a file.
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

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
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
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map<string, AgentConfig>();

  // First-wins-with-warning across namespaces. Collisions only happen once
  // agents land in subdirectories, so this is a no-op until the agent
  // reorganisation lands; surfacing the issue is more useful than silent
  // overwrite. Project agents are still allowed to override user agents in
  // "both" scope (intentional precedence — see ordering below).
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
    // Project agents intentionally override user agents in "both" scope.
    for (const agent of projectAgents) insert(agent, true);
  } else if (scope === "user") {
    for (const agent of userAgents) insert(agent, false);
  } else {
    for (const agent of projectAgents) insert(agent, false);
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

/** Resolve absolute agent markdown path by discovered name. */
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
    text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
    remaining,
  };
}
