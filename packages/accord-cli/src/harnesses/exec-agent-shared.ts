/**
 * Shared helpers for ACCORD exec harness agent CLI backends (Cursor, Claude Code, …).
 */

import * as fs from "node:fs";
import { loadGlobalConfig } from "@clive.shirley/accord-core/config/global.js";
import { mergeHarnessConfig, resolveAgentTierConfig } from "@clive.shirley/accord-core/config/harness-resolve.js";
import type { DevHarnessHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import { loadAgentFromFile, resolveModelConfig } from "@clive.shirley/accord-core/agents/index.js";
import type { AgentConfig, ModelTier, ResolvedModel } from "@clive.shirley/accord-core/agents/types.js";

export type ExecAgentSpawnArgs = {
  taskFile: string;
  agentFile?: string;
  systemAppendFile?: string;
  cwd?: string;
  agentId?: string;
};

export function readFileIfExists(filePath: string | undefined): string {
  if (!filePath) return "";
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/** Infer skill namespace from `.../agents/<namespace>/...` path segments. */
export function inferAgentNamespace(agentFile: string): string | undefined {
  const match = agentFile.match(/[/\\]agents[/\\]([^/\\]+)[/\\]/);
  return match?.[1];
}

export function loadAgentFromSpawnFile(agentFile: string | undefined): AgentConfig | null {
  if (!agentFile) return null;
  return loadAgentFromFile(agentFile, {
    source: "explicit",
    namespace: inferAgentNamespace(agentFile),
  });
}

export function resolveMergedHarnessConfig(
  projectHarness?: DevHarnessHarnessConfig,
): DevHarnessHarnessConfig | undefined {
  const globalConfig = loadGlobalConfig();
  return mergeHarnessConfig(globalConfig?.harness, projectHarness);
}

function tierConfigToResolvedModel(tier: {
  harness: string;
  model: string;
  thinking?: ResolvedModel["thinking"];
  reasoning_effort?: ResolvedModel["reasoningEffort"];
}): ResolvedModel {
  const slash = tier.model.indexOf("/");
  const hasProvider = slash > 0;
  const provider = hasProvider ? tier.model.slice(0, slash) : inferProviderFromHarnessId(tier.harness);
  const model = hasProvider ? tier.model.slice(slash + 1) : tier.model;
  const thinkingMode =
    tier.reasoning_effort || /^gpt-/i.test(model) ? "reasoning_effort" : ("flag" as const);
  return {
    provider,
    model,
    thinkingMode,
    thinking: tier.thinking,
    reasoningEffort: tier.reasoning_effort,
  };
}

function inferProviderFromHarnessId(harnessId: string): string {
  if (harnessId === "cursor") return "cursor";
  if (harnessId === "claude") return "anthropic";
  return "anthropic";
}

/** Resolve model + thinking from accord.json tiers, else subagent.json profiles. */
export function resolveSpawnModelFromAgentFile(
  agentFile: string | undefined,
  harnessConfig?: DevHarnessHarnessConfig,
): ResolvedModel | null {
  const agent = loadAgentFromSpawnFile(agentFile);
  if (!agent) return null;

  const mergedHarness = harnessConfig ?? resolveMergedHarnessConfig();
  const tierConfig = resolveAgentTierConfig(mergedHarness, {
    tier: (agent.tier ?? "workhorse") as ModelTier,
    agentName: agent.name,
  });
  if (tierConfig) {
    return tierConfigToResolvedModel(tierConfig);
  }

  return resolveModelConfig(agent);
}

export function parseExecAgentSpawnArgv(
  argv: string[],
  programName: string,
): ExecAgentSpawnArgs {
  let taskFile = "";
  let agentFile: string | undefined;
  let systemAppendFile: string | undefined;
  let cwd: string | undefined;
  let agentId: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--task-file=")) taskFile = arg.slice("--task-file=".length);
    else if (arg.startsWith("--agent-file=")) agentFile = arg.slice("--agent-file=".length);
    else if (arg.startsWith("--system-append-file=")) {
      systemAppendFile = arg.slice("--system-append-file=".length);
    } else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (arg.startsWith("--agent=")) agentId = arg.slice("--agent=".length);
    else if (arg === "--help" || arg === "-h") {
      console.error(
        `Usage: ${programName} --task-file=PATH [--agent-file=PATH] [--system-append-file=PATH] [--cwd=PATH] [--agent=ID]`,
      );
      process.exit(0);
    } else {
      throw new Error(`${programName}: unknown argument: ${arg}`);
    }
  }

  if (!taskFile) {
    throw new Error(`${programName}: --task-file is required`);
  }
  if (!fs.existsSync(taskFile)) {
    throw new Error(`${programName}: task file not found: ${taskFile}`);
  }

  return { taskFile, agentFile, systemAppendFile, cwd, agentId };
}

/** Build combined prompt for Cursor `agent --print` (body + append + task). */
export function buildCursorAgentPrompt(options: {
  agentBody?: string;
  systemAppend?: string;
  task: string;
}): string {
  const parts = [options.agentBody?.trim(), options.systemAppend?.trim(), options.task.trim()].filter(
    (part): part is string => Boolean(part?.length),
  );
  return parts.join("\n\n---\n\n");
}

const ACCORD_TOOL_TO_CLAUDE: Record<string, string> = {
  read: "Read",
  grep: "Grep",
  find: "Glob",
  bash: "Bash",
  write: "Write",
  edit: "Edit",
};

/** Map Pi-style agent tool flags to Claude Code `--tools` names. */
export function formatClaudeCodeTools(agent: AgentConfig | null): string[] | undefined {
  if (!agent?.tools?.length) return undefined;
  const mapped = agent.tools
    .map((tool) => ACCORD_TOOL_TO_CLAUDE[tool.toLowerCase()])
    .filter((tool): tool is string => Boolean(tool));
  return mapped.length > 0 ? [...new Set(mapped)] : undefined;
}
