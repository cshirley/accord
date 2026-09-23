/**
 * AC-6 architectural enforcement (TC-10) — Option A (accord-cli):
 *
 *   1. No literal `pi -p --mode json /dev` invocation under packages/accord-ci/src/,
 *      .github/workflows/, or .github/actions/ (phase orchestration is accord-cli only).
 *   2. No file under packages/accord-ci/src/ imports
 *      @earendil-works/pi-coding-agent (SDK ban).
 *
 * This test reads from disk so it auto-tracks new files as invocations are added.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCRIPTS_CI = join(REPO_ROOT, "packages/accord-ci/src");
const WORKFLOWS = join(REPO_ROOT, ".github/workflows");
const ACTIONS = join(REPO_ROOT, ".github/actions");

const PI_DEV_INVOCATION_RE = /\bpi\s+-p\s+--mode\s+json\s+\/dev\b/;

const SDK_FORBIDDEN_RE =
  /(?:import\s[^;]*['"]@earendil-works\/pi-coding-agent['"]|require\s*\(\s*['"]@earendil-works\/pi-coding-agent['"]\s*\)|from\s+['"]@earendil-works\/pi-coding-agent['"])/;

function* walk(dir: string): IterableIterator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function collect(filter: (path: string) => boolean, ...roots: string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const f of walk(root)) {
      if (filter(f)) out.push(f);
    }
  }
  return out;
}

describe("AC-6 / TC-10 — no `pi /dev` phase orchestration in CI package or actions", () => {
  const files = collect(
    (p) => p.endsWith(".ts") || p.endsWith(".yml") || p.endsWith(".yaml"),
    SCRIPTS_CI,
    WORKFLOWS,
    ACTIONS,
  );

  test("inventory: at least one file is scanned (sanity)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(REPO_ROOT.length + 1);
    test(`${rel} does NOT invoke pi /dev for phase orchestration`, () => {
      const src = readFileSync(file, "utf8");
      for (const rawLine of src.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("//")) continue;
        if (line.startsWith("*")) continue;
        if (line.startsWith("#")) continue;
        if (/^description:/i.test(line)) continue;
        if (/`pi\s+-p\b/.test(rawLine)) continue;
        if (/legacy/i.test(rawLine) && PI_DEV_INVOCATION_RE.test(rawLine)) continue;
        expect(PI_DEV_INVOCATION_RE.test(rawLine)).toBe(false);
      }
    });
  }
});

describe("AC-6 — no @earendil-works/pi-coding-agent SDK import under accord-ci/src/", () => {
  const tsFiles = collect((p) => extname(p) === ".ts", SCRIPTS_CI);

  test("inventory: at least one TS file is scanned (sanity)", () => {
    expect(tsFiles.length).toBeGreaterThan(0);
  });

  for (const file of tsFiles) {
    const rel = file.slice(REPO_ROOT.length + 1);
    test(`${rel} does NOT import @earendil-works/pi-coding-agent`, () => {
      const src = readFileSync(file, "utf8");
      expect(SDK_FORBIDDEN_RE.test(src)).toBe(false);
    });
  }
});

describe("AC-6 — setup-accord replaces setup-pi in autopipeline workflow", () => {
  test("autopipeline.yml references setup-accord, not setup-pi", () => {
    const workflow = readFileSync(join(WORKFLOWS, "autopipeline.yml"), "utf8");
    expect(workflow).toContain("setup-accord");
    expect(workflow).not.toMatch(/setup-pi/);
  });
});
