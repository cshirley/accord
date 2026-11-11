import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertCiDrivenEnv } from "../src/ci-driven/startup.js";
import { MissingSecretError } from "../src/lib/env.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOKEN_NAME = "ACCORD_CI_PUSH_TOKEN";
const SECRET_VALUE = "ghp_SENTINEL_token_value_9f3a1c";

let saved: string | undefined;
let spies: Array<{ mockRestore(): void }> = [];
let spawnCalls: unknown[][] = [];
let captured: string[] = [];

beforeEach(() => {
  saved = process.env[TOKEN_NAME];
  delete process.env[TOKEN_NAME];
  spawnCalls = [];
  captured = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      spawnCalls.push([name, ...args]);
      throw new Error(`unexpected process spawn: ${name}`);
    };
  spies = [
    spyOn(Bun, "spawn").mockImplementation(record("Bun.spawn") as never),
    spyOn(Bun, "spawnSync").mockImplementation(record("Bun.spawnSync") as never),
    spyOn(childProcess, "spawn").mockImplementation(record("cp.spawn") as never),
    spyOn(childProcess, "spawnSync").mockImplementation(record("cp.spawnSync") as never),
    spyOn(childProcess, "exec").mockImplementation(record("cp.exec") as never),
    spyOn(childProcess, "execSync").mockImplementation(record("cp.execSync") as never),
    spyOn(childProcess, "execFile").mockImplementation(record("cp.execFile") as never),
    spyOn(childProcess, "execFileSync").mockImplementation(record("cp.execFileSync") as never),
  ];
  const sink = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  spies.push(
    spyOn(console, "log").mockImplementation(sink as never),
    spyOn(console, "error").mockImplementation(sink as never),
    spyOn(console, "warn").mockImplementation(sink as never),
    spyOn(console, "info").mockImplementation(sink as never),
    spyOn(console, "debug").mockImplementation(sink as never),
    spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as never),
    spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    }) as never),
  );
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  if (saved === undefined) delete process.env[TOKEN_NAME];
  else process.env[TOKEN_NAME] = saved;
});

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("ASDLC-1/AC-25 push token required at startup (ASDLC-1/TC-26)", () => {
  it.each([
    ["absent", undefined],
    ["empty string", ""],
  ])(
    "ASDLC-1/AC-25 %s token fails with MISSING_REQUIRED_SECRET before any git/gh call",
    (_label, value) => {
      if (value !== undefined) process.env[TOKEN_NAME] = value;
      const error = thrownBy(() => assertCiDrivenEnv());
      expect(error).toBeInstanceOf(MissingSecretError);
      expect((error as Error).message).toBe("MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN");
      expect(spawnCalls).toEqual([]);
    },
  );

  it("ASDLC-1/AC-25 GITHUB_TOKEN or GH_PAT_PR alone does not satisfy the requirement", () => {
    const prior = { gt: process.env.GITHUB_TOKEN, pat: process.env.GH_PAT_PR };
    process.env.GITHUB_TOKEN = "gh-actions-token";
    process.env.GH_PAT_PR = "some-pat";
    try {
      const error = thrownBy(() => assertCiDrivenEnv());
      expect((error as Error).message).toBe("MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN");
      expect(spawnCalls).toEqual([]);
    } finally {
      if (prior.gt === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prior.gt;
      if (prior.pat === undefined) delete process.env.GH_PAT_PR;
      else process.env.GH_PAT_PR = prior.pat;
    }
  });

  it("ASDLC-1/AC-25 near-miss var name (lowercase) is not accepted", () => {
    process.env.accord_ci_push_token_x = SECRET_VALUE;
    try {
      const error = thrownBy(() => assertCiDrivenEnv());
      expect((error as Error).message).toBe("MISSING_REQUIRED_SECRET: ACCORD_CI_PUSH_TOKEN");
    } finally {
      delete process.env.accord_ci_push_token_x;
    }
  });

  it("ASDLC-1/AC-25 with the token set startup proceeds without throwing or spawning", () => {
    process.env[TOKEN_NAME] = SECRET_VALUE;
    expect(thrownBy(() => assertCiDrivenEnv())).toBeUndefined();
    expect(spawnCalls).toEqual([]);
  });

  it("ASDLC-1/AC-25 token value never appears in stdout, stderr, logs or the error", () => {
    process.env[TOKEN_NAME] = SECRET_VALUE;
    assertCiDrivenEnv();
    expect(captured.join("\n")).not.toContain(SECRET_VALUE);
    delete process.env[TOKEN_NAME];
    const error = thrownBy(() => assertCiDrivenEnv()) as Error;
    expect(error.message).not.toContain(SECRET_VALUE);
    expect(captured.join("\n")).not.toContain(SECRET_VALUE);
  });
});

describe("ASDLC-1/AC-30 stack.ci.cost_cap_usd schema alignment", () => {
  const schema = JSON.parse(
    readFileSync(join(ROOT, "packages/accord-core/schemas/accord-schema.json"), "utf8"),
  );
  const ciSchema = () => schema.properties.stack.properties.ci;
  const capSchema = () => ciSchema().properties.cost_cap_usd;

  it("ASDLC-1/AC-30 stack.ci.cost_cap_usd is a number with positive bound and no default", () => {
    expect(ciSchema().type).toBe("object");
    expect(ciSchema().additionalProperties).toBe(false);
    expect(capSchema().type).toBe("number");
    const positive =
      capSchema().exclusiveMinimum === 0 ||
      (typeof capSchema().minimum === "number" && capSchema().minimum > 0);
    expect(positive).toBe(true);
    expect(capSchema()).not.toHaveProperty("default");
    expect(ciSchema().required ?? []).not.toContain("cost_cap_usd");
  });

  it("ASDLC-1/AC-30 config types declare stack.ci.cost_cap_usd", () => {
    const types = readFileSync(join(ROOT, "packages/accord-core/src/config/types.ts"), "utf8");
    expect(types).toMatch(/cost_cap_usd\?:\s*number/);
  });
});

describe("ASDLC-1/AC-31 accord-ci change documented in pre-merge smoke doc", () => {
  const doc = () => readFileSync(join(ROOT, "docs/ci/pre-merge-smoke.md"), "utf8");

  it("ASDLC-1/AC-31 documents the server-only secret, owner and 90-day rotation", () => {
    const text = doc();
    expect(text).toContain(TOKEN_NAME);
    const lines = text.split("\n").filter((line) => line.includes(TOKEN_NAME));
    const section = text.slice(text.indexOf(TOKEN_NAME));
    expect(lines.length).toBeGreaterThan(0);
    expect(section).toContain("cshirley");
    expect(section).toMatch(/90[- ]day/);
  });
});
