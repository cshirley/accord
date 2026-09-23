/**
 * Host-neutral agent definition and model-resolution types.
 */

export type AgentScope = "user" | "project" | "both";

export type ModelTier = "reasoning" | "workhorse" | "lightweight";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingMode = "flag" | "reasoning_effort" | "none";
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
  agentProfiles?: Record<string, string>;
  reviewProfile?: string;
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
  namespace?: string;
}

export type AgentFileSource = "user" | "project" | "explicit";

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}
