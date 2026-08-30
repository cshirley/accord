/**
 * Pins the runtime-config seed step added to setup-pi composite.
 *
 * What this step is responsible for:
 *   1. Creating `~/.pi -> ~/.config/pi` symlink so pi-thrift's hard-coded
 *      `homedir()/.pi/agent` path resolves to the same directory that
 *      pi-coding-agent uses on Linux (`~/.config/pi/agent`).
 *   2. Copying CI-tuned `subagent.json` and `thrift.json` templates
 *      from `assets/ci/` into the agent dir using `cp -n` (no-clobber) so
 *      a cache-restored copy always wins over the template.
 *   3. Applying the `subagent_profile` action input to the resulting
 *      `subagent.json` via `jq`, failing fast if the named profile
 *      is not present (better than letting pi-subagent silently fall back
 *      to in-code defaults at the first phase invocation).
 *
 * The corresponding shipped templates live in
 *   assets/ci/subagent.json
 *   assets/ci/thrift.json
 * and are kept in shape so pi-subagent and pi-thrift accept them as-is.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SETUP_PI = join(REPO_ROOT, ".github/actions/setup-pi/action.yml");
const SUBAGENT_TEMPLATE = join(REPO_ROOT, "packages/pi-accord/assets/ci/subagent.json");
const THRIFT_TEMPLATE = join(REPO_ROOT, "packages/pi-accord/assets/ci/thrift.json");

const composite = parseYaml(readFileSync(SETUP_PI, "utf8")) as {
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

describe("setup-pi seed step — existence + ordering", () => {
  test("a Seed runtime configs step is declared", () => {
    expect(seedStep).toBeDefined();
  });

  test("seed step runs AFTER pi install pi-accord (which creates ~/.config/pi/agent)", () => {
    const installIdx = steps.findIndex(
      (s) => typeof s.name === "string" && (s.name as string).includes("pi install pi-accord"),
    );
    const seedIdx = steps.findIndex(
      (s) => typeof s.name === "string" && (s.name as string).includes("Seed runtime configs"),
    );
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(seedIdx).toBeGreaterThanOrEqual(0);
    expect(seedIdx).toBeGreaterThan(installIdx);
  });
});

describe("setup-pi seed step — ~/.pi → ~/.config/pi symlink", () => {
  test("creates ~/.config/pi parent directory", () => {
    expect(stepRunBody(seedStep!)).toMatch(/mkdir\s+-p\s+"\$HOME\/\.config\/pi"/);
  });

  test("creates ~/.pi symlink only if it does not already exist", () => {
    const body = stepRunBody(seedStep!);
    // Existence guard + ln -s in the same step body.
    expect(body).toMatch(/if\s+\[\s+!\s+-e\s+"\$HOME\/\.pi"\s+\]/);
    expect(body).toMatch(/ln\s+-s\s+"\$HOME\/\.config\/pi"\s+"\$HOME\/\.pi"/);
  });

  test("ensures the agent dir itself exists before copying templates", () => {
    expect(stepRunBody(seedStep!)).toMatch(/mkdir\s+-p\s+"\$HOME\/\.config\/pi\/agent"/);
  });
});

describe("setup-pi seed step — cp -n (no-clobber) contract", () => {
  test("copies subagent.json from assets/ci with -n flag", () => {
    expect(stepRunBody(seedStep!)).toMatch(
      /cp\s+-n\s+\.accord-ci\/packages\/pi-accord\/assets\/ci\/subagent\.json\s+"\$SUBAGENT_DST"/,
    );
  });

  test("copies thrift.json from assets/ci with -n flag", () => {
    expect(stepRunBody(seedStep!)).toMatch(
      /cp\s+-n\s+\.accord-ci\/packages\/pi-accord\/assets\/ci\/thrift\.json\s+"\$THRIFT_DST"/,
    );
  });

  test("the bundled assets/ci/ templates exist on disk", () => {
    expect(existsSync(SUBAGENT_TEMPLATE)).toBe(true);
    expect(existsSync(THRIFT_TEMPLATE)).toBe(true);
  });
});

describe("setup-pi seed step — subagent_profile input + jq apply", () => {
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

  test("seed step fails fast if the named profile is absent from subagent.json", () => {
    const body = stepRunBody(seedStep!);
    // jq -e with the path-existence check, plus a literal error prefix.
    expect(body).toMatch(/jq\s+-e\s+--arg\s+p\s+"\$SUBAGENT_PROFILE"\s+'\.profiles\[\$p\]'/);
    expect(body).toMatch(/is not defined in/);
  });

  test("seed step writes the chosen profile into .activeProfile (not .defaultProfile)", () => {
    const body = stepRunBody(seedStep!);
    expect(body).toMatch(/jq\s+--arg\s+p\s+"\$SUBAGENT_PROFILE"\s+'\.activeProfile\s+=\s+\$p'/);
    // Must not mutate defaultProfile — that would change cache semantics across runs.
    expect(body).not.toMatch(/\.defaultProfile\s+=\s+\$p/);
  });
});

describe("assets/ci/subagent.json — shape pi-subagent will accept", () => {
  const config = JSON.parse(readFileSync(SUBAGENT_TEMPLATE, "utf8")) as {
    defaultProfile: string;
    activeProfile?: string;
    skills?: Record<string, { profile?: string }>;
    profiles: Record<
      string,
      {
        provider: string;
        thinkingMode: string;
        tiers: Record<string, { model: string; thinking?: string }>;
      }
    >;
  };

  test("declares defaultProfile present in profiles map", () => {
    expect(config.defaultProfile).toBeTruthy();
    expect(config.profiles[config.defaultProfile]).toBeDefined();
  });

  test("default profile uses anthropic provider with flag thinking mode (only key wired in CI)", () => {
    const profile = config.profiles[config.defaultProfile]!;
    expect(profile.provider).toBe("anthropic");
    expect(profile.thinkingMode).toBe("flag");
  });

  test("default profile defines all three tiers (reasoning, workhorse, lightweight)", () => {
    const profile = config.profiles[config.defaultProfile]!;
    expect(profile.tiers.reasoning).toBeDefined();
    expect(profile.tiers.workhorse).toBeDefined();
    expect(profile.tiers.lightweight).toBeDefined();
  });

  test("accord skill namespace is pinned to a known profile", () => {
    const accord = config.skills?.accord;
    expect(accord).toBeDefined();
    expect(accord?.profile).toBeTruthy();
    const profileName = accord?.profile;
    if (!profileName) throw new Error("expected accord.profile");
    expect(config.profiles[profileName]).toBeDefined();
  });
});

describe("assets/ci/thrift.json — shape pi-thrift will accept", () => {
  const config = JSON.parse(readFileSync(THRIFT_TEMPLATE, "utf8")) as {
    enabled: boolean;
    input: { enabled: boolean; providerTTLs: Record<string, number>; defaultTTL: number };
    output: { level: string };
    showStatus: boolean;
  };

  test("thrift is enabled in CI", () => {
    expect(config.enabled).toBe(true);
  });

  test("output.level is one of the OUTPUT_LEVELS pi-thrift accepts", () => {
    expect(["off", "lite", "full", "ultra"]).toContain(config.output.level);
  });

  test("status footer is disabled in CI (no TTY to render to)", () => {
    expect(config.showStatus).toBe(false);
  });

  test("anthropic provider TTL is set (only provider keyed in CI)", () => {
    expect(typeof config.input.providerTTLs.anthropic).toBe("number");
    expect(config.input.providerTTLs.anthropic).toBeGreaterThan(0);
  });
});
