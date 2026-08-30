/**
 * Single import surface for the bundled pi-subagent package (ACCORD hosts only).
 */

export {
  type AgentScope,
  DEFAULT_SPAWN_TIMEOUT_MS,
  formatResponseContractAppendix,
  getSubagentToolRenderers,
  loadAgentFromFile,
  looksLikeToolActivityLine,
  parseSubagentReturnJson,
  type RunSubagentRequest,
  resolveSpawnAgent,
  resolveSpawnTimeoutMs,
  runSubagent,
  SPAWN_TIMEOUT_DISABLED,
  type SpawnSubagentResult,
  type SpawnSubagentUpdate,
  type SubagentLiveActivity,
  type SubagentProgress,
  type SubagentResponseContract,
  SubagentRunError,
  type SubagentRunEvent,
  type SubagentToolRenderers,
  spawnSubagent,
  summarizeSubagentProgress,
} from "../../../pi-subagent/src/api.js";
