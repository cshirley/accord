import { describe, expect, test } from "bun:test";
import type { SubagentConfig } from "../packages/pi-subagent/src/agents.js";
import {
  DEFAULT_SPAWN_TIMEOUT_MS,
  resolveSpawnTimeoutMs,
  SPAWN_TIMEOUT_DISABLED,
} from "../packages/pi-subagent/src/spawn/timeout.js";

describe("resolveSpawnTimeoutMs", () => {
  const config: SubagentConfig = {
    defaultProfile: "p",
    profiles: {
      p: {
        provider: "anthropic",
        thinkingMode: "flag",
        tiers: { workhorse: { model: "claude-sonnet-4-6" } },
      },
    },
    spawnTimeoutMs: 60_000,
  };

  test("explicit positive request wins", () => {
    expect(resolveSpawnTimeoutMs(5_000, config)).toBe(5_000);
  });

  test("zero disables timeout", () => {
    expect(resolveSpawnTimeoutMs(SPAWN_TIMEOUT_DISABLED, config)).toBeUndefined();
  });

  test("omitted request uses config spawnTimeoutMs", () => {
    expect(resolveSpawnTimeoutMs(undefined, config)).toBe(60_000);
  });

  test("omitted request and config use code default", () => {
    expect(resolveSpawnTimeoutMs(undefined, { ...config, spawnTimeoutMs: undefined })).toBe(
      DEFAULT_SPAWN_TIMEOUT_MS,
    );
  });

  test("ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS overrides code default when config omits spawnTimeoutMs", () => {
    const saved = process.env.ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS;
    process.env.ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS = "15000";
    try {
      expect(resolveSpawnTimeoutMs(undefined, { ...config, spawnTimeoutMs: undefined })).toBe(
        15_000,
      );
    } finally {
      if (saved === undefined) delete process.env.ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS;
      else process.env.ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS = saved;
    }
  });
});
