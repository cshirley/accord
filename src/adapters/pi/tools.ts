/**
 * Pi adapter — registers every entry in `core/tools/ACCORD_TOOLS` with the host.
 *
 * TypeBox `parameters` flow straight through (Pi already speaks TypeBox).
 * Each tool's host-neutral `ToolHandlerResult` is translated into the Pi
 * `AgentToolResult` envelope here.
 */

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DevHarnessConfig } from "../../core/config/index.js";
import { ACCORD_TOOLS } from "../../core/tools/registry.js";
import type { ToolHandlerResult } from "../../core/tools/types.js";

function toPiResult(result: ToolHandlerResult): AgentToolResult<unknown> {
  const text = result.ok ? result.text : `⚠ ${result.text}`;
  return { content: [{ type: "text", text }], details: result.details };
}

export function registerTools(pi: ExtensionAPI, getConfig: () => DevHarnessConfig | null): void {
  const ctx = { getConfig };
  for (const tool of ACCORD_TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      parameters: tool.parameters,
      async execute(_id, params) {
        const result = await tool.handler(params as never, ctx);
        return toPiResult(result);
      },
    });
  }
}
