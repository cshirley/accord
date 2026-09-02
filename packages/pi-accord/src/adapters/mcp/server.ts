/**
 * ACCORD MCP server (stdio) — exposes the same `dev_*` tools as the Pi adapter.
 *
 * Working directory: the process cwd is set to ACCORD_CWD (if set) or the initial cwd,
 * so `.tasks/` and `docs/dev/` paths match the Pi extension.
 */

import path from "node:path";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAccordMcpTools } from "./register-tools.js";

const workspaceRoot = path.resolve(process.env.ACCORD_CWD?.trim() || process.cwd());
process.chdir(workspaceRoot);

const mcpHarness = process.env.ACCORD_MCP_HARNESS?.trim();
const harnessLine = mcpHarness
  ? `Spawn harness: ${mcpHarness} (dev_orchestrate executes resume/finish by default).`
  : "Spawn harness: unset (dev_orchestrate is plan-only; set ACCORD_MCP_HARNESS=pi|exec to enable spawns).";

const mcp = new McpServer(
  { name: "accord-dev", version: "1.0.0" },
  {
    instructions: [
      "ACCORD harness tools: same `dev_*` surface as the Pi `/dev` extension.",
      `Project root (cwd): ${workspaceRoot}. Override with ACCORD_CWD.`,
      harnessLine,
      "Requires AGENTS.md with `## Dev Harness` for tools that need stack config (e.g. dev_code_brief).",
    ].join("\n"),
  },
);

registerAccordMcpTools(mcp, () => loadDevHarnessConfig(workspaceRoot), { cwd: workspaceRoot });

const transport = new StdioServerTransport();
await mcp.connect(transport);
