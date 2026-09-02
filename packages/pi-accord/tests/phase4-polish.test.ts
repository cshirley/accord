import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ACCORD_CORE_TOOLS } from "@clive.shirley/accord-core/tools/active-set.js";
import { ACCORD_TOOLS } from "@clive.shirley/accord-core/tools/registry.js";
import { loadAgentFromFile } from "../../pi-subagent/src/agent-load.js";
import {
  type AgentConfig,
  resolveModelConfig,
  type SubagentConfig,
} from "../../pi-subagent/src/agents.js";
import { appendThinkingCliArgs } from "../../pi-subagent/src/spawn/cli-args.js";
import {
  ACCORD_RUN_ID_HEADER,
  ACCORD_SESSION_TAG_HEADER,
  ACCORD_WORK_ITEM_ID_HEADER,
  buildHarnessCorrelationHeaders,
} from "../src/adapters/pi/correlation-headers.js";

const repoRoot = join(import.meta.dirname, "..");

describe("buildHarnessCorrelationHeaders", () => {
  test("omits empty values", () => {
    expect(buildHarnessCorrelationHeaders({})).toEqual({});
    expect(buildHarnessCorrelationHeaders({ runId: "  " })).toEqual({});
  });

  test("includes run, tag, and work item when set", () => {
    expect(
      buildHarnessCorrelationHeaders({
        runId: "run-42",
        sessionTag: "sprint-9",
        workItemId: "ACCORD-123",
      }),
    ).toEqual({
      [ACCORD_RUN_ID_HEADER]: "run-42",
      [ACCORD_SESSION_TAG_HEADER]: "sprint-9",
      [ACCORD_WORK_ITEM_ID_HEADER]: "ACCORD-123",
    });
  });
});

describe("ACCORD core tool promptGuidelines", () => {
  test("core tools expose named promptGuidelines for Pi Guidelines section", () => {
    for (const toolName of ACCORD_CORE_TOOLS) {
      if (toolName === "subagent") continue;
      const tool = ACCORD_TOOLS.find((entry) => entry.name === toolName);
      expect(tool?.promptGuidelines?.length).toBeGreaterThan(0);
      for (const guideline of tool?.promptGuidelines ?? []) {
        expect(guideline).toContain(toolName);
      }
    }
  });
});

describe("appendThinkingCliArgs", () => {
  test("passes xhigh through flag thinking mode", () => {
    const args: string[] = [];
    appendThinkingCliArgs(args, {
      provider: "anthropic",
      model: "claude-opus-4-7",
      thinkingMode: "flag",
      thinking: "xhigh",
    });
    expect(args).toEqual(["--thinking", "xhigh"]);
  });

  test("passes max through flag thinking mode", () => {
    const args: string[] = [];
    appendThinkingCliArgs(args, {
      provider: "openai",
      model: "gpt-5.6",
      thinkingMode: "flag",
      thinking: "max",
    });
    expect(args).toEqual(["--thinking", "max"]);
  });

  test("uses reasoning_effort for openai profiles", () => {
    const args: string[] = [];
    appendThinkingCliArgs(args, {
      provider: "openai",
      model: "o3",
      thinkingMode: "reasoning_effort",
      reasoningEffort: "high",
    });
    expect(args).toEqual(["--reasoning-effort", "high"]);
  });
});

describe("review agent thinking frontmatter", () => {
  const BASE_CFG: SubagentConfig = {
    defaultProfile: "anthropic-direct",
    activeProfile: "anthropic-direct",
    skills: { accord: { profile: "anthropic-direct" } },
    profiles: {
      "anthropic-direct": {
        provider: "anthropic",
        thinkingMode: "flag",
        tiers: {
          reasoning: { model: "claude-opus-4-7", thinking: "high" },
          workhorse: { model: "claude-sonnet-4-6", thinking: "low" },
        },
      },
    },
  };

  test("review-code frontmatter pins xhigh over workhorse tier default", () => {
    const filePath = join(repoRoot, "assets/agents/accord/review-code.md");
    const agent = loadAgentFromFile(filePath);
    expect(agent?.thinking).toBe("xhigh");
    const resolved = resolveModelConfig(agent as AgentConfig, BASE_CFG);
    expect(resolved?.thinking).toBe("xhigh");
    expect(resolved?.model).toBe("claude-sonnet-4-6");
  });
});
