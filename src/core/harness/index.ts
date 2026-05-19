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
export { runGatherPreflightOnSubagentCall } from "./gather-preflight.js";
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
  collectSubagentEntries,
  firstSubagentAgentName,
  getPrimarySubagentEntry,
  type SubagentEntry,
} from "./subagent-entries.js";
export { prepareSubagentToolCall } from "./subagent-prepare.js";
export {
  applySubagentSpawnPayload,
  buildSubagentResponseContract,
  buildSubagentSpawnPayload,
  resolveHarnessAgentFile,
} from "./subagent-spawn-payload.js";
export {
  type ProcessSubagentToolResultParams,
  processSubagentToolResult,
} from "./subagent-result.js";
export type { HarnessHost, HarnessMutableState, OrchestratorUsageDedup } from "./types.js";
export { ORCHESTRATOR_FP_CAP } from "./types.js";
export { runVerifyPreflightOnSubagentCall } from "./verify-preflight.js";
