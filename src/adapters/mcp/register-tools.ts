/**
 * MCP adapter — registers every entry in `core/tools/ACCORD_TOOLS` on the MCP server.
 *
 * TypeBox `parameters` are compiled to a `ZodRawShape` via
 * `compileSchemaToZodShape`. Each tool's host-neutral `ToolHandlerResult` is
 * rendered into MCP `content[]` here.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DevHarnessConfig } from "../../core/config/index.js";
import { compileSchemaToZodShape } from "../../core/tools/compile-zod.js";
import { ACCORD_TOOLS } from "../../core/tools/registry.js";
import type { ToolHandlerResult } from "../../core/tools/types.js";

function toMcpResult(result: ToolHandlerResult): {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
} {
  if (!result.ok) {
    return { content: [{ type: "text", text: `⚠ ${result.text}` }], isError: true };
  }
  const body =
    result.details === undefined
      ? result.text
      : `${result.text}\n---\n${JSON.stringify(result.details, null, 2)}`;
  return { content: [{ type: "text", text: body }] };
}

export function registerAccordMcpTools(
  mcp: McpServer,
  getConfig: () => DevHarnessConfig | null,
): void {
  const ctx = { getConfig };
  for (const tool of ACCORD_TOOLS) {
    mcp.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: compileSchemaToZodShape(tool.parameters),
      },
      async (params: Record<string, unknown>) => {
        const result = await tool.handler(params as never, ctx);
        return toMcpResult(result);
      },
    );
  }
}
