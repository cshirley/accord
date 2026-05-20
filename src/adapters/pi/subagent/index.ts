/**
 * Pi adapter: programmatic subagent spawn UI and orchestration runtime host.
 */

export {
  ORCHESTRATOR_SUBAGENT_MESSAGE_TYPE,
  registerOrchestratorSubagentChatRenderer,
  refreshOrchestratorSubagentChatDisplays,
  startOrchestratorSubagentChatDisplay,
  type OrchestratorSubagentChatHandle,
  type OrchestratorSubagentChatOptions,
  type OrchestratorSubagentOnUpdate,
} from "./chat-display.js";
export {
  type OrchestratorPreflightOptions,
  type OrchestratorPreflightResult,
  runOrchestratorPreflight,
} from "./command-preflight.js";
export { runOrchestrationJudgment } from "./judgment.js";
export { createResumeOrchestrationRuntimeHost } from "./runtime-host.js";
export {
  createOrchestrationSubagentOnUpdate,
  mapSpawnResultToSingle,
  runOrchestrationSubagent,
  type OrchestrationSubagentSingleResult,
} from "./spawn-bridge.js";
export {
  applyOrchestratorSpawnStatus,
  clearOrchestratorSpawnWidget,
  formatOrchestratorSpawnElapsed,
  formatOrchestratorSpawnStatusLines,
  formatOrchestratorSpawnWorkingMessage,
  mountOrchestratorSpawnWidget,
  ORCHESTRATOR_SPAWN_HEARTBEAT_MS,
  ORCHESTRATOR_SPAWN_STATUS_KEY,
  ORCHESTRATOR_SPAWN_WIDGET_KEY,
  refreshOrchestratorSpawnUi,
  registerOrchestratorSpawn,
  startOrchestratorSpawnHeartbeat,
  stopOrchestratorSpawnHeartbeat,
  unregisterOrchestratorSpawn,
  updateOrchestratorSpawn,
} from "./spawn-status.js";
export {
  formatOrchestratorProgressWidgetLines,
  formatOrchestratorStallHint,
} from "./spawn-ui.js";
