import { describe, expect, test } from "bun:test";
import {
  collapseBlankRuns,
  collapseRepeatedLines,
  elideBlobs,
  headTail,
  looksLikeCode,
  reduceCode,
  reduceList,
  reduceLog,
  reduceToolOutput,
  stripAnsi,
} from "../packages/pi-thrift/src/reducers.js";

describe("stripAnsi", () => {
  test("removes colour escapes but keeps the text", () => {
    expect(stripAnsi("\u001b[31merror\u001b[0m: failed")).toBe("error: failed");
  });

  test("leaves plain text untouched", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });
});

describe("collapseRepeatedLines", () => {
  test("folds runs of three or more identical lines", () => {
    const input = ["start", "retry", "retry", "retry", "retry", "done"].join("\n");
    const out = collapseRepeatedLines(input);

    expect(out).toContain("[... previous line repeated 3 more times]");
    expect(out.split("\n").filter((l) => l === "retry")).toHaveLength(1);
    expect(out).toContain("start");
    expect(out).toContain("done");
  });

  test("leaves short runs alone so the marker never costs more than it saves", () => {
    const input = ["a", "b", "b", "c"].join("\n");
    expect(collapseRepeatedLines(input)).toBe(input);
  });
});

describe("collapseBlankRuns", () => {
  test("caps consecutive blank lines", () => {
    expect(collapseBlankRuns("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("elideBlobs", () => {
  test("replaces long encoded runs with a size marker", () => {
    const blob = "A".repeat(400);
    const out = elideBlobs(`data: ${blob} end`);

    expect(out).not.toContain(blob);
    expect(out).toContain("400 chars of encoded data elided");
    expect(out).toContain("end");
  });

  test("keeps ordinary words intact", () => {
    expect(elideBlobs("const shortIdentifier = 1;")).toBe("const shortIdentifier = 1;");
  });
});

describe("headTail", () => {
  test("keeps both ends and reports the gap", () => {
    const input = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    const out = headTail(input, 5, 5);

    expect(out).toContain("line0");
    expect(out).toContain("line99");
    expect(out).not.toContain("line50");
    expect(out).toContain("[... 90 lines elided from the middle]");
  });

  test("is a no-op when the content already fits", () => {
    const input = "a\nb\nc";
    expect(headTail(input, 5, 5)).toBe(input);
  });
});

describe("reduceCode", () => {
  const source = [
    'import { readFile } from "node:fs/promises";',
    "",
    "/** Adds two numbers. */",
    "export function add(a: number, b: number): number {",
    "  const scaled = a * 1;",
    "  const other = b * 1;",
    "  const total = scaled + other;",
    "  const rounded = Math.round(total);",
    "  return rounded;",
    "}",
    "",
    "export class Widget {",
    "  private count = 0;",
    "",
    "  increment(): void {",
    "    this.count += 1;",
    "    this.count += 0;",
    "    this.count += 0;",
    "    this.count += 0;",
    "  }",
    "}",
  ].join("\n");

  test("keeps every declaration and the doc comment", () => {
    const { text } = reduceCode(source);

    expect(text).toContain('import { readFile } from "node:fs/promises";');
    expect(text).toContain("/** Adds two numbers. */");
    expect(text).toContain("export function add(a: number, b: number): number {");
    expect(text).toContain("export class Widget {");
    expect(text).toContain("increment(): void {");
  });

  test("elides statement bodies", () => {
    const { text, reduced } = reduceCode(source);

    expect(reduced).toBe(true);
    expect(text).not.toContain("const rounded = Math.round(total);");
    expect(text).toMatch(/\[\.\.\. \d+ lines elided\]/);
  });

  test("preserves the end of the file, unlike head truncation", () => {
    const long = [
      ...Array.from({ length: 500 }, (_, i) => `  const filler${i} = ${i};`),
      "export const LAST_SYMBOL = true;",
    ].join("\n");

    const { text } = reduceCode(long);
    expect(text).toContain("export const LAST_SYMBOL = true;");
  });

  test("reports a genuine size reduction", () => {
    const long = [
      "export function big(): void {",
      ...Array.from({ length: 300 }, (_, i) => `  doSomething(${i});`),
      "}",
    ].join("\n");

    const result = reduceCode(long);
    expect(result.outputBytes).toBeLessThan(result.originalBytes / 5);
  });

  test("handles empty input without throwing", () => {
    expect(reduceCode("").text).toBe("");
  });
});

describe("reduceList", () => {
  test("truncates by entry and reports the remainder", () => {
    const input = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`).join("\n");
    const { text } = reduceList(input, 10);

    expect(text).toContain("src/file0.ts");
    expect(text).toContain("src/file9.ts");
    expect(text).not.toContain("src/file10.ts");
    expect(text).toContain("40 more entries (50 total)");
  });

  test("is a no-op below the entry cap", () => {
    const input = "a\nb";
    expect(reduceList(input, 10).reduced).toBe(false);
  });
});

describe("reduceLog", () => {
  test("keeps the tail, where failures live", () => {
    const input = [
      ...Array.from({ length: 400 }, (_, i) => `step ${i}`),
      "FAIL: assertion failed",
      "exit code 1",
    ].join("\n");

    const { text } = reduceLog(input);
    expect(text).toContain("FAIL: assertion failed");
    expect(text).toContain("exit code 1");
    expect(text).not.toContain("step 200");
  });

  test("strips escapes and folds repeats before windowing", () => {
    const input = [
      "\u001b[32mstarting\u001b[0m",
      ...Array.from({ length: 20 }, () => "waiting..."),
      "done",
    ].join("\n");

    const { text } = reduceLog(input);
    expect(text).toContain("starting");
    expect(text).not.toContain("\u001b[32m");
    expect(text).toContain("previous line repeated 19 more times");
  });
});

describe("looksLikeCode", () => {
  test.each([
    ["src/index.ts", true],
    ["main.py", true],
    ["lib.rs", true],
    ["notes.md", false],
    ["output.log", false],
    [undefined, false],
  ])("%s -> %s", (path, expected) => {
    expect(looksLikeCode(path as string | undefined)).toBe(expected);
  });
});

describe("reduceToolOutput", () => {
  test("skeletonises code reads", () => {
    const source = [
      "export function f() {",
      "  const a = 1;",
      "  const b = 2;",
      "  const c = 3;",
      "  return a + b + c;",
      "}",
    ].join("\n");

    const { text } = reduceToolOutput("read", source, { path: "src/f.ts" });
    expect(text).toContain("export function f() {");
    expect(text).toMatch(/\[\.\.\. \d+ lines elided\]/);
  });

  test("treats non-code reads as prose, keeping both ends and cutting the middle", () => {
    const prose = Array.from({ length: 300 }, (_, i) => `paragraph ${i}`).join("\n");
    const { reduced, text } = reduceToolOutput("read", prose, { path: "notes.md" });

    expect(reduced).toBe(true);
    expect(text).toContain("paragraph 0");
    expect(text).toContain("paragraph 299");
    expect(text).toContain("elided from the middle");
    expect(text).not.toContain("paragraph 125\n");
  });

  test("trims listings by entry", () => {
    const listing = Array.from({ length: 300 }, (_, i) => `match ${i}`).join("\n");
    const { text } = reduceToolOutput("grep", listing, { maxEntries: 5 });

    expect(text).toContain("295 more entries");
  });
});
