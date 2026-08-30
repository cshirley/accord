import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  mergeConfig,
  migrateLegacyKeys,
  type ThriftConfig,
} from "../packages/pi-thrift/src/config.js";

function defaults(): ThriftConfig {
  return structuredClone(DEFAULT_CONFIG);
}

describe("defaults", () => {
  test("watermarks leave a gap, so pruning batches instead of nibbling", () => {
    expect(DEFAULT_CONFIG.input.lowWaterPercent).toBeLessThan(
      DEFAULT_CONFIG.input.highWaterPercent,
    );
  });

  test("line backstop matches pi's own ceiling rather than binding first", () => {
    expect(DEFAULT_CONFIG.input.maxResultLines).toBe(2_000);
  });

  test("structure-aware reduction and monotonic elision are on by default", () => {
    expect(DEFAULT_CONFIG.input.reduce).toBe(true);
    expect(DEFAULT_CONFIG.input.monotonic).toBe(true);
  });

  test("the assumed window errs small, so a host with no usage API prunes early rather than late", () => {
    expect(DEFAULT_CONFIG.input.assumedContextWindowTokens).toBeLessThanOrEqual(200_000);
    expect(DEFAULT_CONFIG.input.assumedContextWindowTokens).toBeGreaterThan(0);
  });
});

describe("migrateLegacyKeys", () => {
  test("carries a disabled cacheAware forward to monotonic", () => {
    const config = defaults();
    migrateLegacyKeys({ input: { cacheAware: false } }, config);

    expect(config.input.monotonic).toBe(false);
  });

  test("carries an enabled cacheAware forward too", () => {
    const config = defaults();
    config.input.monotonic = false;
    migrateLegacyKeys({ input: { cacheAware: true } }, config);

    expect(config.input.monotonic).toBe(true);
  });

  test("an explicit monotonic setting wins over the legacy key", () => {
    const config = defaults();
    config.input.monotonic = true;
    migrateLegacyKeys({ input: { cacheAware: false, monotonic: true } }, config);

    expect(config.input.monotonic).toBe(true);
  });

  test("leaves the config alone when no legacy key is present", () => {
    const config = defaults();
    migrateLegacyKeys({ input: {} }, config);

    expect(config.input.monotonic).toBe(DEFAULT_CONFIG.input.monotonic);
  });

  test("tolerates malformed input", () => {
    const config = defaults();
    expect(() => migrateLegacyKeys(null, config)).not.toThrow();
    expect(() => migrateLegacyKeys("nonsense", config)).not.toThrow();
    expect(() => migrateLegacyKeys({ input: 42 }, config)).not.toThrow();
  });
});

describe("mergeConfig", () => {
  function merged(overrides: unknown): ThriftConfig {
    return mergeConfig(DEFAULT_CONFIG, overrides) as ThriftConfig;
  }

  test("a setting the user changed wins over the default", () => {
    expect(merged({ input: { keepRecentTurns: 9 } }).input.keepRecentTurns).toBe(9);
  });

  test("settings the user never mentioned keep their defaults", () => {
    const config = merged({ input: { keepRecentTurns: 9 } });

    expect(config.input.highWaterPercent).toBe(DEFAULT_CONFIG.input.highWaterPercent);
    expect(config.output.level).toBe(DEFAULT_CONFIG.output.level);
  });

  test("a threshold added for a custom tool survives a rewrite", () => {
    const config = merged({ input: { maxResultBytes: { my_tool: 1_234 } } });

    expect(config.input.maxResultBytes.my_tool).toBe(1_234);
  });

  test("does not mutate the shared defaults", () => {
    merged({ input: { keepRecentTurns: 9, maxResultBytes: { my_tool: 1 } } });

    expect(DEFAULT_CONFIG.input.keepRecentTurns).toBe(3);
    expect(DEFAULT_CONFIG.input.maxResultBytes.my_tool).toBeUndefined();
  });

  test("falls back to defaults for a file that is not an object", () => {
    expect(merged(null).input.keepRecentTurns).toBe(DEFAULT_CONFIG.input.keepRecentTurns);
    expect(merged("nonsense").input.keepRecentTurns).toBe(DEFAULT_CONFIG.input.keepRecentTurns);
  });
});
