/**
 * Apply validated subagent return packets to orchestrator-owned workflow state.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { runPostResultHandlerForAgent } from "../orchestration/post-result/registry.js";
import { persistValidatedAgentReturn } from "../orchestration/task-agent-audit.js";
import { extractAnalysisFromSubagentResult } from "../subagent/result/packet.js";
import { applyTaskEventsFromPacket } from "./workflow-state-events.js";

export type ApplyWorkflowStateInput = {
  workItemId: string;
  agent: string;
  packet: unknown;
  devConfig: DevHarnessConfig | null;
  /** Raw subagent result row for analysis extraction. */
  subagentResult?: unknown;
};

/**
 * Single writer path for workflow state after return-packet validation:
 * 1. merge `events[]` from packet onto per-task file
 * 2. persist agent return audit row
 * 3. run registered post-result handler (transitions, phase advances)
 */
export function applyWorkflowStateFromValidatedReturn(input: ApplyWorkflowStateInput): string {
  applyTaskEventsFromPacket(input.workItemId, input.packet);

  const analysisText =
    input.subagentResult !== undefined
      ? extractAnalysisFromSubagentResult(input.subagentResult)
      : undefined;
  const audit = analysisText ? { analysisText } : undefined;
  persistValidatedAgentReturn(input.workItemId, input.agent, input.packet, audit);

  return runPostResultHandlerForAgent(input.agent, input.workItemId, input.packet, input.devConfig);
}
