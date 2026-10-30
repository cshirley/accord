import { afterEach, describe, expect, test } from "bun:test";
import { cleanEnv } from "./helpers.js";

const touched = [
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
  "KEEP_ME",
];

describe("cleanEnv", () => {
  afterEach(() => {
    for (const key of touched) delete process.env[key];
  });

  test("drops variables git exports to hooks and -c config, keeps the rest, disables global config", () => {
    for (const key of touched) process.env[key] = "x";
    const env = cleanEnv({ EXTRA: "1" });
    for (const key of touched.filter((name) => name !== "KEEP_ME"))
      expect(env[key]).toBeUndefined();
    expect(env.KEEP_ME).toBe("x");
    expect(env.EXTRA).toBe("1");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(env.GIT_CONFIG_SYSTEM).toBe("/dev/null");
    expect(env.PATH).toBe(process.env.PATH as string);
  });
});
