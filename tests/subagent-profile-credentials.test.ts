import { afterEach, describe, expect, test } from "bun:test";
import {
  type AgentConfig,
  resolveModelConfig,
  resolveProfileForCredentials,
  type SubagentConfig,
} from "../packages/pi-subagent/src/agents.js";

const TEST_CFG: SubagentConfig = {
  defaultProfile: "anthropic-direct",
  activeProfile: "anthropic-direct",
  profiles: {
    "anthropic-direct": {
      provider: "anthropic",
      thinkingMode: "flag",
      tiers: {
        workhorse: { model: "claude-sonnet-4-6", thinking: "medium" },
      },
    },
    "cursor-claude": {
      provider: "cursor-agent",
      thinkingMode: "embedded",
      tiers: {
        workhorse: { model: "claude-sonnet-4-6" },
      },
    },
  },
};

const TEST_AGENT: AgentConfig = {
  name: "default",
  description: "test",
  tier: "workhorse",
  systemPrompt: "test",
  source: "user",
  filePath: "/tmp/default.md",
};

const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
const savedCursorKey = process.env.CURSOR_API_KEY;
const savedCursorToken = process.env.CURSOR_ACCESS_TOKEN;

afterEach(() => {
  if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  if (savedCursorKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = savedCursorKey;
  if (savedCursorToken === undefined) delete process.env.CURSOR_ACCESS_TOKEN;
  else process.env.CURSOR_ACCESS_TOKEN = savedCursorToken;
});

describe("resolveProfileForCredentials", () => {
  test("keeps anthropic profile when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.CURSOR_API_KEY;
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("anthropic-direct");
  });

  test("falls back to cursor-claude when Anthropic key missing and Cursor key present", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CURSOR_API_KEY = "test-cursor";
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("cursor-claude");
  });

  test("keeps anthropic profile when neither credential is available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_ACCESS_TOKEN;
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("anthropic-direct");
  });
});

describe("resolveModelConfig credential fallback", () => {
  test("uses cursor-agent provider when Anthropic key missing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CURSOR_API_KEY = "test-cursor";
    const resolved = resolveModelConfig(TEST_AGENT, TEST_CFG);
    expect(resolved?.provider).toBe("cursor-agent");
    expect(resolved?.model).toBe("claude-sonnet-4-6");
  });
});
