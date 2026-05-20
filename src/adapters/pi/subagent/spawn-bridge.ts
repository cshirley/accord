/**
 * Bridge ACCORD orchestration to the public pi-subagent programmatic API.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  runSubagent,
  type RunSubagentRequest,
  type SpawnSubagentResult,
  type SpawnSubagentUpdate,
} from "../../../integrations/pi-subagent.js";

/** One row in orchestration `details.results` — aligned with pi-subagent {@link SpawnSubagentResult}. */
export type OrchestrationSubagentSingleResult = Pick<
  SpawnSubagentResult,
  | "agent"
  | "agentSource"
  | "agentFile"
  | "task"
  | "exitCode"
  | "messages"
  | "stderr"
  | "usage"
  | "model"
  | "stopReason"
  | "errorMessage"
  | "step"
  | "liveActivity"
  | "output"
  | "parsedReturn"
  | "timedOut"
  | "aborted"
>;

export function mapSpawnResultToSingle(result: SpawnSubagentResult): OrchestrationSubagentSingleResult {
  return {
    agent: result.agent,
    agentSource: result.agentSource,
    agentFile: result.agentFile,
    task: result.task,
    exitCode: result.exitCode,
    messages: result.messages,
    stderr: result.stderr,
    usage: result.usage,
    model: result.model,
    stopReason: result.stopReason,
    errorMessage: result.errorMessage,
    step: result.step,
    liveActivity: result.liveActivity,
    output: result.output,
    parsedReturn: result.parsedReturn,
    timedOut: result.timedOut,
    aborted: result.aborted,
  };
}

export function createOrchestrationSubagentOnUpdate(
  makeDetails: (results: OrchestrationSubagentSingleResult[]) => unknown,
  onToolUpdate: (partial: AgentToolResult<unknown>) => void,
): (partial: SpawnSubagentUpdate) => void {
  return (partial) => {
    const single = mapSpawnResultToSingle(partial.result);
    onToolUpdate({
      content: [{ type: "text", text: partial.result.output || "(running...)" }],
      details: makeDetails([single]),
    });
  };
}

export async function runOrchestrationSubagent(
  params: RunSubagentRequest & {
    onUpdate?: (partial: SpawnSubagentUpdate) => void;
  },
): Promise<OrchestrationSubagentSingleResult> {
  const result = await runSubagent(params);
  return mapSpawnResultToSingle(result);
}
