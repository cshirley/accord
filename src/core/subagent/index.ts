/**
 * Host-neutral ACCORD subagent integration (Pi tool + programmatic spawn).
 */

export {
  collectSubagentEntries,
  firstSubagentAgentName,
  getPrimarySubagentEntry,
  type SubagentEntry,
} from "./entries.js";
export { prepareSubagentToolCall } from "./prepare.js";
export {
  applySubagentSpawnPayload,
  buildSubagentResponseContract,
  buildSubagentSpawnPayload,
  resolveHarnessAgentFile,
  type SubagentSpawnPayload,
} from "./payload.js";
export { runSubagentToolPreflight, type SubagentPreflightOptions } from "./preflight.js";
export {
  buildSingleSubagentRunRequest,
  readPreparedSingleSubagentInput,
  type PreparedSingleSubagentInput,
} from "./run-request.js";
export { runGatherPreflightOnSubagentCall } from "./preflight/gather.js";
export { runVerifyPreflightOnSubagentCall } from "./preflight/verify.js";
export {
  extractAnalysisFromAssistantText,
  extractAnalysisFromSubagentResult,
  extractReturnPacket,
  extractReturnPacketFromSubagentResult,
} from "./result/packet.js";
export {
  assembleHandoffContent,
  formatMissingPacketWarning,
  formatPacketInjection,
} from "./result/handoff.js";
export {
  type ProcessSubagentToolResultParams,
  processSubagentToolResult,
} from "./result/process.js";
