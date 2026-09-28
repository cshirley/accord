import { describe, expect, test } from "bun:test";

import { detectTestRunnerCrash } from "@clive.shirley/accord-core/orchestration/test-crash-detection.js";

describe("detectTestRunnerCrash", () => {
  test("returns null for undefined / empty / whitespace-only output", () => {
    expect(detectTestRunnerCrash(undefined)).toBeNull();
    expect(detectTestRunnerCrash("")).toBeNull();
    expect(detectTestRunnerCrash("   \n  ")).toBeNull();
  });

  test("returns null for a normal, fully-failing (but not crashed) Jest run", () => {
    const output = [
      "FAIL src/servers.unit.test.ts",
      "  ✕ TC-1: gates on SERVER_MODE=platform",
      "  ✕ TC-2: gates on SERVER_MODE=authorizer",
      "",
      "Test Suites: 1 failed, 1 total",
      "Tests:       41 failed, 7 passed, 48 total",
    ].join("\n");
    expect(detectTestRunnerCrash(output)).toBeNull();
  });

  test("returns null for a normal, fully-passing run", () => {
    const output =
      "PASS src/foo.test.ts\n\nTest Suites: 1 passed, 1 total\nTests: 12 passed, 12 total\n";
    expect(detectTestRunnerCrash(output)).toBeNull();
  });

  test("detects an uncaught-exception crash (Node crash banner + triggerUncaughtException)", () => {
    const output = [
      "node:internal/process/promises:394",
      "    triggerUncaughtException(err, true /* fromPromise */);",
      "    ^",
      "",
      "Error: listen EADDRINUSE: address already in use :::3052",
      "Node.js v24.21.0",
    ].join("\n");
    const result = detectTestRunnerCrash(output);
    expect(result).not.toBeNull();
    expect(result?.reason).toContain("uncaught exception");
  });

  test("detects EADDRINUSE when it is the only signature present", () => {
    const output =
      "Error: listen EADDRINUSE: address already in use :::3052\nsome other trailing text\n";
    const result = detectTestRunnerCrash(output);
    expect(result).not.toBeNull();
    expect(result?.reason).toContain("network listener");
  });

  test("detects an unhandled promise rejection", () => {
    const output = "UnhandledPromiseRejectionWarning: Error: boom\n  at foo (bar.js:1:1)\n";
    const result = detectTestRunnerCrash(output);
    expect(result).not.toBeNull();
    expect(result?.reason).toContain("unhandled promise rejection");
  });

  test("detects a V8 out-of-memory FATAL ERROR", () => {
    const output =
      "<--- Last few GCs --->\n\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n";
    const result = detectTestRunnerCrash(output);
    expect(result).not.toBeNull();
    expect(result?.reason).toContain("out of memory");
  });

  test("detects a segfault", () => {
    expect(detectTestRunnerCrash("zsh: segmentation fault  node ./run-tests.js")?.reason).toContain(
      "segmentation fault",
    );
  });

  test("detects a terminated Jest worker process", () => {
    const output = "A jest worker process (pid=12345) was terminated by another process";
    expect(detectTestRunnerCrash(output)?.reason).toContain("Jest worker process was terminated");
  });

  test("detects an unrecovered Go panic", () => {
    const output =
      "panic: runtime error: invalid memory address\n\ngoroutine 1 [running]:\nmain.main()\n";
    expect(detectTestRunnerCrash(output)?.reason).toContain("Go panic");
  });

  test("falls back to the generic Node.js crash banner when no more specific signature matches", () => {
    // A bespoke error the specific signatures above don't name, but the crash banner still
    // gives it away: this line is only ever printed by Node's own uncaught-exception exit path.
    const output =
      "Some bespoke internal error trace with no other known signature\nNode.js v20.11.0\n";
    const result = detectTestRunnerCrash(output);
    expect(result).not.toBeNull();
    expect(result?.reason).toContain("uncaught-exception crash path");
  });

  test("does not false-positive on 'Node.js v20.11.0' appearing mid-line (e.g. an env/version banner)", () => {
    const output = "Running on Node.js v20.11.0 engine\nTests: 5 passed, 5 total\n";
    expect(detectTestRunnerCrash(output)).toBeNull();
  });

  test("truncates the matched excerpt", () => {
    const longLine = "A".repeat(500);
    const output = `UnhandledPromiseRejectionWarning: ${longLine}`;
    const result = detectTestRunnerCrash(output);
    expect(result?.matched.length).toBeLessThanOrEqual(200);
  });
});
