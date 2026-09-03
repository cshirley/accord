/**
 * Public programmatic API for pi-subagent (hosts such as ACCORD import from here).
 * The Pi `subagent` tool extension is separate — see `index.ts`.
 */

export { loadAgentFromFile } from "./agent-load.js";
export {
  type AgentConfig,
  type AgentScope,
  discoverAgents,
  resolveAgentFile,
  resolveModelConfig,
  resolveRequestedProfileName,
  type ResolvedModel,
  type ThinkingLevel,
} from "./agents.js";
export type { SubagentLiveActivity, SubagentProgress } from "./progress/index.js";
export {
  applyToolExecutionToMessages,
  extractToolOutputPreview,
  formatToolCall,
  isSubagentStderrNoise,
  looksLikeToolActivityLine,
  mergeActivityWithToolLines,
  mergeToolCallsFromAssistantMessage,
  SubagentActivityBuffer,
  summarizeSubagentProgress,
} from "./progress/index.js";
export { formatResponseContractAppendix, parseSubagentReturnJson } from "./response-contract.js";
export { resolveSpawnAgent, runSubagent, spawnSubagent } from "./spawn/index.js";
export {
  DEFAULT_SPAWN_TIMEOUT_MS,
  resolveSpawnTimeoutMs,
  SPAWN_TIMEOUT_DISABLED,
} from "./spawn/timeout.js";
export type {
  RunSubagentRequest,
  SpawnSubagentParams,
  SpawnSubagentResult,
  SpawnSubagentUpdate,
  SubagentResponseContract,
  SubagentRunEvent,
  SubagentUsageStats,
} from "./spawn/types.js";
export { SubagentRunError } from "./spawn/types.js";
export {
  getSubagentToolRenderers,
  type SubagentToolRenderers,
} from "./subagent-tool-renderers.js";
