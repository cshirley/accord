import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  agentRequiresSpawnPreflight,
  runSubagentSpawnPreflightCheck,
} from "../src/queries/subagent-preflight.js";

const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
const savedCursorKey = process.env.CURSOR_API_KEY;
const savedCursorToken = process.env.CURSOR_ACCESS_TOKEN;
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;

let agentDir: string;

beforeEach(() => {
  // Preflight reads both subagent.json and the credential store from the agent
  // dir. Point it at an empty directory so these assertions never depend on the
  // developer's own config or logins. Agent markdown still resolves via the
  // bundled assets/agents/accord fallback.
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
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

describe("subagent preflight query", () => {
  test("phase agents require spawn preflight", () => {
    expect(agentRequiresSpawnPreflight("phase-plan")).toBe(true);
    expect(agentRequiresSpawnPreflight("phase-verify-code")).toBe(false);
  });

  test("blocks when no subagent credentials are available", () => {
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.ok).toBe(false);
    expect(check.credential_ok).toBe(false);
    expect(check.blocks.some((b) => b.includes("ANTHROPIC_API_KEY is unset"))).toBe(true);
  });

  test("passes when anthropic key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.credential_ok).toBe(true);
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
    expect(check.warnings.some((w) => w.includes("scoped models"))).toBe(true);
  });
});
