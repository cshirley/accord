import { afterEach, describe, expect, test } from "bun:test";
import { createMcpOrchestrateHostHints, resolveMcpHarnessId } from "../src/mcp-orchestrate-host.js";

describe("MCP orchestrate host", () => {
  const previous = process.env.ACCORD_MCP_HARNESS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.ACCORD_MCP_HARNESS;
    } else {
      process.env.ACCORD_MCP_HARNESS = previous;
    }
  });

  test("resolveMcpHarnessId returns undefined when unset", () => {
    delete process.env.ACCORD_MCP_HARNESS;
    expect(resolveMcpHarnessId()).toBeUndefined();
  });

  test("resolveMcpHarnessId parses pi and exec", () => {
    process.env.ACCORD_MCP_HARNESS = "pi";
    expect(resolveMcpHarnessId()).toBe("pi");
    process.env.ACCORD_MCP_HARNESS = "exec";
    expect(resolveMcpHarnessId()).toBe("exec");
  });

  test("createMcpOrchestrateHostHints enables execute_by_default when harness set", () => {
    expect(createMcpOrchestrateHostHints(undefined)).toEqual({
      programmatic_spawn_supported: false,
    });
    expect(createMcpOrchestrateHostHints("pi")).toEqual({
      harness: "pi",
      programmatic_spawn_supported: true,
      execute_by_default: true,
    });
  });
});
