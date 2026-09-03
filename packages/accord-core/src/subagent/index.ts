/**
 * Host-neutral ACCORD subagent integration (Pi tool + programmatic spawn).
 */

export {
  collectSubagentEntries,
  firstSubagentAgentName,
  getPrimarySubagentEntry,
  type SubagentEntry,
} from "./entries.js";
export {
  applySubagentSpawnPayload,
  buildSubagentResponseContract,
  buildSubagentSpawnPayload,
  resolveHarnessAgentFile,
  type SubagentSpawnPayload,
} from "./payload.js";
export { runGatherPreflightOnSubagentCall } from "./preflight/gather.js";
export {
  checkBriefPresentForSpeccing,
  checkSpecPresentForPlanning,
  runPipelineArtifactPreflightOnSubagentCall,
  workItemUsesAlignFirstPipeline,
} from "./preflight/pipeline-artifacts.js";
export { runVerifyPreflightOnSubagentCall } from "./preflight/verify.js";
export {
  runSubagentToolPreflight,
  type SubagentPreflightOptions,
} from "./preflight-runner.js";
export { prepareSubagentToolCall } from "./prepare.js";
export {
  assembleHandoffContent,
  formatMissingPacketWarning,
  formatPacketInjection,
} from "./result/handoff.js";
export {
  extractAnalysisFromAssistantText,
  extractAnalysisFromSubagentResult,
  extractReturnPacket,
  extractReturnPacketFromSubagentResult,
  findBalancedJsonRegions,
} from "./result/packet.js";
export {
  type ProcessSubagentToolResultParams,
  processSubagentToolResult,
} from "./result/process.js";
export {
  buildSingleSubagentRunRequest,
  type PreparedSingleSubagentInput,
  readPreparedSingleSubagentInput,
} from "./run-request.js";
