import { afterEach, describe, expect, test } from "bun:test";

import { isCoreOrchestratorEnabled } from "@clive.shirley/accord-core/orchestration/env.js";

const KEY = "ACCORD_CORE_ORCHESTRATOR";

afterEach(() => {
  delete process.env[KEY];
});

describe("isCoreOrchestratorEnabled", () => {
  test("enabled when unset or empty", () => {
    delete process.env[KEY];
    expect(isCoreOrchestratorEnabled()).toBe(true);
    process.env[KEY] = "   ";
    expect(isCoreOrchestratorEnabled()).toBe(true);
  });

  test("disabled only with explicit opt-out values", () => {
    for (const value of ["0", "false", "FALSE", "no", "off"]) {
      process.env[KEY] = value;
      expect(isCoreOrchestratorEnabled()).toBe(false);
    }
  });

  test("enabled for explicit on and other non-opt-out values", () => {
    for (const value of ["1", "true", "yes"]) {
      process.env[KEY] = value;
      expect(isCoreOrchestratorEnabled()).toBe(true);
    }
  });
});
