import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { executeSubagentTool } from "./execute.js";
import { SubagentParams } from "./params.js";
import { renderSubagentCall, renderSubagentResult } from "./render.js";
import type { SubagentDetails } from "./types.js";

export function createSubagentTool(): ToolDefinition<typeof SubagentParams, SubagentDetails> {
  return {
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate tasks to specialized subagents with isolated context.",
      "Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
      'Default agent scope is "user" (from ~/.pi/agent/agents).',
      'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeSubagentTool(params, signal, onUpdate, ctx);
    },

    renderCall(args, theme) {
      return renderSubagentCall(args, theme);
    },

    renderResult(result, options, theme) {
      return renderSubagentResult(result, options, theme);
    },
  };
}
