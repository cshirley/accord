import { describe, expect, test } from "bun:test";
import { getConfig } from "../src/morning/config.js";
import { formatEmailResult, type WeekEmailResult } from "../src/morning/pipeline.js";

describe("morning core", () => {
  test("formatEmailResult covers statuses", () => {
    const base = { week: "2026-11-23", count: 3, to: "a@b.c" } as WeekEmailResult;
    expect(formatEmailResult({ ...base, status: "sent" })).toContain("Sent weekly objectives (3)");
    expect(
      formatEmailResult({ ...base, status: "skipped-already-sent", preview: "x" }),
    ).not.toContain("preview");
    expect(formatEmailResult({ ...base, status: "drafted", preview: "body" })).toContain(
      "--- preview ---\nbody",
    );
  });
  test("config loads without pi", () => {
    expect(typeof getConfig).toBe("function");
  });
});
