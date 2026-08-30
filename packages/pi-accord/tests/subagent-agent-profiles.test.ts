import { describe, expect, test } from "bun:test";
import {
  type AgentConfig,
  resolveModelConfig,
  resolveRequestedProfileName,
  type SubagentConfig,
} from "../../pi-subagent/src/agents.js";

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
        workhorse: { model: "claude-sonnet-4-6", thinking: "medium" },
      },
    },
    "openai-direct": {
      provider: "openai",
      thinkingMode: "reasoning_effort",
      tiers: {
        reasoning: { model: "o3", reasoningEffort: "high" },
        workhorse: { model: "gpt-4.1", reasoningEffort: "medium" },
      },
    },
  },
};

const PHASE_AGENT: AgentConfig = {
  name: "phase-code",
  description: "test",
  tier: "workhorse",
  namespace: "accord",
  systemPrompt: "test",
  source: "user",
  filePath: "/tmp/phase-code.md",
};

const REVIEW_AGENT: AgentConfig = {
  name: "review-test",
  description: "test",
  tier: "reasoning",
  namespace: "accord",
  systemPrompt: "test",
  source: "user",
  filePath: "/tmp/review-test.md",
};

describe("resolveRequestedProfileName", () => {
  test("uses skills profile for phase agents by default", () => {
    expect(resolveRequestedProfileName(PHASE_AGENT, BASE_CFG)).toBe("anthropic-direct");
  });

  test("agentProfiles overrides skills profile", () => {
    const cfg: SubagentConfig = {
      ...BASE_CFG,
      agentProfiles: { "review-test": "openai-direct" },
    };
    expect(resolveRequestedProfileName(REVIEW_AGENT, cfg)).toBe("openai-direct");
  });

  test("reviewProfile applies to review-* when no agentProfiles entry", () => {
    const cfg: SubagentConfig = {
      ...BASE_CFG,
      reviewProfile: "openai-direct",
    };
    expect(resolveRequestedProfileName(REVIEW_AGENT, cfg)).toBe("openai-direct");
    expect(resolveRequestedProfileName(PHASE_AGENT, cfg)).toBe("anthropic-direct");
  });

  test("agentProfiles wins over reviewProfile", () => {
    const cfg: SubagentConfig = {
      ...BASE_CFG,
      reviewProfile: "openai-direct",
      agentProfiles: { "review-test": "anthropic-direct" },
    };
    expect(resolveRequestedProfileName(REVIEW_AGENT, cfg)).toBe("anthropic-direct");
  });
});

describe("resolveModelConfig agentProfiles", () => {
  test("phase agent stays on anthropic profile", () => {
    const cfg: SubagentConfig = {
      ...BASE_CFG,
      reviewProfile: "openai-direct",
    };
    const resolved = resolveModelConfig(PHASE_AGENT, cfg);
    expect(resolved?.provider).toBe("anthropic");
    expect(resolved?.model).toBe("claude-sonnet-4-6");
    expect(resolved?.thinkingMode).toBe("flag");
  });

  test("review agent uses alternate profile with correct thinkingMode", () => {
    const cfg: SubagentConfig = {
      ...BASE_CFG,
      reviewProfile: "openai-direct",
    };
    const resolved = resolveModelConfig(REVIEW_AGENT, cfg);
    expect(resolved?.provider).toBe("openai");
    expect(resolved?.model).toBe("o3");
    expect(resolved?.thinkingMode).toBe("reasoning_effort");
    expect(resolved?.reasoningEffort).toBe("high");
  });
});
