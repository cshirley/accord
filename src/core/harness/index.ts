/**
 * Host-neutral ACCORD harness hooks — callable from Pi, Cursor hook scripts, or tests.
 *
 * Pi adapter maps lifecycle events → these functions and applies UI-specific return shapes.
 */

export type { HarnessHost, HarnessMutableState, OrchestratorUsageDedup } from "./types.js";
export { ORCHESTRATOR_FP_CAP } from "./types.js";

export {
  normalizeHarnessRelativePath,
  isHarnessTrackedJsonWritePath,
  isAgentsMdPath,
} from "./paths.js";

export {
  formatArtifactValidationFailureMessage,
  validateHarnessArtifactWriteIfApplicable,
} from "./artifact-write.js";

export {
  collectSubagentEntries,
  firstSubagentAgentName,
  getPrimarySubagentEntry,
  type SubagentEntry,
} from "./subagent-entries.js";

export { prepareSubagentToolCall } from "./subagent-prepare.js";

export { processSubagentToolResult, type ProcessSubagentToolResultParams } from "./subagent-result.js";

export { runGatherPreflightOnSubagentCall } from "./gather-preflight.js";

export { runVerifyPreflightOnSubagentCall } from "./verify-preflight.js";

export {
  processOrchestratorTurnEnd,
  createOrchestratorUsageDedup,
  rememberOrchestratorFingerprint,
  isAssistantTurnMessage,
  type ProcessOrchestratorTurnParams,
} from "./orchestrator-usage.js";

export {
  seedHarnessSessionCostState,
  applyHarnessCostSeed,
  type HarnessCostSeed,
} from "./session-start.js";

export { notifyPendingDecisionsIfAny } from "./pending-decisions.js";

export {
  maybeAutoInstallAssets,
  type AssetBootstrapResult,
  type AssetBootstrapStatus,
  type BootstrapOptions,
} from "./asset-bootstrap.js";
