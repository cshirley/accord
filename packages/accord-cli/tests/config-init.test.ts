import { describe, expect, test } from "bun:test";
import {
  buildGlobalAccordConfig,
  defaultTiersForHarness,
} from "../src/config/generate-global-config.js";
import { detectInstalledHarnesses } from "../src/config/detect-harnesses.js";

describe("generate global accord config", () => {
  test("buildGlobalAccordConfig includes backends and tiers", () => {
    const config = buildGlobalAccordConfig({
      defaultHarnessId: "claude",
      backends: [
        {
          id: "claude",
          label: "Claude Code",
          kind: "exec",
          installed: true,
          command: ["claude", "-p"],
          response_json: "stdout",
          binary_env: "ACCORD_CLAUDE_CODE_BIN",
        },
      ],
    });

    expect(config.harness?.default).toBe("claude");
    expect(config.harness?.backends).toHaveLength(1);
    expect(config.harness?.tiers?.reasoning?.harness).toBe("claude");
    expect(config.harness?.tiers?.workhorse?.model).toContain("sonnet");
  });

  test("default tiers exist for each known harness id", () => {
    for (const id of ["pi", "claude", "cursor"]) {
      expect(defaultTiersForHarness(id).workhorse?.harness).toBe(id);
    }
  });

  test("detectInstalledHarnesses returns known backend shape", () => {
    const detected = detectInstalledHarnesses();
    expect(detected.length).toBeGreaterThanOrEqual(3);
    expect(detected.every((entry) => entry.id && entry.label && entry.kind)).toBe(true);
  });
});
