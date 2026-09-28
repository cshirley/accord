import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { invalidateConfigCache } from "@clive.shirley/accord-core/agents/config.js";
import {
  agentRequiresSpawnPreflight,
  runSubagentSpawnPreflightCheck,
} from "../src/queries/subagent-preflight.js";

const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
const savedCursorKey = process.env.CURSOR_API_KEY;
const savedCursorToken = process.env.CURSOR_ACCESS_TOKEN;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
const savedAccordAgentDir = process.env.ACCORD_PI_AGENT_DIR;

let agentDir: string;

const ISOLATED_CONFIG = {
  defaultProfile: "anthropic",
  activeProfile: "anthropic",
  reviewProfile: "anthropic",
  profiles: {
    anthropic: {
      provider: "anthropic",
      thinkingMode: "flag" as const,
      tiers: {
        reasoning: { model: "claude-opus-4-7", thinking: "high" as const },
        workhorse: { model: "claude-sonnet-4-6", thinking: "medium" as const },
        lightweight: { model: "claude-haiku-4-5", thinking: "low" as const },
      },
    },
    "cursor-claude": {
      provider: "cursor",
      thinkingMode: "flag" as const,
      tiers: {
        reasoning: { model: "claude-opus-4-7-thinking" },
        workhorse: { model: "claude-sonnet-4-6" },
        lightweight: { model: "claude-haiku-4-5" },
      },
    },
  },
};

beforeEach(() => {
  // Preflight reads both subagent.json and the credential store from the agent dir.
  // Point BOTH lookup env vars (credentials.ts checks PI_CODING_AGENT_DIR; config.ts's
  // resolvePiAgentDir() checks ACCORD_PI_AGENT_DIR) at an isolated tmp dir so these
  // assertions never depend on the developer's own config, logins, or real machine
  // credentials. Seed a deterministic subagent.json with a known Cursor fallback profile.
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.ACCORD_PI_AGENT_DIR = agentDir;
  fs.writeFileSync(path.join(agentDir, "subagent.json"), JSON.stringify(ISOLATED_CONFIG), "utf8");
  invalidateConfigCache();
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
  if (savedAccordAgentDir === undefined) delete process.env.ACCORD_PI_AGENT_DIR;
  else process.env.ACCORD_PI_AGENT_DIR = savedAccordAgentDir;
  invalidateConfigCache();
  fs.rmSync(agentDir, { recursive: true, force: true });
});

describe("subagent preflight query", () => {
  test("phase agents require spawn preflight", () => {
    expect(agentRequiresSpawnPreflight("phase-plan")).toBe(true);
    expect(agentRequiresSpawnPreflight("phase-verify-code")).toBe(false);
  });

  test("blocks when no subagent credentials are available", () => {
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.ok).toBe(false);
    expect(check.credential_ok).toBe(false);
    expect(check.provider).toBe("anthropic");
    expect(check.blocks.some((block) => block.includes("Cursor credentials"))).toBe(true);
  });

  test("blocks (does not silently swap providers) when only Cursor credentials are available", () => {
    // resolveProfileForCredentials/resolveModelConfig no longer silently substitute an
    // unrelated provider when ANTHROPIC_API_KEY is missing \u2014 the mismatch must be fixed
    // explicitly (set ANTHROPIC_API_KEY, or configure the profile to use Cursor on purpose).
    process.env.CURSOR_API_KEY = "test-key";
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.ok).toBe(false);
    expect(check.credential_ok).toBe(false);
    expect(check.provider).toBe("anthropic");
    expect(check.blocks.some((block) => block.includes("cursor-claude"))).toBe(true);
    expect(check.agent_file_found).toBe(true);
    expect(check.in_registry).toBe(true);
  });

  test("passes when Anthropic credentials are available", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.ok).toBe(true);
    expect(check.credential_ok).toBe(true);
    expect(check.provider).toBe("anthropic");
    expect(check.agent_file_found).toBe(true);
    expect(check.in_registry).toBe(true);
    expect(check.scoped_models).toEqual([]);
    expect(check.judgment_model).not.toBeNull();
  });

  test("warns when spawn model is outside scoped list", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const check = runSubagentSpawnPreflightCheck("phase-plan", process.cwd(), {
      scoped_models: [{ provider: "openai", modelId: "gpt-4o" }],
      judgment_model: null,
    });
    expect(check.ok).toBe(true);
    expect(check.scoped_models.length).toBe(1);
    expect(check.warnings.some((warning) => warning.includes("scoped models"))).toBe(true);
  });
});
