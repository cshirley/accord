import { afterAll, describe, expect, mock, test } from "bun:test";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "../src/agents.js";
import { executeSubagentTool } from "../src/tool/execute.js";
import { renderSubagentResult } from "../src/tool/render.js";
import type { SubagentDetails } from "../src/tool/types.js";

const spawnCalls: Array<Record<string, unknown>> = [];

const runSubagentMock = mock(async (params: Record<string, unknown>) => {
  spawnCalls.push(params);
  return {
    agent: String(params.agent ?? "review-code"),
    agentSource: "user",
    task: String(params.task ?? ""),
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    output: "harvested-only output",
  };
});

mock.module("../src/spawn/run.js", () => ({
  runSubagent: runSubagentMock,
}));

afterAll(() => {
  mock.restore();
});

const noopTheme = {
  fg: (_role: string, text: string) => text,
  bold: (text: string) => text,
} as Parameters<typeof renderSubagentResult>[2];

describe("executeSubagentTool output wiring", () => {
  test("single mode returns harvested output when messages are empty", async () => {
    spawnCalls.length = 0;
    const cwd = process.cwd();
    const agents = discoverAgents(cwd, "user").agents;
    const reviewCode = agents.find((agent) => agent.name === "review-code");
    expect(reviewCode).toBeDefined();

    const result = await executeSubagentTool(
      {
        agent: "review-code",
        task: "review diff",
        agentFile: "/tmp/untrusted-review-code.md",
      },
      undefined,
      undefined,
      { cwd, hasUI: false, ui: { confirm: async () => true } } as unknown as ExtensionCommandContext,
    );

    const first = result.content[0];
    expect(first?.type).toBe("text");
    expect(first?.type === "text" ? first.text : "").toBe("harvested-only output");
    expect(spawnCalls[0]?.agentFile).toBe(reviewCode?.filePath);
  });
});

describe("renderSubagentResult harvested preview", () => {
  test("collapsed parallel mode shows harvested preview when messages are empty", () => {
    const details: SubagentDetails = {
      mode: "parallel",
      agentScope: "user",
      projectAgentsDir: null,
      results: [
        {
          agent: "review-code",
          agentSource: "user",
          task: "t",
          exitCode: 0,
          messages: [],
          stderr: "",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: 0,
            contextTokens: 0,
            turns: 0,
          },
          output: "harvested-only output",
        },
      ],
    };

    const rendered = renderSubagentResult(
      {
        content: [{ type: "text", text: "Parallel: 1/1 succeeded" }],
        details,
      } as AgentToolResult<SubagentDetails>,
      { expanded: false, isPartial: false },
      noopTheme,
    );

    const text = String((rendered as { text?: string }).text ?? rendered);
    expect(text).toContain("harvested-only output");
    expect(text).not.toContain("SECRET");
  });
});
