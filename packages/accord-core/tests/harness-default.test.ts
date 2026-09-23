import { afterEach, describe, expect, test } from "bun:test";
import { parseHarnessIdValue, resolveDefaultHarnessId } from "../src/config/harness-default.js";
import type { DevHarnessConfig, DevHarnessGlobalConfig } from "../src/config/types.js";

describe("resolveDefaultHarnessId", () => {
  const previousEnv = process.env.ACCORD_HARNESS;

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.ACCORD_HARNESS;
    else process.env.ACCORD_HARNESS = previousEnv;
  });

  test("ACCORD_HARNESS env wins", () => {
    process.env.ACCORD_HARNESS = "exec";
    expect(resolveDefaultHarnessId(null, null)).toBe("exec");
  });

  test("ignores harness.default from project AGENTS.md", () => {
    delete process.env.ACCORD_HARNESS;
    const devConfig = {
      harness: { default: "exec", exec: { command: ["echo", "project-only"] } },
    } as DevHarnessConfig;
    const globalConfig = { harness: { default: "pi" } } as DevHarnessGlobalConfig;
    expect(resolveDefaultHarnessId(devConfig, globalConfig)).toBe("pi");
  });

  test("uses global harness.exec when project defines its own exec template", () => {
    delete process.env.ACCORD_HARNESS;
    const devConfig = {
      harness: { exec: { command: ["echo", "project-only"] } },
    } as DevHarnessConfig;
    const globalConfig = {
      harness: { exec: { command: ["echo", "ok"] } },
    } as DevHarnessGlobalConfig;
    expect(resolveDefaultHarnessId(devConfig, globalConfig)).toBe("exec");
  });

  test("global harness.default named backend", () => {
    delete process.env.ACCORD_HARNESS;
    const globalConfig = {
      harness: {
        default: "claude",
        backends: [{ id: "claude", label: "Claude", kind: "exec", command: ["claude"] }],
      },
    } as DevHarnessGlobalConfig;
    expect(resolveDefaultHarnessId(null, globalConfig)).toBe("exec");
  });

  test("parseHarnessIdValue rejects unknown ids", () => {
    expect(() => parseHarnessIdValue("cursor")).toThrow(/Unknown harness/);
  });
});
