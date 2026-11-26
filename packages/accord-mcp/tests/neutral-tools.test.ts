import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNeutralMcpTools } from "../src/register-neutral-tools.js";

const mk = () => new McpServer({ name: "t", version: "0" });

describe("neutral MCP tools (opt-in)", () => {
  test("registers nothing by default", () => {
    expect(registerNeutralMcpTools(mk(), { cwd: ".", env: {} })).toEqual([]);
  });
  test("git group exposes read tools, hides writes", () => {
    const names = registerNeutralMcpTools(mk(), {
      cwd: ".",
      env: { ACCORD_MCP_EXTRA_TOOLS: "git" },
    });
    expect(names).toContain("repo_verify");
    expect(names).not.toContain("git_commit_execute");
    expect(names).not.toContain("gh_pr_submit");
  });
  test("writes require ACCORD_MCP_ALLOW_WRITES=1", () => {
    const names = registerNeutralMcpTools(mk(), {
      cwd: ".",
      env: { ACCORD_MCP_EXTRA_TOOLS: "git,integrations", ACCORD_MCP_ALLOW_WRITES: "1" },
    });
    expect(names).toContain("git_commit_execute");
    expect(names.some((n) => /slack/i.test(n))).toBe(true);
  });
  test("integrations without writes hide slack send", () => {
    const names = registerNeutralMcpTools(mk(), {
      cwd: ".",
      env: { ACCORD_MCP_EXTRA_TOOLS: "integrations" },
    });
    expect(names.some((n) => /send/i.test(n))).toBe(false);
  });
});
