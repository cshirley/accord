import { beforeEach, describe, expect, test } from "bun:test";
import { runSubagentPrepareHook } from "@clive.shirley/accord-core/harness/lifecycle-wiring.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import type { HarnessLifecycleHost } from "@clive.shirley/accord-core/types/harness-lifecycle.js";

describe("runSubagentPrepareHook", () => {
  beforeEach(() => {
    // See orchestration.test.ts: reset the process-wide preflight backend singleton so this
    // host-neutral suite doesn't depend on a real host backend/machine credentials.
    resetSpawnPreflightCheckForTests();
  });

  test("injects agentFile and response contract onto spawn input", async () => {
    const host: HarnessLifecycleHost = {
      notify() {},
      confirm: async () => true,
    };
    const input: Record<string, unknown> = {
      agent: "phase-align",
      task: "Align brief for DEMO-1",
    };

    const result = await runSubagentPrepareHook(
      { agent: "phase-align", task: input.task as string, input },
      { devConfig: null, host, availableToolNames: new Set() },
    );

    expect(result).toEqual({ ok: true });
    expect(typeof input.agentFile).toBe("string");
    expect(input.response).toBeDefined();
  });
});
