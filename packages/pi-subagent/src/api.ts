/**
 * Public programmatic API for pi-subagent (hosts such as ACCORD import from here).
 * The Pi `subagent` tool extension is separate — see `index.ts`.
 */

export { runSubagent, spawnSubagent, resolveSpawnAgent } from "./spawn/index.js";
export {
  DEFAULT_SPAWN_TIMEOUT_MS,
  resolveSpawnTimeoutMs,
  SPAWN_TIMEOUT_DISABLED,
} from "./spawn/timeout.js";
export { SubagentRunError } from "./spawn/types.js";
export type {
  RunSubagentRequest,
  SpawnSubagentParams,
  SpawnSubagentResult,
  SpawnSubagentUpdate,
  SubagentResponseContract,
  SubagentRunEvent,
  SubagentUsageStats,
} from "./spawn/types.js";
export { loadAgentFromFile } from "./agent-load.js";
export {
  discoverAgents,
  resolveAgentFile,
  resolveModelConfig,
  type AgentConfig,
  type AgentScope,
  type ThinkingLevel,
} from "./agents.js";
export { formatResponseContractAppendix, parseSubagentReturnJson } from "./response-contract.js";
export {
  summarizeSubagentProgress,
  SubagentActivityBuffer,
  applyToolExecutionToMessages,
  extractToolOutputPreview,
  formatToolCall,
  isSubagentStderrNoise,
  looksLikeToolActivityLine,
  mergeActivityWithToolLines,
  mergeToolCallsFromAssistantMessage,
} from "./progress/index.js";
export type { SubagentLiveActivity, SubagentProgress } from "./progress/index.js";
export {
  getSubagentToolRenderers,
  type SubagentToolRenderers,
} from "./subagent-tool-renderers.js";
