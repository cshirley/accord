import { describe, expect, test } from "bun:test";

import { detectImportOnlyRed } from "@clive.shirley/accord-core/orchestration/test-red-classification.js";

describe("detectImportOnlyRed", () => {
  test("returns null for empty output", () => {
    expect(detectImportOnlyRed(undefined)).toBeNull();
    expect(detectImportOnlyRed("  \n ")).toBeNull();
  });

  test("returns null for behaviour RED (assertion failures / not-implemented stub)", () => {
    const output = [
      "FAIL src/billing/proration.test.ts",
      "  ✕ AC-2 prorates mid-cycle upgrade",
      "    Error: not implemented: prorateUpgrade",
      "  ✕ AC-4 rejects negative delta",
      "    Expected: 401",
      "    Received: undefined",
      "Tests: 2 failed, 2 total",
    ].join("\n");
    expect(detectImportOnlyRed(output)).toBeNull();
  });

  test("detects bun 'Cannot find module' and extracts the module", () => {
    const signal = detectImportOnlyRed(
      "error: Cannot find module '../proration' from '/repo/src/billing/proration.test.ts'\n",
    );
    expect(signal?.missing).toEqual(["../proration"]);
    expect(signal?.reason).toContain("`../proration`");
    expect(signal?.matched[0]).toContain("Cannot find module");
  });

  test("detects vite resolve errors and missing named exports", () => {
    const signal = detectImportOnlyRed(
      [
        'Error: Failed to resolve import "./rate-limit" from "src/api.test.ts". Does the file exist?',
        "SyntaxError: Export named 'refreshToken' not found in module '/repo/src/auth.ts'.",
      ].join("\n"),
    );
    expect(signal?.missing).toEqual(["./rate-limit", "refreshToken"]);
  });

  test("detects python, go, and rust resolution failures", () => {
    expect(
      detectImportOnlyRed("ModuleNotFoundError: No module named 'billing.proration'")?.missing,
    ).toEqual(["billing.proration"]);
    expect(
      detectImportOnlyRed("ImportError: cannot import name 'prorate' from 'billing'")?.missing,
    ).toEqual(["prorate"]);
    expect(
      detectImportOnlyRed(
        "# example.com/billing [example.com/billing.test]\n./proration_test.go:12:9: undefined: Prorate\nFAIL\texample.com/billing [build failed]",
      )?.missing,
    ).toEqual(["Prorate"]);
    expect(
      detectImportOnlyRed("error[E0432]: unresolved import `crate::proration`")?.missing,
    ).toEqual(["crate::proration"]);
  });

  test("matches code-only signatures without a symbol name", () => {
    const signal = detectImportOnlyRed("Error [ERR_MODULE_NOT_FOUND]: something\n");
    expect(signal).not.toBeNull();
    expect(signal?.missing).toEqual([]);
  });
});
