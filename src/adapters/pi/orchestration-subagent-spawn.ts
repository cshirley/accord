/**
 * Bridge ACCORD orchestration to the public pi-subagent programmatic API.
 */

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import {
  runSubagent,
  type RunSubagentRequest,
  type SpawnSubagentResult,
  type SpawnSubagentUpdate,
  type SubagentLiveActivity,
} from "../../../packages/pi-subagent/src/api.js";

export interface OrchestrationSubagentSingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: SpawnSubagentResult["usage"];
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
  liveActivity?: SubagentLiveActivity;
}

export function mapSpawnResultToSingle(result: SpawnSubagentResult): OrchestrationSubagentSingleResult {
  return {
    agent: result.agent,
    agentSource: result.agentSource,
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
