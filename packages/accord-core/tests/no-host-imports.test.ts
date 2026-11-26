import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Glob } from "bun";

describe("host-neutral modules", () => {
  test("guardrail/gdoc/notify import no pi packages", () => {
    const root = path.join(import.meta.dir, "..", "src");
    const bad: string[] = [];
    for (const dir of ["guardrail", "gdoc", "notify"]) {
      for (const f of new Glob(`${dir}/**/*.ts`).scanSync(root)) {
        if (/@earendil-works\//.test(readFileSync(path.join(root, f), "utf8"))) bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});
