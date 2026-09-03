/**
 * Agent discovery and model/provider resolution.
 *
 * Canonical implementation lives in accord-core; pi-subagent re-exports for Pi hosts.
 */

export {
  CURSOR_PROVIDER,
  discoverAgents,
  findCursorProfileName,
  formatAgentList,
  hasCursorCredentials,
  invalidateConfigCache,
  invalidateTierCache,
  loadSubagentConfig,
  readStoredCredential,
  resolveAgentFile,
  resolveModelConfig,
  resolveProfileForCredentials,
  resolveRequestedProfileName,
} from "@clive.shirley/accord-core/agents/config.js";

export type {
  AgentConfig,
  AgentDiscoveryResult,
  AgentScope,
  ModelTier,
  ProfileConfig,
  ReasoningEffort,
  ResolvedModel,
  SkillConfig,
  SubagentConfig,
  ThinkingLevel,
  ThinkingMode,
  TierConfig,
} from "@clive.shirley/accord-core/agents/types.js";
