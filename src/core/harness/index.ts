/**
 * Host-neutral ACCORD harness hooks — callable from Pi, Cursor hook scripts, or tests.
 *
 * Pi adapter maps lifecycle events → these functions and applies UI-specific return shapes.
 */

export {
  formatArtifactValidationFailureMessage,
  validateHarnessArtifactWriteIfApplicable,
} from "./artifact-write.js";
export {
  type AssetBootstrapResult,
  type AssetBootstrapStatus,
  type BootstrapOptions,
  maybeAutoInstallAssets,
} from "./asset-bootstrap.js";
export { runGatherPreflightOnSubagentCall } from "../subagent/preflight/gather.js";
export {
  createOrchestratorUsageDedup,
  isAssistantTurnMessage,
  type ProcessOrchestratorTurnParams,
  processOrchestratorTurnEnd,
  rememberOrchestratorFingerprint,
} from "./orchestrator-usage.js";
export {
  isAgentsMdPath,
  isHarnessTrackedJsonWritePath,
  normalizeHarnessRelativePath,
} from "./paths.js";
export { notifyPendingDecisionsIfAny } from "./pending-decisions.js";
export {
  applyHarnessCostSeed,
  type HarnessCostSeed,
  seedHarnessSessionCostState,
} from "./session-start.js";
export {
  assembleHandoffContent,
  applySubagentSpawnPayload,
  buildSingleSubagentRunRequest,
  buildSubagentResponseContract,
  buildSubagentSpawnPayload,
  collectSubagentEntries,
  extractAnalysisFromSubagentResult,
  extractReturnPacket,
  extractReturnPacketFromSubagentResult,
  firstSubagentAgentName,
  formatMissingPacketWarning,
  formatPacketInjection,
  getPrimarySubagentEntry,
  prepareSubagentToolCall,
  processSubagentToolResult,
  readPreparedSingleSubagentInput,
  resolveHarnessAgentFile,
  runSubagentToolPreflight,
  runVerifyPreflightOnSubagentCall,
  type PreparedSingleSubagentInput,
  type ProcessSubagentToolResultParams,
  type SubagentEntry,
  type SubagentPreflightOptions,
  type SubagentSpawnPayload,
} from "../subagent/index.js";
export type { HarnessHost, HarnessMutableState, OrchestratorUsageDedup } from "./types.js";
export { ORCHESTRATOR_FP_CAP } from "./types.js";
