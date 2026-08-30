import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatHarnessToolPath } from "../src/adapters/pi/builtin-tool-renders.js";

function mockTheme(): Theme {
  return {
    fg: (_role: string, text: string) => text,
    bold: (text: string) => text,
  } as Theme;
}

describe("formatHarnessToolPath", () => {
  test("tags harness artifact paths", () => {
    const formatted = formatHarnessToolPath(".tasks/WI-1.json", mockTheme());
    expect(formatted).toContain(".tasks/WI-1.json");
    expect(formatted).toContain("harness artifact");
  });

  test("leaves normal paths unchanged aside from accent role", () => {
    const formatted = formatHarnessToolPath("src/index.ts", mockTheme());
    expect(formatted).toBe("src/index.ts");
    expect(formatted).not.toContain("harness artifact");
  });
});
