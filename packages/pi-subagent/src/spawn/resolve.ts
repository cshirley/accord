import { loadAgentFromFile } from "../agent-load.js";
import {
  type AgentConfig,
  discoverAgents,
  type ResolvedModel,
  resolveModelConfig,
} from "../agents.js";
import { formatResponseContractAppendix } from "../response-contract.js";
import type { SpawnSubagentParams, SpawnSubagentResult } from "./types.js";

export function qualifyModel(model: string | undefined, provider: string): string | undefined {
  if (!model) return undefined;
  if (model.includes("/")) return model;
  return `${provider}/${model}`;
}

export function resolveSpawnModel(
  agent: AgentConfig,
  overrides: Pick<SpawnSubagentParams, "model" | "thinking" | "reasoningEffort">,
): ResolvedModel | null {
  if (overrides.model) {
    const slash = overrides.model.indexOf("/");
    const isQualified = slash > 0;
    const base = resolveModelConfig(agent);
    const provider = isQualified
      ? overrides.model.slice(0, slash)
      : (base?.provider ?? "anthropic");
    const model = isQualified ? overrides.model.slice(slash + 1) : overrides.model;
    const thinkingMode = base?.thinkingMode ?? "flag";
    return {
      provider,
      model,
      thinkingMode,
      thinking: overrides.thinking ?? base?.thinking,
      reasoningEffort: overrides.reasoningEffort ?? base?.reasoningEffort,
    };
  }

  const base = resolveModelConfig(agent);
  if (!base) return null;
  if (overrides.thinking) {
    return { ...base, thinking: overrides.thinking };
  }
  if (overrides.reasoningEffort) {
    return { ...base, reasoningEffort: overrides.reasoningEffort };
  }
  return base;
}

export function buildSystemPrompt(agent: AgentConfig, systemAppend?: string): string {
  const base = agent.systemPrompt.trim();
  const extra = systemAppend?.trim();
  if (!base && !extra) return "";
  if (!extra) return base;
  if (!base) return extra;
  return `${base}\n\n${extra}`;
}

export function buildTask(task: string, response?: SpawnSubagentParams["response"]): string {
  const base = task.trim();
  if (!response) return base;
  return base + formatResponseContractAppendix(response);
}

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

/**
 * Resolve agent config from `agentFile` or discovered `agent` name.
 */
export function resolveSpawnAgent(
  params: Pick<SpawnSubagentParams, "cwd" | "agent" | "agentFile" | "agentScope">,
): { agent: AgentConfig | null; error?: string } {
  const scope = params.agentScope ?? "user";

  if (params.agentFile) {
    const loaded = loadAgentFromFile(params.agentFile);
    if (!loaded) {
      return {
        agent: null,
        error: `Could not load agent file: ${params.agentFile}`,
      };
    }
    return { agent: loaded };
  }

  if (!params.agent) {
    return { agent: null, error: "Provide agentFile or agent." };
  }

  const discovery = discoverAgents(params.cwd, scope);
  const match = discovery.agents.find((candidate) => candidate.name === params.agent);
  if (!match) {
    const available =
      discovery.agents.map((candidate) => `"${candidate.name}"`).join(", ") || "none";
    return {
      agent: null,
      error: `Unknown agent: "${params.agent}". Available agents: ${available}.`,
    };
  }
  return { agent: match };
}
