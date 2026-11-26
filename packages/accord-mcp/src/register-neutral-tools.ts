/**
 * Opt-in MCP exposure of pi-git / pi-integrations tools (the accord-tools registry).
 *
 *   ACCORD_MCP_EXTRA_TOOLS=git,integrations   which groups to expose (default: none)
 *   ACCORD_MCP_ALLOW_WRITES=1                  also expose tools that mutate external state
 */

import { neutralTools, type ParamDef } from "@clive.shirley/accord-tools/src/registry.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function paramToZod(raw: ParamDef | ParamDef["type"]): z.ZodTypeAny {
  const def: ParamDef = typeof raw === "string" ? { type: raw, required: true } : raw;
  let t: z.ZodTypeAny;
  switch (def.type) {
    case "number":
      t = z.number();
      break;
    case "boolean":
      t = z.boolean();
      break;
    case "string[]":
      t = z.array(z.string());
      break;
    case "number[]":
      t = z.array(z.number());
      break;
    default:
      t = z.string();
  }
  if (def.description) t = t.describe(def.description);
  const required = def.required ?? def.default === undefined;
  return required ? t : t.optional();
}

export function registerNeutralMcpTools(
  mcp: McpServer,
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): string[] {
  const env = options.env ?? process.env;
  const groups = new Set(
    (env.ACCORD_MCP_EXTRA_TOOLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (groups.size === 0) return [];
  const allowWrites = env.ACCORD_MCP_ALLOW_WRITES === "1";
  const registered: string[] = [];

  for (const tool of neutralTools()) {
    const group = tool.kind === "git" ? "git" : "integrations";
    if (!groups.has(group)) continue;
    if (tool.writes && !allowWrites) continue;
    const shape = Object.fromEntries(
      Object.entries(tool.params).map(([k, v]) => [k, paramToZod(v)]),
    );
    mcp.registerTool(
      tool.name,
      { description: tool.description, inputSchema: shape as never },
      (async (params: Record<string, unknown>) => {
        const out = await tool.run(params, options.cwd);
        const body =
          out.details === undefined
            ? out.text
            : `${out.text}\n---\n${JSON.stringify(out.details, null, 2)}`;
        return out.ok
          ? { content: [{ type: "text" as const, text: body }] }
          : { content: [{ type: "text" as const, text: `⚠ ${out.text}` }], isError: true as const };
      }) as never,
    );
    registered.push(tool.name);
  }
  return registered;
}
