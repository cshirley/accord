/**
 * Headless MCP tool-name discovery for gather preflight.
 *
 * Pi sessions expose live tool names via `getAllTools()`. CLI / exec harness
 * synthesizes likely names from configured `mcp.json` server keys plus bundled
 * provider sidecar `mcpTools`. Override with `ACCORD_AVAILABLE_TOOLS` (comma- or
 * space-separated).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveAccordConfigDir, resolvePiAgentDir } from "../config/paths.js";
import { loadAllProviders } from "./provider-deps.js";

function parseMcpServerKeys(filePath: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
      servers?: Record<string, unknown>;
    };
    const servers = raw.mcpServers ?? raw.servers;
    if (!servers || typeof servers !== "object") return [];
    return Object.keys(servers);
  } catch {
    return [];
  }
}

/** Collect MCP server keys from project + user config files. */
export function readMcpServerKeys(cwd: string): Set<string> {
  const keys = new Set<string>();
  const candidates = [
    join(cwd, ".mcp.json"),
    join(resolveAccordConfigDir(), "mcp.json"),
    join(resolvePiAgentDir(), "mcp.json"),
    join(homedir(), ".config", "mcp", "mcp.json"),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    for (const key of parseMcpServerKeys(filePath)) {
      keys.add(key);
    }
  }
  return keys;
}

function addToolsForConfiguredServers(serverKeys: Set<string>, names: Set<string>): void {
  if (serverKeys.size === 0) return;

  const providers = loadAllProviders();
  const defs = [...providers.trackers.values(), ...providers.enrichments.values()];
  for (const def of defs) {
    for (const tool of def.mcpTools) {
      if (tool.startsWith("mcp__")) {
        const segments = tool.split("__");
        if (segments.length >= 3 && serverKeys.has(segments[1])) {
          names.add(tool);
        }
        continue;
      }
      for (const serverKey of serverKeys) {
        if (tool.includes(serverKey)) {
          names.add(tool);
        }
      }
    }
  }
}

/**
 * Tool names available to gather preflight in headless hosts.
 * Merges `ACCORD_AVAILABLE_TOOLS` with tools inferred from `mcp.json`.
 */
export function discoverAvailableToolNames(cwd: string): Set<string> {
  const names = new Set<string>();

  const explicit = process.env.ACCORD_AVAILABLE_TOOLS?.trim();
  if (explicit) {
    for (const token of explicit.split(/[,\s]+/)) {
      const trimmed = token.trim();
      if (trimmed) names.add(trimmed);
    }
  }

  addToolsForConfiguredServers(readMcpServerKeys(cwd), names);
  return names;
}
