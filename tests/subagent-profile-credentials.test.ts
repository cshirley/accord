import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

/** Same shape, but on the native `cursor` provider under a different name. */
const NATIVE_CFG: SubagentConfig = {
  defaultProfile: "anthropic-direct",
  activeProfile: "anthropic-direct",
  profiles: {
    "anthropic-direct": TEST_CFG.profiles["anthropic-direct"],
    "cursor-anthropic": {
      provider: "cursor",
      thinkingMode: "flag",
      tiers: {
        workhorse: { model: "composer-2.5" },
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
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;

let agentDir: string;

/** Write an auth.json holding OAuth credentials for the given providers. */
function writeStoredCredentials(...providers: string[]): void {
  const data = Object.fromEntries(
    providers.map((provider) => [
      provider,
      { type: "oauth", access: "test-access", refresh: "test-refresh", expires: 1e13 },
    ]),
  );
  fs.writeFileSync(path.join(agentDir, "auth.json"), JSON.stringify(data));
}

beforeEach(() => {
  // Point the credential store at an empty directory so these assertions never
  // depend on whichever providers the developer happens to be logged into.
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-creds-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_ACCESS_TOKEN;
});

afterEach(() => {
  if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  if (savedCursorKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = savedCursorKey;
  if (savedCursorToken === undefined) delete process.env.CURSOR_ACCESS_TOKEN;
  else process.env.CURSOR_ACCESS_TOKEN = savedCursorToken;
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("resolveProfileForCredentials", () => {
  test("keeps anthropic profile when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("anthropic-direct");
  });

  test("falls back to cursor-claude when Anthropic key missing and Cursor key present", () => {
    process.env.CURSOR_API_KEY = "test-cursor";
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("cursor-claude");
  });

  test("keeps anthropic profile when neither credential is available", () => {
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("anthropic-direct");
  });

  test("falls back to a native cursor profile under any name", () => {
    process.env.CURSOR_API_KEY = "test-cursor";
    expect(resolveProfileForCredentials(NATIVE_CFG, "anthropic-direct")).toBe("cursor-anthropic");
  });

  test("accepts a stored OAuth credential with no env var set", () => {
    writeStoredCredentials("cursor");
    expect(resolveProfileForCredentials(NATIVE_CFG, "anthropic-direct")).toBe("cursor-anthropic");
  });

  test("ignores a cursor profile whose provider has no credentials", () => {
    writeStoredCredentials("cursor");
    expect(resolveProfileForCredentials(TEST_CFG, "anthropic-direct")).toBe("anthropic-direct");
  });

  test("prefers the native cursor provider over legacy cursor-agent", () => {
    writeStoredCredentials("cursor", "cursor-agent");
    const bothCfg: SubagentConfig = {
      ...TEST_CFG,
      profiles: { ...TEST_CFG.profiles, ...NATIVE_CFG.profiles },
    };
    expect(resolveProfileForCredentials(bothCfg, "anthropic-direct")).toBe("cursor-anthropic");
  });
});

describe("resolveModelConfig credential fallback", () => {
  test("uses cursor-agent provider when Anthropic key missing", () => {
    process.env.CURSOR_API_KEY = "test-cursor";
    const resolved = resolveModelConfig(TEST_AGENT, TEST_CFG);
    expect(resolved?.provider).toBe("cursor-agent");
    expect(resolved?.model).toBe("claude-sonnet-4-6");
  });

  test("uses the native cursor provider when that is the profile on offer", () => {
    writeStoredCredentials("cursor");
    const resolved = resolveModelConfig(TEST_AGENT, NATIVE_CFG);
    expect(resolved?.provider).toBe("cursor");
    expect(resolved?.model).toBe("composer-2.5");
  });
});
