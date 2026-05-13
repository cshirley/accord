import { describe, expect, test } from "bun:test";

import type { DevHarnessConfig } from "../src/core/config/index.js";
import { buildDevOrchestratePayload } from "../src/core/orchestration/runner.js";

/** Minimal valid Dev Harness block — enough for orchestration planning. */
function stubDevConfig(): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
  };
}

describe("dev_orchestrate payload contract (MCP / Pi tools)", () => {
  test("every payload includes stable top-level keys for headless clients", () => {
    const devConfig = stubDevConfig();
    for (const command of ["resume", "finish"] as const) {
      const payload = buildDevOrchestratePayload(command, "NO-SUCH-WORK-ITEM", devConfig);
      expect(payload.command).toBe(command);
      expect(payload).toHaveProperty("resolution");
      expect(Array.isArray(payload.next_steps)).toBe(true);
      expect(payload.programmatic_spawn_supported).toBe(false);
      expect(typeof payload.judgment_configured_for_spawn).toBe("boolean");
      if (payload.judgment_configured_for_spawn) {
        expect(typeof payload.spawn_task_after_template_judgment).toBe("string");
        expect(payload.spawn_task_after_template_judgment!.length).toBeGreaterThan(0);
      } else {
        expect(payload.spawn_task_after_template_judgment).toBeUndefined();
      }
    }
  });

  test("finish never sets judgment_configured_for_spawn (judgment is resume-execution only)", () => {
    const payload = buildDevOrchestratePayload("finish", "NO-SUCH-WORK-ITEM", stubDevConfig());
    expect(payload.command).toBe("finish");
    expect(payload.judgment_configured_for_spawn).toBe(false);
    expect(payload.spawn_task_after_template_judgment).toBeUndefined();
  });
});
