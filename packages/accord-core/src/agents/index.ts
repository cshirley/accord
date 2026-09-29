/**
 * Host-neutral agent loading, model resolution, and Pi subprocess spawns.
 */

export { appendThinkingCliArgs } from "./cli-args.js";
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
} from "./config.js";
export { parseAgentFrontmatter } from "./frontmatter.js";
export { loadAgentFromFile } from "./load.js";
export { spawnSubagent } from "./pi-spawn.js";
export {
  formatResponseContractAppendix,
  parseSubagentReturnJson,
} from "./response-contract.js";
export {
  buildSystemPrompt,
  buildTask,
  emptyUsage,
  failureResult,
  qualifyModel,
  resolveSpawnAgent,
  resolveSpawnModel,
  type SpawnSubagentParams,
  type SpawnSubagentResult,
} from "./spawn-resolve.js";
export * from "./types.js";
