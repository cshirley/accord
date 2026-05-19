import type { AgentConfig } from "../agents.js";
import { runSubagent } from "../spawn/index.js";
import type { SpawnSubagentParams, SpawnSubagentResult } from "../spawn/types.js";
import type { OnUpdateCallback, SingleResult, SubagentDetails } from "./types.js";

export type RunSingleAgentOptions = Partial<
  Pick<
    SpawnSubagentParams,
    | "agentFile"
    | "model"
    | "thinking"
    | "systemAppend"
    | "response"
    | "tools"
    | "agentScope"
    | "onEvent"
  >
> & {
  timeoutMs?: number;
};

export function spawnResultToSingle(result: SpawnSubagentResult): SingleResult {
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

export async function runSingleAgent(
  defaultCwd: string,
  agents: AgentConfig[],
  agentName: string,
  task: string,
  cwd: string | undefined,
  step: number | undefined,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  makeDetails: (results: SingleResult[]) => SubagentDetails,
  options: RunSingleAgentOptions = {},
): Promise<SingleResult> {
  const processCwd = cwd ?? defaultCwd;
  const agentFile =
    options.agentFile ?? agents.find((candidate) => candidate.name === agentName)?.filePath;

  const spawnResult = await runSubagent({
    cwd: processCwd,
    agent: options.agentFile ? undefined : agentName,
    agentFile,
    agentScope: options.agentScope,
    task,
    step,
    signal,
    timeoutMs: options.timeoutMs,
    model: options.model,
    thinking: options.thinking,
    tools: options.tools,
    systemAppend: options.systemAppend,
    response: options.response,
    onEvent: options.onEvent,
    onUpdate: onUpdate
      ? (partial) => {
          const single = spawnResultToSingle(partial.result);
          onUpdate({
            content: [{ type: "text", text: partial.result.output || "(running...)" }],
            details: makeDetails([single]),
          });
        }
      : undefined,
  });

  return spawnResultToSingle(spawnResult);
}
