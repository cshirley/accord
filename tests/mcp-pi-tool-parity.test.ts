import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertAccordDevToolSurfaceParity } from "../src/adapters/accord-dev-tool-names.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

describe("MCP / Pi dev_* tool surface", () => {
  test("Pi and MCP adapters match accord-dev-tool-names.ts (order, count, parity)", () => {
    const mcpSrc = readFileSync(join(repoRoot, "src/adapters/mcp/register-tools.ts"), "utf8");
    const piSrc = readFileSync(join(repoRoot, "src/adapters/pi/tools.ts"), "utf8");
    expect(() => assertAccordDevToolSurfaceParity(mcpSrc, piSrc)).not.toThrow();
  });

  test("registerAccordMcpTools can be imported (smoke)", async () => {
    const mod = await import("../src/adapters/mcp/register-tools.js");
    expect(typeof mod.registerAccordMcpTools).toBe("function");
  });
});
