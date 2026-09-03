import { describe, expect, test } from "bun:test";
import {
  mergeHarnessConfig,
  parseHarnessSelection,
  resolveAgentTierConfig,
  resolveBackendExecConfig,
} from "../src/config/harness-resolve.js";
import type { DevHarnessHarnessConfig } from "../src/config/types.js";

const SAMPLE: DevHarnessHarnessConfig = {
  default: "claude",
  backends: [
    {
      id: "claude",
      label: "Claude Code",
      kind: "exec",
      command: ["claude", "-p"],
    },
    {
      id: "cursor",
      label: "Cursor Agent",
      kind: "exec",
      command: ["agent", "--print"],
    },
    {
      id: "pi",
      label: "Pi CLI",
      kind: "pi",
    },
  ],
  tiers: {
    reasoning: { harness: "claude", model: "claude-opus-4-7", thinking: "high" },
    workhorse: { harness: "cursor", model: "composer-2.5", thinking: "medium" },
    review: { harness: "pi", model: "anthropic/claude-opus-4-7", thinking: "xhigh" },
  },
};

describe("harness-resolve", () => {
  test("parseHarnessSelection accepts named backend ids", () => {
    expect(parseHarnessSelection("claude", SAMPLE)).toEqual({
      harnessId: "exec",
      backendId: "claude",
    });
    expect(parseHarnessSelection("pi", SAMPLE)).toEqual({ harnessId: "pi" });
  });

  test("parseHarnessSelection rejects unknown backend", () => {
    expect(() => parseHarnessSelection("cursor", undefined)).toThrow(/Unknown harness/);
  });

  test("mergeHarnessConfig merges project tiers only", () => {
    const merged = mergeHarnessConfig(SAMPLE, {
      tiers: { workhorse: { harness: "claude", model: "claude-sonnet-4-6", thinking: "low" } },
    });
    expect(merged?.tiers?.workhorse?.thinking).toBe("low");
    expect(merged?.backends).toHaveLength(3);
  });

  test("mergeHarnessConfig ignores project executable backends", () => {
    const merged = mergeHarnessConfig(SAMPLE, {
      default: "cursor",
      backends: [
        { id: "evil", label: "Evil", kind: "exec", command: ["rm", "-rf", "/"] },
      ],
      exec: { command: ["curl", "evil"] },
    });
    expect(merged?.default).toBe("claude");
    expect(merged?.backends?.map((backend) => backend.id)).toEqual(["claude", "cursor", "pi"]);
    expect(merged?.exec).toBeUndefined();
  });

  test("resolveBackendExecConfig picks backend command", () => {
    const exec = resolveBackendExecConfig(SAMPLE, "cursor");
    expect(exec?.command).toEqual(["agent", "--print"]);
  });

  test("resolveAgentTierConfig returns review override", () => {
    const tier = resolveAgentTierConfig(SAMPLE, { agentName: "review-code" });
    expect(tier?.harness).toBe("pi");
  });
});
