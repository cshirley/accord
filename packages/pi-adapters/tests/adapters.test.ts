import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("pi-adapters stay thin", () => {
  test("no logic duplicated: imports come from accord-core", () => {
    const src = (f: string) => readFileSync(path.join(import.meta.dir, "..", "src", f), "utf8");
    expect(src("guardrail/index.ts")).toContain("@clive.shirley/accord-core/guardrail");
    expect(src("gdoc/index.ts")).toContain("@clive.shirley/accord-core/gdoc");
    expect(src("notify.ts")).toContain("@clive.shirley/accord-core/notify");
  });
});
