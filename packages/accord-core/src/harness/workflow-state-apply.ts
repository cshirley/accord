/**
 * Apply validated subagent return packets to orchestrator-owned workflow state.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { runPostResultHandlerForAgent } from "../orchestration/post-result/registry.js";
import {
  annotateTaskAgentReturn,
  finalizeTaskAgentReturn,
  recordTaskAgentReturn,
} from "../orchestration/task-agent-audit.js";
import { extractAnalysisFromSubagentResult } from "../subagent/result/packet.js";

export type ApplyWorkflowStateInput = {
  workItemId: string;
  agent: string;
  packet: unknown;
  devConfig: DevHarnessConfig | null;
  /** Raw subagent result row for analysis extraction. */
  subagentResult?: unknown;
  /** Pre-extracted analysis (recovery from sidecar). */
  analysis?: string;
  /** `events[]` entries removed before validation (recorded on the sidecar + log entry). */
  droppedEvents?: unknown[];
};

/**
 * Single writer path for workflow state after return-packet validation:
 * 1. task-pipeline agents: raw packet sidecar + `in_flight` → `returned`
 * 2. registered post-result handler (log entry, facts, routing decision)
 * 3. finalize: log returns the handler did not apply, release `in_flight`
 */
export function applyWorkflowStateFromValidatedReturn(input: ApplyWorkflowStateInput): string {
  const analysis =
    input.analysis ??
    (input.subagentResult !== undefined
      ? extractAnalysisFromSubagentResult(input.subagentResult)
      : undefined);

  const ref = recordTaskAgentReturn(input.workItemId, input.agent, input.packet, analysis, {
    validated: true,
    ...(input.droppedEvents?.length ? { droppedEvents: input.droppedEvents } : {}),
  });

  const footer = runPostResultHandlerForAgent(
    input.agent,
    input.workItemId,
    input.packet,
    input.devConfig,
    analysis ? { analysis } : undefined,
  );

  finalizeTaskAgentReturn(input.workItemId, input.agent, input.packet, analysis);
  if (ref && input.droppedEvents?.length) {
    annotateTaskAgentReturn(input.workItemId, ref, [
      `${String(input.droppedEvents.length)} malformed event(s) dropped before validation — see sidecar dropped_events`,
    ]);
  }
  return footer;
}
