/**
 * Pi adapter — registers every entry in `core/tools/ACCORD_TOOLS` with the host.
 *
 * TypeBox `parameters` flow straight through (Pi already speaks TypeBox).
 * Each tool's host-neutral `ToolHandlerResult` is translated into the Pi
 * `AgentToolResult` envelope here.
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { DevHarnessConfig } from "../../core/config/index.js";
import { ACCORD_TOOLS } from "../../core/tools/registry.js";
import type { ToolHandlerContext, ToolHandlerResult } from "../../core/tools/types.js";
import { buildPiSubagentPreflightHints } from "./subagent/preflight-hints.js";

function toPiResult(result: ToolHandlerResult): AgentToolResult<unknown> {
  const text = result.ok ? result.text : `⚠ ${result.text}`;
  return { content: [{ type: "text", text }], details: result.details };
}

function buildToolHandlerContext(
  getConfig: () => DevHarnessConfig | null,
  piCtx?: ExtensionContext,
): ToolHandlerContext {
  return {
    getConfig,
    getSubagentPreflightHints: piCtx
      ? () => buildPiSubagentPreflightHints(piCtx, getConfig())
      : undefined,
  };
}

export function registerTools(pi: ExtensionAPI, getConfig: () => DevHarnessConfig | null): void {
  for (const tool of ACCORD_TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      ...(tool.promptGuidelines ? { promptGuidelines: [...tool.promptGuidelines] } : {}),
      parameters: tool.parameters,
      async execute(_id, params, _signal, _onUpdate, piCtx) {
        const result = await tool.handler(
          params as never,
          buildToolHandlerContext(getConfig, piCtx),
        );
        return toPiResult(result);
      },
    });
  }
}
