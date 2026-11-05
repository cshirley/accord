import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { parse as parseYaml } from "yaml";
import { validateFeatures } from "../src/knowledge/feature-doc.js";
import { generateFeatureIndex } from "../src/knowledge/index-gen.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "features");
const SCHEMA = join(HERE, "..", "schemas", "feature-schema.json");

const tmpDirs: string[] = [];
beforeEach(() => {
  tmpDirs.length = 0;
});
afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function copyFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "feature-docs-"));
  tmpDirs.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

function codes(repoRoot: string, maxAcsPerFeature?: number): string[] {
  const result = validateFeatures({ repoRoot, root: "docs/features", maxAcsPerFeature });
  return result.errors.map((e) => `${e.feature}:${e.code}`).sort();
}

const SUPPORT_FILES = ["src/auth/refresh.ts", "verify/refresh.proof.ts"];

/** Temp repo with the valid fixture's support files plus the given files (repo-relative). */
function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "feature-docs-gen-"));
  tmpDirs.push(dir);
  for (const rel of SUPPORT_FILES) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(FIXTURES, "valid", rel), join(dir, rel));
  }
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

interface DocOptions {
  id: string;
  acs?: string;
  anchorsCode?: string;
  dependsOn?: string;
  related?: string;
  body?: string;
}

function featureDoc(o: DocOptions): string {
  return `---
id: ${o.id}
type: Feature
title: Title of ${o.id}
description: Fixture ${o.id}.
tags: [fixture]
status: active
owners: [team-auth]
${o.acs ?? `acs:\n  - { id: ${o.id}.AC1, text: "one", tests: ["verify/refresh.proof.ts#expired"] }`}
anchors:
  code: ${o.anchorsCode ?? "[src/auth/refresh.ts]"}
  interfaces: []
depends_on: ${o.dependsOn ?? "[]"}
related: ${o.related ?? "[]"}
supersedes: []
changes: []
---

# ${o.id}

${o.body ?? ""}
`;
}

const oneAc = (tests: string | null, id = "feat-one"): string =>
  `acs:\n  - { id: ${id}.AC1, text: "one"${tests === null ? "" : `, tests: ${tests}`} }`;

describe("ASDLC-1/AC-18 validateFeatures (ASDLC-1/TC-19)", () => {
  it("ASDLC-1/AC-18 valid fixture passes with no errors", () => {
    const result = validateFeatures({
      repoRoot: join(FIXTURES, "valid"),
      root: "docs/features",
      maxAcsPerFeature: 12,
    });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("ASDLC-1/AC-18 reports a broken code anchor", () => {
    expect(codes(join(FIXTURES, "broken-anchor"))).toEqual(["feat-one:broken-anchor"]);
  });

  it("ASDLC-1/AC-18 reports a broken body link", () => {
    expect(codes(join(FIXTURES, "broken-link"))).toEqual(["feat-one:broken-link"]);
  });

  it("ASDLC-1/AC-18 reports an AC without a test", () => {
    expect(codes(join(FIXTURES, "ac-without-test"))).toEqual(["feat-one:ac-without-test"]);
  });

  it("ASDLC-1/AC-18 reports a test reference whose file does not exist", () => {
    expect(codes(join(FIXTURES, "bad-test-file"))).toEqual(["feat-one:unresolved-test"]);
  });

  it("ASDLC-1/AC-18 reports a test reference whose name is absent from an existing file", () => {
    expect(codes(join(FIXTURES, "bad-test-name"))).toEqual(["feat-one:unresolved-test"]);
  });

  it.each([
    ["broken-anchor", undefined, ["src/auth/missing.ts"]],
    ["broken-link", undefined, ["does-not-exist.md"]],
    ["ac-without-test", undefined, ["feat-one.AC1"]],
    ["bad-test-file", undefined, ["verify/nope.proof.ts"]],
    ["bad-test-name", undefined, ["no_such_case"]],
    ["oversized", 2, ["3", "big-feature"]],
  ] as const)(
    "ASDLC-1/AC-18 failing fixture %s carries ok=false and a message naming the problem",
    (fixture, max, tokens) => {
      const result = validateFeatures({
        repoRoot: join(FIXTURES, fixture),
        root: "docs/features",
        maxAcsPerFeature: max,
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      for (const token of tokens) expect(result.errors[0].message).toContain(token);
    },
  );

  it("ASDLC-1/AC-18 feature above max_acs_per_feature is reported; at the max it is not", () => {
    const over = codes(join(FIXTURES, "oversized"), 2);
    expect(over).toEqual(["big-feature:too-many-acs"]);
    expect(codes(join(FIXTURES, "oversized"), 3)).toEqual([]);
    expect(codes(join(FIXTURES, "oversized"), 12)).toEqual([]);
  });

  it("ASDLC-1/AC-18 max_acs_per_feature defaults to 12 (12 ok, 13 reported)", () => {
    const build = (count: number): string => {
      const dir = copyFixture("oversized");
      const acs = Array.from(
        { length: count },
        (_, n) =>
          `  - { id: big-feature.AC${n + 1}, text: "ac", tests: ["verify/refresh.proof.ts#expired"] }`,
      ).join("\n");
      const doc = readFileSync(join(dir, "docs/features/big-feature.md"), "utf8").replace(
        /acs:\n( {2}- \{[^\n]*\n)+/,
        `acs:\n${acs}\n`,
      );
      writeFileSync(join(dir, "docs/features/big-feature.md"), doc);
      return dir;
    };
    expect(codes(build(12))).toEqual([]);
    expect(codes(build(13))).toEqual(["big-feature:too-many-acs"]);
  });
});

describe("ASDLC-1/AC-18 generateFeatureIndex (ASDLC-1/TC-19)", () => {
  it("ASDLC-1/AC-18 writes index.md and index.json matching the returned content", () => {
    const dir = copyFixture("valid");
    const result = generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    expect(readFileSync(join(dir, "docs/features/index.md"), "utf8")).toBe(result.indexMd);
    expect(readFileSync(join(dir, "docs/features/index.json"), "utf8")).toBe(result.indexJson);
  });

  it("ASDLC-1/AC-18 index.json lists every feature sorted by id with search fields", () => {
    const dir = copyFixture("valid");
    const { indexJson } = generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    const parsed = JSON.parse(indexJson);
    expect(parsed.features.map((f: { id: string }) => f.id)).toEqual([
      "auth-token-refresh",
      "session-store",
    ]);
    const idsOf = (acs: unknown[]): string[] =>
      acs.map((a) => (typeof a === "string" ? a : (a as { id: string }).id));
    expect(parsed.features[0]).toMatchObject({
      id: "auth-token-refresh",
      title: "Token refresh",
      description: "Refresh expired session tokens.",
      tags: ["auth", "session"],
      status: "active",
      owners: ["team-auth"],
      depends_on: ["session-store"],
      related: [],
    });
    expect(parsed.features[0].path).toMatch(/auth-token-refresh\.md$/);
    expect(idsOf(parsed.features[0].acs)).toEqual([
      "auth-token-refresh.AC1",
      "auth-token-refresh.AC2",
    ]);
    expect(parsed.features[0].anchors.code).toEqual(["src/auth/refresh.ts"]);
    expect(parsed.features[1]).toMatchObject({
      id: "session-store",
      title: "Session store",
      description: "Persist sessions.",
      tags: ["session"],
      status: "active",
      owners: ["team-auth"],
      depends_on: [],
      related: ["auth-token-refresh"],
    });
    expect(parsed.features[1].path).toMatch(/session-store\.md$/);
    expect(idsOf(parsed.features[1].acs)).toEqual(["session-store.AC1"]);
    expect(parsed.features[1].anchors.code).toEqual(["src/auth/refresh.ts"]);
  });

  it("ASDLC-1/AC-18 index.md names every feature id and title", () => {
    const dir = copyFixture("valid");
    const { indexMd } = generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    for (const needle of [
      "auth-token-refresh",
      "Token refresh",
      "session-store",
      "Session store",
    ]) {
      expect(indexMd).toContain(needle);
    }
  });

  it("ASDLC-1/AC-18 regeneration is byte-identical, in place and across different checkout paths", () => {
    const first = copyFixture("valid");
    const second = copyFixture("valid");
    const a = generateFeatureIndex({ repoRoot: first, root: "docs/features" });
    const again = generateFeatureIndex({ repoRoot: first, root: "docs/features" });
    const b = generateFeatureIndex({ repoRoot: second, root: "docs/features" });
    expect(again).toEqual(a);
    expect(b).toEqual(a);
    expect(readFileSync(join(first, "docs/features/index.md"), "utf8")).toBe(a.indexMd);
    expect(readFileSync(join(first, "docs/features/index.json"), "utf8")).toBe(a.indexJson);
    expect(a.indexJson).not.toContain(first);
    expect(a.indexMd).not.toContain(first);
  });

  it("ASDLC-1/AC-18 output is independent of the system clock", () => {
    const first = copyFixture("valid");
    const second = copyFixture("valid");
    try {
      setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const early = generateFeatureIndex({ repoRoot: first, root: "docs/features" });
      setSystemTime(new Date("2031-06-15T12:34:56Z"));
      const late = generateFeatureIndex({ repoRoot: second, root: "docs/features" });
      expect(late).toEqual(early);
    } finally {
      setSystemTime();
    }
  });

  it("ASDLC-1/AC-18 index.json is sorted by id, not by file name", () => {
    const dir = makeRepo({
      "docs/features/a.md": featureDoc({ id: "zeta-feature" }),
      "docs/features/b.md": featureDoc({ id: "alpha-feature" }),
      "docs/features/c.md": featureDoc({ id: "mid-feature" }),
    });
    const { indexJson } = generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    expect(JSON.parse(indexJson).features.map((f: { id: string }) => f.id)).toEqual([
      "alpha-feature",
      "mid-feature",
      "zeta-feature",
    ]);
  });

  it("ASDLC-1/AC-18 index does not list itself and ignores a stale existing index", () => {
    const dir = copyFixture("valid");
    writeFileSync(join(dir, "docs/features/index.json"), '{"features":[{"id":"stale"}]}\n');
    writeFileSync(join(dir, "docs/features/index.md"), "stale\n");
    const { indexJson, indexMd } = generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    expect(JSON.parse(indexJson).features).toHaveLength(2);
    expect(indexMd).not.toContain("stale");
  });
});

describe("ASDLC-1/AC-30 feature schema alignment (ASDLC-1/TC-31)", () => {
  // Enforcement of manifest/registry alignment is `bun run validate:schemas` and
  // `validate:assets` (see alignment.test.ts); here we pin the schema's frontmatter keys.
  it("ASDLC-1/AC-30 feature-schema.json declares the OKF frontmatter keys", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
    expect(Object.keys(schema.properties).sort()).toEqual(
      [
        "acs",
        "anchors",
        "changes",
        "depends_on",
        "description",
        "id",
        "owners",
        "related",
        "status",
        "supersedes",
        "tags",
        "title",
        "type",
      ].sort(),
    );
    expect(schema.properties.status.enum).toEqual([
      "proposed",
      "active",
      "deprecated",
      "superseded",
    ]);
    expect(schema.required).toEqual(expect.arrayContaining(["id", "type", "title", "acs"]));
  });
});

describe("ASDLC-1/AC-18 generated index is part of a valid tree (ASDLC-1/TC-19)", () => {
  it("ASDLC-1/AC-18 validateFeatures passes on a tree that already contains the generated index", () => {
    const dir = copyFixture("valid");
    generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    expect(existsSync(join(dir, "docs/features/index.md"))).toBe(true);
    expect(existsSync(join(dir, "docs/features/index.json"))).toBe(true);
    expect(validateFeatures({ repoRoot: dir, root: "docs/features" })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("ASDLC-1/AC-18 index.md links each feature doc with a resolvable relative link", () => {
    const dir = copyFixture("valid");
    const { indexMd } = generateFeatureIndex({ repoRoot: dir, root: "docs/features" });
    const targets = [...indexMd.matchAll(/\]\(([^)#\s]+)/g)].map((m) => m[1]);
    for (const name of ["auth-token-refresh.md", "session-store.md"]) {
      expect(targets.some((t) => t.endsWith(name))).toBe(true);
    }
    for (const target of targets) {
      expect(existsSync(join(dir, "docs/features", target))).toBe(true);
    }
  });
});

describe("ASDLC-1/AC-18 knowledge.root is configurable (ASDLC-1/TC-19)", () => {
  const moveToKb = (name: string): string => {
    const dir = copyFixture(name);
    mkdirSync(join(dir, "kb"), { recursive: true });
    renameSync(join(dir, "docs/features"), join(dir, "kb/features"));
    return dir;
  };

  it("ASDLC-1/AC-18 validateFeatures honours a non-default root", () => {
    const broken = moveToKb("broken-anchor");
    const result = validateFeatures({ repoRoot: broken, root: "kb/features" });
    expect(result.errors.map((e) => `${e.feature}:${e.code}`)).toEqual(["feat-one:broken-anchor"]);
    expect(validateFeatures({ repoRoot: moveToKb("valid"), root: "kb/features" })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("ASDLC-1/AC-18 generateFeatureIndex honours a non-default root", () => {
    const dir = moveToKb("valid");
    generateFeatureIndex({ repoRoot: dir, root: "kb/features" });
    const parsed = JSON.parse(readFileSync(join(dir, "kb/features/index.json"), "utf8"));
    expect(parsed.features.map((f: { id: string }) => f.id)).toEqual([
      "auth-token-refresh",
      "session-store",
    ]);
    expect(existsSync(join(dir, "docs/features/index.json"))).toBe(false);
  });

  it("ASDLC-1/AC-18 root defaults to docs/features when omitted", () => {
    const broken = copyFixture("broken-anchor");
    expect(
      validateFeatures({ repoRoot: broken }).errors.map((e) => `${e.feature}:${e.code}`),
    ).toEqual(["feat-one:broken-anchor"]);
    const dir = copyFixture("valid");
    generateFeatureIndex({ repoRoot: dir });
    expect(existsSync(join(dir, "docs/features/index.json"))).toBe(true);
    expect(existsSync(join(dir, "docs/features/index.md"))).toBe(true);
  });
});

describe("ASDLC-1/AC-18 every defect in every doc is reported (ASDLC-1/TC-19)", () => {
  it("ASDLC-1/AC-18 multi-defect tree reports all five defects, sorted, with specific messages", () => {
    const dir = makeRepo({
      "docs/features/alpha.md": featureDoc({
        id: "alpha",
        acs: `acs:
  - { id: alpha.AC1, text: "one", tests: ["verify/refresh.proof.ts#expired", "verify/missing.proof.ts#x"] }
  - { id: alpha.AC2, text: "two", tests: [] }`,
        anchorsCode: "[src/auth/refresh.ts, src/auth/gone.ts]",
        body: "See [nope](./nope.md).",
      }),
      "docs/features/beta.md": featureDoc({
        id: "beta",
        acs: `acs:\n  - { id: beta.AC1, text: "one", tests: ["verify/refresh.proof.ts#nope_case"] }`,
      }),
    });
    const result = validateFeatures({ repoRoot: dir, root: "docs/features" });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => `${e.feature}:${e.code}`).sort()).toEqual([
      "alpha:ac-without-test",
      "alpha:broken-anchor",
      "alpha:broken-link",
      "alpha:unresolved-test",
      "beta:unresolved-test",
    ]);
    const msg = (code: string, feature: string): string =>
      result.errors.find((e) => e.code === code && e.feature === feature)?.message ?? "";
    expect(msg("unresolved-test", "alpha")).toContain("verify/missing.proof.ts");
    expect(msg("broken-anchor", "alpha")).toContain("src/auth/gone.ts");
  });

  it("ASDLC-1/AC-18 attributes errors by frontmatter id, not file name", () => {
    const dir = copyFixture("broken-anchor");
    renameSync(join(dir, "docs/features/feat-one.md"), join(dir, "docs/features/other-name.md"));
    expect(codes(dir)).toEqual(["feat-one:broken-anchor"]);
  });

  it("ASDLC-1/AC-18 block-style YAML frontmatter is parsed (not just inline)", () => {
    const doc = featureDoc({
      id: "feat-one",
      acs: `acs:
  - id: feat-one.AC1
    text: one
    tests: []
  - id: feat-one.AC2
    text: two
    tests:
      - verify/refresh.proof.ts#expired`,
      anchorsCode: "\n    - src/auth/missing.ts",
    });
    const dir = makeRepo({ "docs/features/feat-one.md": doc });
    expect(codes(dir)).toEqual(["feat-one:ac-without-test", "feat-one:broken-anchor"]);
    expect(codes(dir, 1)).toContain("feat-one:too-many-acs");
  });
});

describe("ASDLC-1/AC-18 AC test-reference partitions (ASDLC-1/TC-19)", () => {
  it.each([
    ["tests key omitted", null, ["ac-without-test"]],
    ["empty-string reference", '[""]', ["ac-without-test", "unresolved-test"]],
    ["empty test name", '["verify/refresh.proof.ts#"]', ["unresolved-test"]],
    ["directory as test file", '["verify#expired"]', ["unresolved-test"]],
    ["path escaping the repo", '["../../outside.proof.ts#x"]', ["unresolved-test"]],
  ] as const)("ASDLC-1/AC-18 %s is reported, not accepted", (_label, tests, allowed) => {
    const dir = makeRepo({
      "docs/features/feat-one.md": featureDoc({ id: "feat-one", acs: oneAc(tests) }),
    });
    writeFileSync(join(dirname(dir), "outside.proof.ts"), "// x\n");
    try {
      const result = validateFeatures({ repoRoot: dir, root: "docs/features" });
      expect(result.ok).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].feature).toBe("feat-one");
      expect(allowed as readonly string[]).toContain(result.errors[0].code);
    } finally {
      rmSync(join(dirname(dir), "outside.proof.ts"), { force: true });
    }
  });

  it("ASDLC-1/AC-18 an anchor escaping the repo is a broken anchor", () => {
    const dir = makeRepo({
      "docs/features/feat-one.md": featureDoc({
        id: "feat-one",
        anchorsCode: '["../../outside.ts"]',
      }),
    });
    writeFileSync(join(dirname(dir), "outside.ts"), "// x\n");
    try {
      expect(codes(dir)).toEqual(["feat-one:broken-anchor"]);
    } finally {
      rmSync(join(dirname(dir), "outside.ts"), { force: true });
    }
  });
});

describe("ASDLC-1/AC-18 link checks (ASDLC-1/TC-19)", () => {
  it("ASDLC-1/AC-18 external, fragment and fenced-code links are not reported", () => {
    const dir = makeRepo({
      "docs/features/session-store.md": featureDoc({ id: "session-store" }),
      "docs/features/auth-token-refresh.md": featureDoc({
        id: "auth-token-refresh",
        body: [
          "[ext](https://example.com/a)",
          "[frag](./session-store.md#session-store)",
          "[top](#token-refresh)",
          "",
          "```md",
          "[x](./nope.md)",
          "```",
        ].join("\n"),
      }),
    });
    expect(validateFeatures({ repoRoot: dir, root: "docs/features" })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it.each(["depends_on", "related"] as const)(
    "ASDLC-1/AC-18 dangling %s is a broken link",
    (key) => {
      const dir = makeRepo({
        "docs/features/feat-one.md": featureDoc({
          id: "feat-one",
          [key === "depends_on" ? "dependsOn" : "related"]: "[no-such-feature]",
        }),
      });
      const result = validateFeatures({ repoRoot: dir, root: "docs/features" });
      expect(result.errors.map((e) => `${e.feature}:${e.code}`)).toEqual(["feat-one:broken-link"]);
      expect(result.errors[0].message).toContain("no-such-feature");
    },
  );
});

describe("ASDLC-1/AC-30 feature schema validates the fixture frontmatter (ASDLC-1/TC-31)", () => {
  const frontmatter = (file: string): Record<string, unknown> => {
    const text = readFileSync(join(FIXTURES, "valid/docs/features", file), "utf8");
    const match = /^---\n([\s\S]*?)\n---/.exec(text);
    return parseYaml(match?.[1] ?? "") as Record<string, unknown>;
  };
  const compile = () =>
    new Ajv({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(SCHEMA, "utf8")));

  it("ASDLC-1/AC-30 both valid fixture frontmatters validate", () => {
    const validate = compile();
    for (const file of ["auth-token-refresh.md", "session-store.md"]) {
      expect(validate(frontmatter(file))).toBe(true);
      expect(validate.errors).toBeNull();
    }
  });

  it.each([
    ["missing id", (f: Record<string, any>) => (f.id = undefined)],
    ["status outside enum", (f: Record<string, any>) => (f.status = "live")],
    ["acs not an array", (f: Record<string, any>) => (f.acs = "x")],
    ["ac without tests", (f: Record<string, any>) => (f.acs[0].tests = undefined)],
    ["ac tests a string", (f: Record<string, any>) => (f.acs[0].tests = "verify/a.ts")],
    ["anchors.code a string", (f: Record<string, any>) => (f.anchors.code = "src/a.ts")],
  ])("ASDLC-1/AC-30 schema rejects: %s", (_label, mutate) => {
    const doc = frontmatter("auth-token-refresh.md");
    mutate(doc);
    expect(compile()(doc)).toBe(false);
  });

  // Enforcement of alignment is `bun run validate:schemas` (phase-verify-task); it only
  // checks schemas with an examples/<name>.json, which this task does not add.
});
