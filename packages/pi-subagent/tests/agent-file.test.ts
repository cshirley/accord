import { describe, expect, test } from "bun:test";
import type { AgentConfig } from "../src/agents.js";
import { resolveTrustedAgentFile } from "../src/tool/agent-file.js";

const agents: AgentConfig[] = [
  {
    name: "review-code",
    filePath: "/agents/review-code.md",
    source: "user",
    description: "code review",
    namespace: "accord",
    systemPrompt: "review",
  },
  {
    name: "review-security",
    filePath: "/agents/review-security.md",
    source: "user",
    description: "security review",
    namespace: "accord",
    systemPrompt: "review",
  },
];

describe("resolveTrustedAgentFile", () => {
  test("returns discovered path when explicit path is omitted", () => {
    expect(resolveTrustedAgentFile("review-code", agents)).toBe("/agents/review-code.md");
  });

  test("accepts explicit path that matches the named agent", () => {
    expect(resolveTrustedAgentFile("review-code", agents, "/agents/review-code.md")).toBe(
      "/agents/review-code.md",
    );
  });

  test("ignores explicit path for a different agent file", () => {
    expect(resolveTrustedAgentFile("review-code", agents, "/agents/review-security.md")).toBe(
      "/agents/review-code.md",
    );
  });

  test("ignores arbitrary paths with no catalog match", () => {
    expect(resolveTrustedAgentFile("review-code", agents, "/tmp/evil.md")).toBe(
      "/agents/review-code.md",
    );
  });
});
