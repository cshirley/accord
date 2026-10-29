import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const srcRoot = resolve(import.meta.dir, "../src");
const packagesRoot = resolve(import.meta.dir, "../..");

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listTs(full);
    return /\.(?:[cm]?[jt]sx?)$/.test(full) ? [full] : [];
  });
}

const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function extractSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  const scan = (text: string) =>
    SPECIFIER_PATTERNS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1] as string));
  // Union raw and comment-stripped matches: a "/*" inside a string must not hide imports.
  return [...new Set([...scan(source), ...scan(code)])];
}

function violatesBoundary(specifier: string, fromFile: string): boolean {
  if (specifier.includes("@earendil-works/")) return true;
  if (/^@clive\.shirley\/(?:accord|accord-cli|accord-mcp|accord-ci)(\/|$)/.test(specifier))
    return true;
  if (/^(?:\.\.?\/)*node_modules\/@earendil-works\//.test(specifier)) return true;
  if (specifier.startsWith("node_modules/@earendil-works/")) return true;
  if (/^@[\w.-]+\/pi-[\w-]+(\/|$)/.test(specifier)) return true;
  if (/^pi-[\w-]+(\/|$)/.test(specifier)) return true;
  if (specifier.startsWith(".")) {
    const target = relative(packagesRoot, resolve(dirname(fromFile), specifier));
    const top = target.split(sep)[0] ?? "";
    return top.startsWith("pi-") || ["accord-cli", "accord-mcp", "accord-ci"].includes(top);
  }
  return /(^|\/)packages\/pi-[\w-]+/.test(specifier);
}

describe("ASDLC-1/AC-28 accord-core import boundary (ASDLC-1/TC-29)", () => {
  it("ASDLC-1/AC-28 scans a non-trivial set of accord-core source files", () => {
    expect(listTs(srcRoot).length).toBeGreaterThan(20);
  });

  it("ASDLC-1/AC-28 no accord-core src import resolves to @earendil-works/* or packages/pi-*", () => {
    const offenders: string[] = [];
    for (const file of listTs(srcRoot)) {
      for (const spec of extractSpecifiers(readFileSync(file, "utf8"))) {
        if (violatesBoundary(spec, file)) offenders.push(`${relative(srcRoot, file)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("scanner self-check (would catch a violation)", () => {
    const from = join(srcRoot, "x/y.ts");
    const bad = [
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-tui/dist",
      "@clive.shirley/pi-git",
      "@clive.shirley/pi-accord",
      "@clive.shirley/pi-subagent/src/x",
      "../../../pi-git/src/index.js",
      "../../../pi-accord/src/x.js",
      "../../../../packages/pi-subagent/src/x.js",
      "../../../../node_modules/@earendil-works/pi-ai/dist/index.js",
      "node_modules/@earendil-works/pi-ai",
      "@clive.shirley/accord",
      "@clive.shirley/accord/packages/x",
      "@clive.shirley/accord-cli",
      "@clive.shirley/accord-mcp/src/x",
      "../../../accord-ci/src/x.js",
    ];
    const good = [
      "node:fs",
      "./pi-spawn.js",
      "../agents/pi-stream.js",
      "@clive.shirley/accord-assets",
      "../../../accord-assets/manifest.json",
      "zod",
    ];
    it.each(bad)("ASDLC-1/AC-28 flags %s", (spec) => {
      expect(violatesBoundary(spec, from)).toBe(true);
    });
    it.each(good)("ASDLC-1/AC-28 allows %s", (spec) => {
      expect(violatesBoundary(spec, from)).toBe(false);
    });
    it("ASDLC-1/AC-28 extracts commented braces and template dynamic imports", () => {
      expect(extractSpecifiers('import {\n a, // why\n} from "@earendil-works/pi-ai";')).toEqual([
        "@earendil-works/pi-ai",
      ]);
      expect(extractSpecifiers("await import(`@earendil-works/pi-ai`)")).toEqual([
        "@earendil-works/pi-ai",
      ]);
    });
    it("ASDLC-1/AC-28 a /* inside a string literal does not hide a later import", () => {
      expect(
        extractSpecifiers(
          'const g = "src/**/*.ts";\nasync function f(){ return import("../../../pi-git/src/x.js"); }\n/** doc */\nexport {};',
        ),
      ).toContain("../../../pi-git/src/x.js");
    });
    it("ASDLC-1/AC-28 extracts static, side-effect, re-export, dynamic and require specifiers", () => {
      const src = [
        `import a from "@earendil-works/x";`,
        `import "side";`,
        `import type { T } from "t";`,
        `export * from "re";`,
        `export { q } from "q";`,
        `const m = await import("dyn");`,
        `const r = require("req");`,
        `import {\n  a,\n  b,\n} from "multi";`,
      ].join("\n");
      expect(extractSpecifiers(src).sort()).toEqual(
        ["@earendil-works/x", "side", "t", "re", "q", "dyn", "req", "multi"].sort(),
      );
    });
  });

  it("ASDLC-1/AC-28 no accord-core src or scripts file contains a Pi package literal", () => {
    const scriptsRoot = resolve(import.meta.dir, "../scripts");
    const files = [...listTs(srcRoot), ...(existsSync(scriptsRoot) ? listTs(scriptsRoot) : [])];
    const offenders = files.filter((f) =>
      /@earendil-works\/|@clive\.shirley\/pi-|node_modules\/@earendil-works/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("ASDLC-1/AC-28 accord-core package.json declares no Pi dependency", () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"));
    const names = Object.keys({
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.devDependencies,
    });
    expect(names.filter((n) => /^@earendil-works\/|\/pi-|^pi-/.test(n))).toEqual([]);
  });
});
