import { afterEach, describe, expect, test } from "bun:test";
import {
  agentRequiresSpawnPreflight,
  runSubagentSpawnPreflightCheck,
} from "../src/core/queries/subagent-preflight.js";

const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
const savedCursorKey = process.env.CURSOR_API_KEY;

afterEach(() => {
  if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  if (savedCursorKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = savedCursorKey;
});

describe("subagent preflight query", () => {
  test("phase agents require spawn preflight", () => {
    expect(agentRequiresSpawnPreflight("phase-plan")).toBe(true);
    expect(agentRequiresSpawnPreflight("phase-verify-code")).toBe(false);
  });

  test("blocks when no subagent credentials are available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_ACCESS_TOKEN;
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.ok).toBe(false);
    expect(check.blocks.length).toBeGreaterThan(0);
  });

  test("passes when anthropic key is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const check = runSubagentSpawnPreflightCheck("phase-plan");
    expect(check.credential_ok).toBe(true);
    expect(check.agent_file_found).toBe(true);
    expect(check.in_registry).toBe(true);
  });
});
