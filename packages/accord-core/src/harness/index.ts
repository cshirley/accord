/**
 * Host-neutral ACCORD harness hooks — callable from Pi, Cursor hook scripts, or tests.
 *
 * Pi adapter maps lifecycle events → these functions and applies UI-specific return shapes.
 */

export {
  discoverAvailableToolNames,
  readMcpServerKeys,
} from "../integrations/mcp-tool-discovery.js";
/**
 * @deprecated Import from `../subagent/index.js`. Re-exported for existing callers (d978cc1).
 */
export {
  applySubagentSpawnPayload,
  assembleHandoffContent,
  buildSingleSubagentRunRequest,
  buildSubagentResponseContract,
  buildSubagentSpawnPayload,
  collectSubagentEntries,
  extractAnalysisFromAssistantText, // added for catch-up parity — was missing from this shim
  extractAnalysisFromSubagentResult,
  extractReturnPacket,
  extractReturnPacketFromSubagentResult,
  firstSubagentAgentName,
  formatMissingPacketWarning,
  formatPacketInjection,
  getPrimarySubagentEntry,
  type PreparedSingleSubagentInput,
  type ProcessSubagentToolResultParams,
  prepareSubagentToolCall,
  processSubagentToolResult,
  readPreparedSingleSubagentInput,
  resolveHarnessAgentFile,
  runSubagentToolPreflight,
  runVerifyPreflightOnSubagentCall,
  type SubagentEntry,
  type SubagentPreflightOptions,
  type SubagentSpawnPayload,
} from "../subagent/index.js";
export { runGatherPreflightOnSubagentCall } from "../subagent/preflight/gather.js";
export type {
  HarnessHost,
  HarnessMutableState,
  OrchestratorUsageDedup,
} from "../types/host.js";
export { ORCHESTRATOR_FP_CAP } from "../types/host.js";
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
export type { SessionStartHookOptions, WireHarnessLifecycleOptions } from "./lifecycle-wiring.js";
export {
  createNoopHarnessLifecycleHost,
  runArtifactWriteHook,
  runSessionStartHook,
  runSubagentPrepareHook,
  runSubagentResultHook,
} from "./lifecycle-wiring.js";
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
  type ApplyWorkflowStateInput,
  applyWorkflowStateFromValidatedReturn,
} from "./workflow-state-apply.js";
export {
  applyTaskEventsFromPacket,
  extractTaskEventsFromPacket,
} from "./workflow-state-events.js";
export {
  classifyWorkflowStatePath,
  isOrchestratorOwnedWorkflowStatePath,
  type WorkflowStatePathKind,
} from "./workflow-state-paths.js";
export { prepareWorkflowStateBeforeSpawn } from "./workflow-state-spawn.js";
export {
  allowAgentWorkflowStateWrites,
  formatWorkflowStateWriteBlockedMessage,
  validateWorkflowStateWrite,
} from "./workflow-state-write-guard.js";
