/**
 * AC-12 + AC-13: literal cache key/path/exclusion contract for setup-accord.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SETUP_ACCORD = join(REPO_ROOT, ".github/actions/setup-accord/action.yml");

const composite = parseYaml(readFileSync(SETUP_ACCORD, "utf8")) as {
  runs: { using: string; steps: Array<Record<string, unknown>> };
};

const steps = composite.runs.steps;

const EXPECTED_CACHE_KEY =
  "accord-${{ runner.os }}-${{ inputs.harness }}-${{ inputs.accord_ref }}-${{ hashFiles('.accord-ci/bun.lock', '.accord-ci/packages/accord-assets/manifest.json') }}";

const EXPECTED_RESTORE_KEYS = [
  "accord-${{ runner.os }}-${{ inputs.harness }}-${{ inputs.accord_ref }}-",
  "accord-${{ runner.os }}-${{ inputs.harness }}-",
];

const EXPECTED_PATH_ROOTS = [
  "~/.npm",
  "~/.bun/install/cache",
  "~/.config/accord",
  "~/.config/pi/agent",
  ".accord-ci/node_modules",
] as const;

function findCacheSteps(): Array<Record<string, unknown>> {
  return steps.filter(
    (s) => typeof s.uses === "string" && (s.uses as string).startsWith("actions/cache@"),
  );
}

describe("setup-accord composite — single actions/cache@v4 step (AC-12)", () => {
  test("exactly one actions/cache step exists", () => {
    expect(findCacheSteps().length).toBe(1);
  });

  test("the cache step uses actions/cache@v4 (pinned major)", () => {
    const cacheSteps = findCacheSteps();
    expect(cacheSteps.length).toBeGreaterThan(0);
    expect((cacheSteps[0].uses as string).startsWith("actions/cache@v4")).toBe(true);
  });
});

describe("setup-accord composite — cache key + restore-keys literal (AC-12)", () => {
  const cacheStep = findCacheSteps()[0]!;
  const cacheWith = cacheStep.with as Record<string, string>;

  test("key matches the spec verbatim", () => {
    expect(cacheWith.key).toBe(EXPECTED_CACHE_KEY);
  });

  test("restore-keys is the two-line ladder, verbatim, in order", () => {
    const restoreKeys =
      typeof cacheWith["restore-keys"] === "string"
        ? cacheWith["restore-keys"]
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    expect(restoreKeys).toEqual(EXPECTED_RESTORE_KEYS);
  });
});

describe("setup-accord composite — cache paths (AC-12 + AC-13)", () => {
  const cacheStep = findCacheSteps()[0]!;
  const cacheWith = cacheStep.with as Record<string, string>;

  test("path lines include each of the required roots", () => {
    const pathLines =
      typeof cacheWith.path === "string"
        ? cacheWith.path
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    for (const root of EXPECTED_PATH_ROOTS) {
      expect(pathLines).toContain(root);
    }
  });

  test("AC-13: ~/.config/pi/agent/auth.json is explicitly excluded", () => {
    const pathLines =
      typeof cacheWith.path === "string"
        ? cacheWith.path
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    expect(pathLines).toContain("!~/.config/pi/agent/auth.json");
  });

  test("AC-13: ~/.config/pi/agent/sessions/** is explicitly excluded", () => {
    const pathLines =
      typeof cacheWith.path === "string"
        ? cacheWith.path
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    expect(pathLines).toContain("!~/.config/pi/agent/sessions/**");
  });
});

describe("setup-accord composite — auth.json scrub post-step (AC-13)", () => {
  test("a step runs `rm -f ~/.config/pi/agent/auth.json` with if: always()", () => {
    const scrub = steps.find((s) => {
      const run = (s.run as string) ?? "";
      return run.includes("rm -f ~/.config/pi/agent/auth.json");
    });
    expect(scrub).toBeDefined();
    expect((scrub as Record<string, unknown>).if).toBe("${{ always() }}");
  });

  test("the scrub step appears BEFORE the cache step (so cache save sees auth.json gone)", () => {
    const scrubIdx = steps.findIndex((s) => {
      const run = (s.run as string) ?? "";
      return run.includes("rm -f ~/.config/pi/agent/auth.json");
    });
    const cacheIdx = steps.findIndex(
      (s) => typeof s.uses === "string" && (s.uses as string).startsWith("actions/cache@"),
    );
    expect(scrubIdx).toBeGreaterThanOrEqual(0);
    expect(cacheIdx).toBeGreaterThanOrEqual(0);
    expect(scrubIdx).toBeLessThan(cacheIdx);
  });
});

describe("setup-accord composite — accord config init (TC-11)", () => {
  test("runs accord config init --write", () => {
    const found = steps.some((s) => {
      const run = (s.run as string) ?? "";
      return /accord-cli\/src\/main\.ts config init/.test(run) && /--write/.test(run);
    });
    expect(found).toBe(true);
  });
});
