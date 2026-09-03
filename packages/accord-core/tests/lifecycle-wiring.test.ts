import { describe, expect, test } from "bun:test";
import { runSubagentPrepareHook } from "@clive.shirley/accord-core/harness/lifecycle-wiring.js";
import type { HarnessLifecycleHost } from "@clive.shirley/accord-core/types/harness-lifecycle.js";

describe("runSubagentPrepareHook", () => {
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
