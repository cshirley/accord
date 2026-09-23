/**
 * Build {@link RunSubagentRequest} objects from a prepared Pi `subagent` tool payload.
 */

import type { RunSubagentRequest, SubagentResponseContract } from "../types/subagent-spawn.js";

export type PreparedSingleSubagentInput = {
  agent: string;
  task: string;
  agentFile?: string;
  model?: string;
  systemAppend?: string;
  response?: SubagentResponseContract;
};

/** Read single-agent fields from a prepared tool-call / orchestration input object. */
export function readPreparedSingleSubagentInput(
  input: Record<string, unknown>,
): PreparedSingleSubagentInput | null {
  const agent = typeof input.agent === "string" ? input.agent : "";
  const task = typeof input.task === "string" ? input.task : "";
  if (!agent || !task) {
    return null;
  }

  return {
    agent,
    task,
    agentFile: typeof input.agentFile === "string" ? input.agentFile : undefined,
    model: typeof input.model === "string" ? input.model : undefined,
    systemAppend: typeof input.systemAppend === "string" ? input.systemAppend : undefined,
    response: input.response as SubagentResponseContract | undefined,
  };
}

export function buildSingleSubagentRunRequest(
  prepared: PreparedSingleSubagentInput,
  cwd: string,
  extras: Omit<RunSubagentRequest, keyof PreparedSingleSubagentInput | "cwd"> = {},
): RunSubagentRequest {
  return {
    cwd,
    agent: prepared.agent,
    task: prepared.task,
    agentFile: prepared.agentFile,
    model: prepared.model,
    systemAppend: prepared.systemAppend,
    response: prepared.response,
    ...extras,
  };
}
