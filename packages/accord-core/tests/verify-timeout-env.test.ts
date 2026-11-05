import { afterEach, describe, expect, test } from "bun:test";
import { runVerificationCommands } from "@clive.shirley/accord-core/verification/runner.js";

const original = process.env.ACCORD_VERIFY_TIMEOUT_MS;

afterEach(() => {
  if (original === undefined) delete process.env.ACCORD_VERIFY_TIMEOUT_MS;
  else process.env.ACCORD_VERIFY_TIMEOUT_MS = original;
});

describe("ACCORD_VERIFY_TIMEOUT_MS", () => {
  test("a command longer than the override times out", async () => {
    process.env.ACCORD_VERIFY_TIMEOUT_MS = "200";
    const [result] = await runVerificationCommands(["sleep 3"]);
    expect(result?.exitCode).not.toBe(0);
    expect(result?.durationMs).toBeLessThan(2500);
  });

  test("an explicit timeoutMs option wins over the env override", async () => {
    process.env.ACCORD_VERIFY_TIMEOUT_MS = "100";
    const [result] = await runVerificationCommands(["sleep 0.3 && echo ok"], { timeoutMs: 5000 });
    expect(result?.exitCode).toBe(0);
  });

  test("an invalid override falls back to the default", async () => {
    process.env.ACCORD_VERIFY_TIMEOUT_MS = "abc";
    const [result] = await runVerificationCommands(["echo ok"]);
    expect(result?.exitCode).toBe(0);
  });
});
