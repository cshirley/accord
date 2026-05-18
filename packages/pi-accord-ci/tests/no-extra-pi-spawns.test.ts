/**
 * AC-6 architectural enforcement (TC-10):
 *
 *   1. Every literal `pi ` invocation under packages/pi-accord-ci/src/, .github/workflows/,
 *      and .github/actions/ must match the allow-list regex
 *      ^pi -p --mode json /skill:accord (spec|plan|code|verify|resume|finish|gather|align|init) \S+( --[a-z-]+(=\S+)?)*$
 *   2. No file under packages/pi-accord-ci/src/ imports any symbol from
 *      @earendil-works/pi-coding-agent (SDK ban).
 *
 * This test reads from disk so it auto-tracks new files as tasks 7 / 11 add
 * invocations — no fixture wiring required.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SCRIPTS_CI = join(REPO_ROOT, "packages/pi-accord-ci/src");
const WORKFLOWS = join(REPO_ROOT, ".github/workflows");
const ACTIONS = join(REPO_ROOT, ".github/actions");

const PI_INVOCATION_ALLOWLIST_RE =
  /^pi -p --mode json \/skill:accord (spec|plan|code|verify|resume|finish|gather|align|init) \S+( --[a-z-]+(=\S+)?)*$/;

const PI_INVOCATION_DETECTOR_RE = /\bpi\s+-p\s+--mode\s+json\s+\/skill:accord\b[^\n]*/g;

/**
 * Match only `import` and `require` statements that pull from the banned SDK.
 * Plain text mentions in comments / strings are allowed (e.g. an input's
 * `description` field that points users at the SDK).
 */
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

describe("AC-6 / TC-10 — `pi` invocations match the allowlist", () => {
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
    test(`every \`pi /skill:accord\` invocation in ${rel} matches the allowlist regex`, () => {
      const src = readFileSync(file, "utf8");
      // Scan line-by-line; ignore lines that are clearly documentation
      // (TypeScript comments, YAML `description:` keys, markdown / inline
      // backticks). Only assert on lines that look like real shell
      // invocations — backtick-free, not commented, and either inside a
      // shell script or a YAML `run:` block.
      for (const rawLine of src.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("//")) continue;
        if (line.startsWith("*")) continue;
        if (line.startsWith("#")) continue;
        if (/^description:/i.test(line)) continue;
        // Skip any line whose first `pi ...` token is wrapped in backticks
        // (markdown inline code in YAML comments / TS jsdoc).
        if (/`pi\s+-p\b/.test(rawLine)) continue;
        const matches = line.match(PI_INVOCATION_DETECTOR_RE) ?? [];
        for (const m of matches) {
          const cleaned = m
            .replace(/['"]/g, "")
            .replace(/\s*[><|;&].*$/, "")
            .trim();
          expect(cleaned).toMatch(PI_INVOCATION_ALLOWLIST_RE);
        }
      }
    });
  }
});

describe("AC-6 — no @earendil-works/pi-coding-agent SDK import under pi-accord-ci/src/", () => {
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

describe("AC-6 — allowlist regex itself accepts canonical invocations", () => {
  test("accepts a bare spec invocation", () => {
    expect("pi -p --mode json /skill:accord spec PROJ-123").toMatch(PI_INVOCATION_ALLOWLIST_RE);
  });

  test("accepts an invocation with allowlist flags", () => {
    expect(
      "pi -p --mode json /skill:accord code PROJ-123 --task-id=2 --owner-nonce=abc123",
    ).toMatch(PI_INVOCATION_ALLOWLIST_RE);
  });

  test("rejects a non-accord skill", () => {
    expect("pi -p --mode json /skill:other-skill spec PROJ-123").not.toMatch(
      PI_INVOCATION_ALLOWLIST_RE,
    );
  });

  test("rejects an unsupported phase", () => {
    expect("pi -p --mode json /skill:accord hax0r PROJ-123").not.toMatch(
      PI_INVOCATION_ALLOWLIST_RE,
    );
  });

  test("rejects a flag that does not use the --kebab-case shape", () => {
    expect("pi -p --mode json /skill:accord spec PROJ-123 --BAD_FLAG").not.toMatch(
      PI_INVOCATION_ALLOWLIST_RE,
    );
  });
});
