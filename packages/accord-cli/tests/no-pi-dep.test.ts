import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("accord-cli package graph", () => {
  test("does not depend on pi-accord or pi-subagent", () => {
    const pkgPath = path.join(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@clive.shirley/pi-accord"]).toBeUndefined();
    expect(pkg.optionalDependencies?.["@clive.shirley/pi-accord"]).toBeUndefined();
    expect(pkg.dependencies?.["@clive.shirley/pi-subagent"]).toBeUndefined();
    expect(pkg.dependencies?.["@clive.shirley/accord-core"]).toBeDefined();
  });
});
