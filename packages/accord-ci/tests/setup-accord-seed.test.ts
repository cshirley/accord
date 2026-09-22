/**
 * Pins the runtime-config seed step in setup-accord composite.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SETUP_ACCORD = join(REPO_ROOT, ".github/actions/setup-accord/action.yml");
const SUBAGENT_TEMPLATE = join(REPO_ROOT, "packages/accord-cli/ci/subagent.json");

const composite = parseYaml(readFileSync(SETUP_ACCORD, "utf8")) as {
  inputs: Record<string, { default?: unknown; required?: boolean; description?: string }>;
  runs: { using: string; steps: Array<Record<string, unknown>> };
};

const steps = composite.runs.steps;

function findStepByName(needle: string): Record<string, unknown> | undefined {
  return steps.find((s) => typeof s.name === "string" && (s.name as string).includes(needle));
}

function stepRunBody(step: Record<string, unknown>): string {
  const run = step.run;
  return typeof run === "string" ? run : "";
}

const seedStep = findStepByName("Seed runtime configs");

describe("setup-accord seed step — existence + ordering", () => {
  test("a Seed runtime configs step is declared", () => {
    expect(seedStep).toBeDefined();
  });

  test("seed step runs AFTER accord config init", () => {
    const configIdx = steps.findIndex(
      (s) => typeof s.name === "string" && (s.name as string).includes("accord.json"),
    );
    const seedIdx = steps.findIndex(
      (s) => typeof s.name === "string" && (s.name as string).includes("Seed runtime configs"),
    );
    expect(configIdx).toBeGreaterThanOrEqual(0);
    expect(seedIdx).toBeGreaterThanOrEqual(0);
    expect(seedIdx).toBeGreaterThan(configIdx);
  });
});

describe("setup-accord seed step — ~/.pi → ~/.config/pi symlink", () => {
  test("creates ~/.config/pi parent directory", () => {
    expect(stepRunBody(seedStep!)).toMatch(/mkdir\s+-p\s+"\$HOME\/\.config\/pi"/);
  });

  test("creates ~/.pi symlink only if it does not already exist", () => {
    const body = stepRunBody(seedStep!);
    expect(body).toMatch(/if\s+\[\s+!\s+-e\s+"\$HOME\/\.pi"\s+\]/);
    expect(body).toMatch(/ln\s+-s\s+"\$HOME\/\.config\/pi"\s+"\$HOME\/\.pi"/);
  });

  test("ensures the agent dir itself exists before copying templates", () => {
    expect(stepRunBody(seedStep!)).toMatch(/mkdir\s+-p\s+"\$HOME\/\.config\/pi\/agent"/);
  });
});

describe("setup-accord seed step — cp -n (no-clobber) contract", () => {
  test("copies subagent.json from accord-cli/ci with -n flag", () => {
    expect(stepRunBody(seedStep!)).toMatch(
      /cp\s+-n\s+\.accord-ci\/packages\/accord-cli\/ci\/subagent\.json\s+"\$SUBAGENT_DST"/,
    );
  });

  test("the bundled accord-cli/ci/subagent.json template exists on disk", () => {
    expect(existsSync(SUBAGENT_TEMPLATE)).toBe(true);
  });
});

describe("setup-accord seed step — subagent_profile input + jq apply", () => {
  test("composite action declares harness input with claude default", () => {
    const input = composite.inputs.harness;
    expect(input).toBeDefined();
    expect(input.default).toBe("claude");
  });

  test("composite action declares subagent_profile input with anthropic-direct default", () => {
    const input = composite.inputs.subagent_profile;
    expect(input).toBeDefined();
    expect(input.required ?? false).toBe(false);
    expect(input.default).toBe("anthropic-direct");
  });

  test("seed step exports SUBAGENT_PROFILE from the action input", () => {
    const env = seedStep?.env as Record<string, string> | undefined;
    expect(env?.SUBAGENT_PROFILE).toBe("${{ inputs.subagent_profile }}");
  });

  test("seed step fails fast if jq is missing on the runner", () => {
    const body = stepRunBody(seedStep!);
    expect(body).toMatch(/command\s+-v\s+jq/);
    expect(body).toMatch(/jq is required to apply subagent_profile/);
  });

  test("seed step writes the chosen profile into .activeProfile (not .defaultProfile)", () => {
    const body = stepRunBody(seedStep!);
    expect(body).toMatch(/jq\s+--arg\s+p\s+"\$SUBAGENT_PROFILE"\s+'\.activeProfile\s+=\s+\$p'/);
    expect(body).not.toMatch(/\.defaultProfile\s+=\s+\$p/);
  });
});

describe("accord-cli/ci/subagent.json — shape exec harness will accept", () => {
  const config = JSON.parse(readFileSync(SUBAGENT_TEMPLATE, "utf8")) as {
    defaultProfile: string;
    profiles: Record<
      string,
      {
        provider: string;
        thinkingMode: string;
        tiers: Record<string, { model: string; thinking?: string }>;
      }
    >;
    skills?: Record<string, { profile?: string }>;
  };

  test("declares defaultProfile present in profiles map", () => {
    expect(config.defaultProfile).toBeTruthy();
    expect(config.profiles[config.defaultProfile]).toBeDefined();
  });

  test("default profile uses anthropic provider with flag thinking mode", () => {
    const profile = config.profiles[config.defaultProfile]!;
    expect(profile.provider).toBe("anthropic");
    expect(profile.thinkingMode).toBe("flag");
  });
});
