export {
  buildSystemPrompt,
  buildTask,
  qualifyModel,
  resolveSpawnAgent,
  resolveSpawnModel,
} from "@clive.shirley/accord-core/agents/spawn-resolve.js";

import type { SpawnSubagentResult } from "./types.js";

export function emptyUsage(): SpawnSubagentResult["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

export function failureResult(
  agentName: string,
  task: string,
  stderr: string,
  step?: number,
  agentFile?: string,
): SpawnSubagentResult {
  return {
    agent: agentName,
    agentSource: "unknown",
    agentFile,
    task,
    exitCode: 1,
    messages: [],
    stderr,
    usage: emptyUsage(),
    step,
    output: "",
  };
}
