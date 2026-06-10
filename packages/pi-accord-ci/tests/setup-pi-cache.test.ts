/**
 * AC-12 + AC-13: literal cache key/path/exclusion contract for setup-pi.
 *
 * The test reads .github/actions/setup-pi/action.yml as YAML and pins every
 * literal value in the cache step + the exclusion topology + the post-step
 * auth.json scrub. Any drift from the spec contract trips a verbatim
 * comparison failure.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SETUP_PI = join(REPO_ROOT, ".github/actions/setup-pi/action.yml");

const composite = parseYaml(readFileSync(SETUP_PI, "utf8")) as {
  runs: { using: string; steps: Array<Record<string, unknown>> };
};

const steps = composite.runs.steps;

const EXPECTED_CACHE_KEY =
  "accord-${{ runner.os }}-${{ inputs.pi_version }}-${{ inputs.accord_ref }}-${{ hashFiles('.accord-ci/bun.lock', '.accord-ci/assets/manifest.json') }}";

const EXPECTED_RESTORE_KEYS = [
  "accord-${{ runner.os }}-${{ inputs.pi_version }}-${{ inputs.accord_ref }}-",
  "accord-${{ runner.os }}-${{ inputs.pi_version }}-",
];

const EXPECTED_PATH_ROOTS = [
  "~/.npm",
  "~/.bun/install/cache",
  "~/.config/pi/agent",
  ".accord-ci/node_modules",
] as const;

function findCacheSteps(): Array<Record<string, unknown>> {
  return steps.filter(
    (s) => typeof s.uses === "string" && (s.uses as string).startsWith("actions/cache@"),
  );
}

describe("setup-pi composite — single actions/cache@v4 step (AC-12)", () => {
  test("exactly one actions/cache step exists", () => {
    expect(findCacheSteps().length).toBe(1);
  });

  test("the cache step uses actions/cache@v4 (pinned major)", () => {
    expect((findCacheSteps()[0]?.uses as string).startsWith("actions/cache@v4")).toBe(true);
  });
});

describe("setup-pi composite — cache key + restore-keys literal (AC-12)", () => {
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

describe("setup-pi composite — cache paths (AC-12 + AC-13)", () => {
  const cacheStep = findCacheSteps()[0]!;
  const cacheWith = cacheStep.with as Record<string, string>;

  test("path lines include each of the four required roots", () => {
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

describe("setup-pi composite — auth.json scrub post-step (AC-13)", () => {
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

describe("setup-pi composite — pi offline / skip-version-check env (TC-11)", () => {
  test("PI_OFFLINE=1 is exported by at least one step", () => {
    const found = steps.some((s) => {
      const env = s.env as Record<string, unknown> | undefined;
      if ((env && env.PI_OFFLINE === 1) || env?.PI_OFFLINE === "1") return true;
      const run = (s.run as string) ?? "";
      return /\bPI_OFFLINE=1\b/.test(run);
    });
    expect(found).toBe(true);
  });

  test("PI_SKIP_VERSION_CHECK=1 is exported by at least one step", () => {
    const found = steps.some((s) => {
      const env = s.env as Record<string, unknown> | undefined;
      if (env && (env.PI_SKIP_VERSION_CHECK === 1 || env.PI_SKIP_VERSION_CHECK === "1"))
        return true;
      const run = (s.run as string) ?? "";
      return /\bPI_SKIP_VERSION_CHECK=1\b/.test(run);
    });
    expect(found).toBe(true);
  });
});
