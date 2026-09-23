import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  discoverAvailableToolNames,
  readMcpServerKeys,
} from "../src/integrations/mcp-tool-discovery.js";

describe("mcp tool discovery", () => {
  let tempRoot = "";
  const previousTools = process.env.ACCORD_AVAILABLE_TOOLS;

  afterEach(() => {
    if (previousTools === undefined) delete process.env.ACCORD_AVAILABLE_TOOLS;
    else process.env.ACCORD_AVAILABLE_TOOLS = previousTools;
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  });

  test("readMcpServerKeys loads server keys from project .mcp.json", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accord-mcp-"));
    fs.writeFileSync(
      path.join(tempRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { atlassian: { command: "noop" }, github: {} } }),
    );
    const keys = readMcpServerKeys(tempRoot);
    expect(keys.has("atlassian")).toBe(true);
    expect(keys.has("github")).toBe(true);
  });

  test("discoverAvailableToolNames merges env override and configured servers", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accord-mcp-"));
    fs.writeFileSync(
      path.join(tempRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { atlassian: { command: "noop" } } }),
    );
    process.env.ACCORD_AVAILABLE_TOOLS = "mcp__custom__tool";

    const names = discoverAvailableToolNames(tempRoot);
    expect(names.has("mcp__custom__tool")).toBe(true);
    expect(names.has("mcp__atlassian__getJiraIssue")).toBe(true);
  });
});
