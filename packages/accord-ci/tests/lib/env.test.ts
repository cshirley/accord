import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  MissingSecretError,
  requireEnv,
  resolveGithubToken,
  SECRET_NAMES,
} from "../../src/lib/env.js";

const REQUIRED_SECRETS = [
  "ANTHROPIC_API_KEY",
  "JIRA_BASE_URL",
  "JIRA_USER_EMAIL",
  "JIRA_API_TOKEN",
  "GITHUB_TOKEN",
  "GH_PAT_PR",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of REQUIRED_SECRETS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of REQUIRED_SECRETS) {
    const prior = saved[name];
    if (prior === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = prior;
    }
  }
});

describe("requireEnv (AC-20..AC-25)", () => {
  for (const name of REQUIRED_SECRETS) {
    test(`throws MissingSecretError with literal message when ${name} is missing`, () => {
      delete process.env[name];
      let thrown: unknown;
      try {
        requireEnv(name);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(MissingSecretError);
      expect((thrown as Error).message).toBe(`MISSING_REQUIRED_SECRET: ${name}`);
    });
  }

  test("returns the env value when set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-value";
    expect(requireEnv("ANTHROPIC_API_KEY")).toBe("sk-ant-test-value");
  });

  test("treats empty-string env as missing (defence in depth)", () => {
    process.env.JIRA_API_TOKEN = "";
    let thrown: unknown;
    try {
      requireEnv("JIRA_API_TOKEN");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingSecretError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_SECRET: JIRA_API_TOKEN");
  });
});

describe("resolveGithubToken same-repo (AC-24, AC-25)", () => {
  test("returns GITHUB_TOKEN when only GITHUB_TOKEN is set", () => {
    process.env.GITHUB_TOKEN = "ghs_runner_token";
    expect(resolveGithubToken({ crossRepo: false })).toBe("ghs_runner_token");
  });

  test("prefers GH_PAT_PR over GITHUB_TOKEN when both are set (AC-24 override)", () => {
    process.env.GITHUB_TOKEN = "ghs_runner_token";
    process.env.GH_PAT_PR = "ghp_personal_token";
    expect(resolveGithubToken({ crossRepo: false })).toBe("ghp_personal_token");
  });

  test("throws MISSING_REQUIRED_SECRET: GITHUB_TOKEN when neither is set", () => {
    let thrown: unknown;
    try {
      resolveGithubToken({ crossRepo: false });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingSecretError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_SECRET: GITHUB_TOKEN");
  });

  test("returns GH_PAT_PR value when only GH_PAT_PR is set (fallback path)", () => {
    process.env.GH_PAT_PR = "ghp_pat_value";
    expect(resolveGithubToken({ crossRepo: false })).toBe("ghp_pat_value");
  });
});

describe("resolveGithubToken cross-repo (AC-25)", () => {
  test("returns GH_PAT_PR value when set", () => {
    process.env.GH_PAT_PR = "ghp_xyz";
    expect(resolveGithubToken({ crossRepo: true })).toBe("ghp_xyz");
  });

  test("throws MISSING_REQUIRED_SECRET: GH_PAT_PR when GH_PAT_PR is unset, even if GITHUB_TOKEN is set", () => {
    process.env.GITHUB_TOKEN = "ghs_runner_token";
    let thrown: unknown;
    try {
      resolveGithubToken({ crossRepo: true });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingSecretError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_SECRET: GH_PAT_PR");
  });

  test("throws MISSING_REQUIRED_SECRET: GH_PAT_PR when both are unset", () => {
    let thrown: unknown;
    try {
      resolveGithubToken({ crossRepo: true });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingSecretError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_SECRET: GH_PAT_PR");
  });
});

describe("SECRET_NAMES constant", () => {
  test("exports all six secret identifiers", () => {
    expect(new Set(SECRET_NAMES)).toEqual(
      new Set([
        "ANTHROPIC_API_KEY",
        "JIRA_BASE_URL",
        "JIRA_USER_EMAIL",
        "JIRA_API_TOKEN",
        "GITHUB_TOKEN",
        "GH_PAT_PR",
      ]),
    );
  });

  test("has exactly six entries", () => {
    expect(SECRET_NAMES.length).toBe(6);
  });
});

describe("MissingSecretError class", () => {
  test("is distinguishable from generic Error for catch-and-translate", () => {
    const err = new MissingSecretError("ANTHROPIC_API_KEY");
    expect(err).toBeInstanceOf(MissingSecretError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MissingSecretError");
    expect(err.secretName).toBe("ANTHROPIC_API_KEY");
    expect(err.message).toBe("MISSING_REQUIRED_SECRET: ANTHROPIC_API_KEY");
  });
});
