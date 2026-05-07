/**
 * ACCORD MCP server (stdio) — exposes the same `dev_*` tools as the Pi adapter.
 *
 * Working directory: the process cwd is set to ACCORD_CWD (if set) or the initial cwd,
 * so `.tasks/` and `docs/dev/` paths match the Pi extension.
 */

import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadDevHarnessConfig } from "../../core/config/index.js";
import { registerAccordMcpTools } from "./register-tools.js";

const workspaceRoot = path.resolve(process.env.ACCORD_CWD?.trim() || process.cwd());
process.chdir(workspaceRoot);

const mcp = new McpServer(
  { name: "accord-dev", version: "1.0.0" },
  {
    instructions: [
      "ACCORD harness tools: same `dev_*` surface as the Pi `/dev` extension.",
      `Project root (cwd): ${workspaceRoot}. Override with ACCORD_CWD.`,
      "Requires AGENTS.md with `## Dev Harness` for tools that need stack config (e.g. dev_code_brief).",
    ].join("\n"),
  },
);

registerAccordMcpTools(mcp, () => loadDevHarnessConfig(workspaceRoot));

const transport = new StdioServerTransport();
await mcp.connect(transport);
