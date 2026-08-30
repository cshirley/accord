import { describe, expect, test } from "bun:test";
import { runSubagent, SubagentRunError, type SubagentRunEvent } from "../../pi-subagent/src/api.js";

describe("runSubagent programmatic API", () => {
  test("emits resolving then failed for missing agent file", async () => {
    const events: SubagentRunEvent[] = [];
    await expect(
      runSubagent({
        cwd: process.cwd(),
        agentFile: "/tmp/pi-subagent-does-not-exist.md",
        task: "noop",
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toBeInstanceOf(SubagentRunError);

    expect(events.map((event) => event.type)).toEqual(["resolving", "failed"]);
    const failed = events.find((event) => event.type === "failed");
    expect(failed?.type).toBe("failed");
    if (failed?.type === "failed") {
      expect(failed.reason).toBe("agent_resolution");
    }
  });

  test("throws SubagentRunError when caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: SubagentRunEvent[] = [];

    await expect(
      runSubagent({
        cwd: process.cwd(),
        agentFile: "/tmp/pi-subagent-does-not-exist.md",
        task: "noop",
        signal: controller.signal,
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toBeInstanceOf(SubagentRunError);

    const failed = events.find((event) => event.type === "failed");
    expect(failed?.type).toBe("failed");
    if (failed?.type === "failed") {
      expect(failed.reason).toBe("aborted");
    }
  });
});
