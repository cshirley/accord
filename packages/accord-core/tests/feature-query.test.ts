import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DevHarnessConfig } from "../src/config/types.js";
import { analyseImpact } from "../src/knowledge/impact.js";
import {
  type DisclosureLevel,
  findFeatures,
  impactFor,
  initFeatures,
} from "../src/knowledge/query.js";
import { compileSchemaToZod } from "../src/tools/compile-zod.js";
import { ACCORD_TOOLS } from "../src/tools/registry.js";
import type { ToolDefinition } from "../src/tools/types.js";

const WI = "QRY-7";
let repo = "";

const entry = (id: string, code: string[], extra: Record<string, unknown> = {}) => ({
  id,
  title: `${id} title`,
  description: `${id} description`,
  tags: [],
  status: "active",
  owners: [],
  acs: [],
  anchors: { code, interfaces: [] },
  depends_on: [],
  related: [],
  supersedes: [],
  path: `${id}.md`,
  ...extra,
});

const INDEX = {
  features: [
    entry("auth-refresh", ["src/auth/refresh.ts"], {
      description: "Token refresh flow",
      tags: ["security"],
      depends_on: ["session-store"],
    }),
    entry("session-store", ["src/session/store.ts"]),
    entry("billing", ["src/billing/charge.ts"], { description: "Invoice charging" }),
  ],
};

function put(rel: string, text: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

// Unreadable-but-present files prove a shallower depth never touches deeper files.
const CAN_POISON = process.platform !== "win32" && process.getuid?.() !== 0;
function poison(rel: string, text: string): void {
  put(rel, text);
  chmodSync(join(repo, rel), 0o000);
}

function featureDoc(id: string, changes: unknown[]): string {
  return `---\n${JSON.stringify({
    id,
    type: "feature",
    title: `${id} title`,
    description: `${id} description`,
    status: "active",
    acs: [{ id: "F-1", text: "does a thing", tests: [] }],
    anchors: { code: [], interfaces: [] },
    changes,
  })}\n---\n# ${id}\n`;
}

const EVIDENCE_PATH = `docs/dev/${WI}/evidence/task-1.md`;
const FULL_READS: Array<{ level: DisclosureLevel; path: string }> = [
  { level: "index", path: "docs/features/index.json" },
  { level: "feature", path: "docs/features/auth-refresh.md" },
  { level: "change", path: "docs/features/auth-refresh.md" },
  { level: "evidence", path: EVIDENCE_PATH },
];

function seed(root = "docs/features"): void {
  put(`${root}/index.json`, `${JSON.stringify(INDEX, null, 2)}\n`);
  put(
    `${root}/auth-refresh.md`,
    featureDoc("auth-refresh", [{ work_item: WI, evidence: EVIDENCE_PATH }]),
  );
  put(EVIDENCE_PATH, "EVIDENCE-SENTINEL-4471\n");
  // billing.md / session-store.md deliberately absent: non-matching docs must never be read.
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "feature-query-")));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const tool = (name: string): ToolDefinition => {
  const found = ACCORD_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return found;
};

const ctxWith = (config: unknown) => ({ getConfig: () => config as DevHarnessConfig | null });

describe("ASDLC-1/AC-21 findFeatures", () => {
  it("ASDLC-1/AC-21 query matches index entries by id, description and tag, case-insensitively", () => {
    seed();
    const ids = (query: string) =>
      findFeatures({ repoRoot: repo, query, depth: "index" }).matches.map((m) => m.id);
    expect(ids("auth-refresh")).toEqual(["auth-refresh"]);
    expect(ids("INVOICE")).toEqual(["billing"]);
    expect(ids("security")).toEqual(["auth-refresh"]);
    expect(ids("no-such-thing-xyz")).toEqual([]);
  });

  it("ASDLC-1/AC-21 path matches the feature anchoring that exact code path only", () => {
    seed();
    const ids = (path: string) =>
      findFeatures({ repoRoot: repo, path, depth: "index" }).matches.map((m) => m.id);
    expect(ids("src/session/store.ts")).toEqual(["session-store"]);
    expect(ids("./src/session/store.ts")).toEqual(["session-store"]);
    expect(ids("././src/session/store.ts")).toEqual(["session-store"]);
    expect(ids("src\\session\\store.ts")).toEqual(["session-store"]);
    expect(ids("src/session/other.ts")).toEqual([]);
    expect(ids("src/session")).toEqual([]);
  });

  it("ASDLC-1/AC-21 depth index reads only index.json", () => {
    seed();
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "index" });
    expect(result.reads).toEqual([{ level: "index", path: "docs/features/index.json" }]);
    expect(result.matches[0]).toMatchObject({
      id: "auth-refresh",
      title: "auth-refresh title",
      status: "active",
      path: "auth-refresh.md",
      anchors: { code: ["src/auth/refresh.ts"], interfaces: [] },
    });
    expect(result.matches[0]?.changes).toBeUndefined();
    expect(result.matches[0]?.evidence).toBeUndefined();
  });

  it("ASDLC-1/AC-21 progressive disclosure order: index, then feature doc, then change records, then evidence", () => {
    seed();
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh" });
    // Change records live in the feature doc frontmatter, so the change-level read is the doc path.
    expect(result.reads).toEqual(FULL_READS);
    const match = result.matches[0];
    expect(match?.acs).toEqual([{ id: "F-1", text: "does a thing", tests: [] }]);
    expect(match?.changes).toEqual([{ work_item: WI, evidence: EVIDENCE_PATH }]);
    expect(match?.evidence).toEqual([{ path: EVIDENCE_PATH, content: "EVIDENCE-SENTINEL-4471\n" }]);
  });

  it("ASDLC-1/AC-21 depth feature stops before change records and evidence", () => {
    seed();
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "feature" });
    expect(result.reads).toEqual(FULL_READS.slice(0, 2));
    expect(result.matches[0]?.acs).toEqual([{ id: "F-1", text: "does a thing", tests: [] }]);
    expect(result.matches[0]?.changes).toBeUndefined();
    expect(result.matches[0]?.evidence).toBeUndefined();
  });

  it("ASDLC-1/AC-21 depth change stops before evidence", () => {
    seed();
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "change" });
    expect(result.reads).toEqual(FULL_READS.slice(0, 3));
    expect(result.matches[0]?.acs).toEqual([{ id: "F-1", text: "does a thing", tests: [] }]);
    expect(result.matches[0]?.changes).toEqual([{ work_item: WI, evidence: EVIDENCE_PATH }]);
    expect(result.matches[0]?.evidence).toBeUndefined();
  });

  it("ASDLC-1/AC-21 no match reads only the index and returns no matches", () => {
    seed();
    const result = findFeatures({ repoRoot: repo, query: "zzz-none" });
    expect(result.matches).toEqual([]);
    expect(result.reads).toEqual([{ level: "index", path: "docs/features/index.json" }]);
  });

  it("ASDLC-1/AC-21 honours a custom knowledge root", () => {
    seed("custom/kb");
    const result = findFeatures({ repoRoot: repo, root: "custom/kb", query: "auth-refresh" });
    expect(result.matches.map((m) => m.id)).toEqual(["auth-refresh"]);
    expect(result.reads[0]).toEqual({ level: "index", path: "custom/kb/index.json" });
  });
});

describe("ASDLC-1/AC-21 impactFor", () => {
  const PLAN = {
    tasks: [{ id: 1, files: [{ path: "src/session/store.ts", action: "modify" }] }],
  };

  it("ASDLC-1/AC-21 returns the features impacted by the work item plan, via index.json", () => {
    seed();
    put(`docs/dev/${WI}/plan.json`, JSON.stringify(PLAN));
    const result = impactFor({ repoRoot: repo, id: WI });
    expect(result).toEqual(
      analyseImpact(PLAN, INDEX as unknown as Parameters<typeof analyseImpact>[1]),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ slug: "session-store", relation: "modifies" }),
    ]);
  });

  it("ASDLC-1/AC-21 follows depends_on to reach dependents of the touched feature", () => {
    seed();
    put(
      `docs/dev/${WI}/plan.json`,
      JSON.stringify({
        tasks: [{ id: 1, files: [{ path: "src/auth/refresh.ts", action: "modify" }] }],
      }),
    );
    const slugs = impactFor({ repoRoot: repo, id: WI }).rows.map((row) => row.slug);
    expect(slugs).toEqual(["auth-refresh", "session-store"]);
  });

  it("ASDLC-1/AC-21 honours a custom knowledge root", () => {
    seed("custom/kb");
    put(`docs/dev/${WI}/plan.json`, JSON.stringify(PLAN));
    expect(existsSync(join(repo, "docs/features/index.json"))).toBe(false);
    const result = impactFor({ repoRoot: repo, root: "custom/kb", id: WI });
    expect(result).toEqual(
      analyseImpact(PLAN, INDEX as unknown as Parameters<typeof analyseImpact>[1]),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ slug: "session-store", relation: "modifies" }),
    ]);
  });

  it("ASDLC-1/AC-21 throws naming plan.json when the work item has no plan", () => {
    seed();
    expect(() => impactFor({ repoRoot: repo, id: "NOPE-1" })).toThrow(/plan\.json/);
  });
});

describe("ASDLC-1/AC-21 progressive disclosure with unreadable deeper files", () => {
  const BILLING_DOC = featureDoc("billing", [{ work_item: WI, evidence: EVIDENCE_PATH }]);
  const SESSION_DOC = featureDoc("session-store", []);

  it.skipIf(!CAN_POISON)(
    "ASDLC-1/AC-21 full depth never reads docs of non-matching features",
    () => {
      seed();
      poison("docs/features/billing.md", BILLING_DOC);
      poison("docs/features/session-store.md", SESSION_DOC);
      const result = findFeatures({ repoRoot: repo, query: "auth-refresh" });
      expect(result.reads).toEqual(FULL_READS);
      expect(result.matches.map((m) => m.id)).toEqual(["auth-refresh"]);
    },
  );

  it.skipIf(!CAN_POISON)("ASDLC-1/AC-21 depth index never opens feature docs or evidence", () => {
    seed();
    chmodSync(join(repo, "docs/features/auth-refresh.md"), 0o000);
    chmodSync(join(repo, EVIDENCE_PATH), 0o000);
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "index" });
    expect(result.reads).toEqual([{ level: "index", path: "docs/features/index.json" }]);
    expect(result.matches.map((m) => m.id)).toEqual(["auth-refresh"]);
  });

  it.skipIf(!CAN_POISON)("ASDLC-1/AC-21 depth feature never opens evidence", () => {
    seed();
    chmodSync(join(repo, EVIDENCE_PATH), 0o000);
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "feature" });
    expect(result.reads).toEqual(FULL_READS.slice(0, 2));
    expect(result.matches[0]?.acs).toEqual([{ id: "F-1", text: "does a thing", tests: [] }]);
  });

  it.skipIf(!CAN_POISON)("ASDLC-1/AC-21 depth change never opens evidence", () => {
    seed();
    chmodSync(join(repo, EVIDENCE_PATH), 0o000);
    const result = findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "change" });
    expect(result.reads).toEqual(FULL_READS.slice(0, 3));
    expect(result.matches[0]?.changes).toEqual([{ work_item: WI, evidence: EVIDENCE_PATH }]);
  });
});

describe("ASDLC-1/AC-21 multiple matches and records", () => {
  const two = {
    features: [
      entry("a", ["src/shared/x.ts"], { tags: ["security"] }),
      entry("b", ["src/shared/x.ts"], { tags: ["security"] }),
    ],
  };
  const seedTwo = (docs = true): void => {
    put("docs/features/index.json", JSON.stringify(two));
    if (docs) {
      put("docs/features/a.md", featureDoc("a", [{ work_item: WI, evidence: "ev/a.md" }]));
      put("docs/features/b.md", featureDoc("b", [{ work_item: WI, evidence: "ev/b.md" }]));
      put("ev/a.md", "EV-A\n");
      put("ev/b.md", "EV-B\n");
    }
  };

  it("ASDLC-1/AC-21 a path anchored by several features returns all, in index order", () => {
    seedTwo(false);
    const result = findFeatures({ repoRoot: repo, path: "src/shared/x.ts", depth: "index" });
    expect(result.matches.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("ASDLC-1/AC-21 a query matching two entries returns both, in index order", () => {
    seedTwo(false);
    const result = findFeatures({ repoRoot: repo, query: "security", depth: "index" });
    expect(result.matches.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("ASDLC-1/AC-21 two matches at full depth read each feature's levels in order, feature first", () => {
    seedTwo();
    const result = findFeatures({ repoRoot: repo, query: "security" });
    // Per-feature disclosure: index once, then feature -> change -> evidence for a, then for b.
    expect(result.reads).toEqual([
      { level: "index", path: "docs/features/index.json" },
      { level: "feature", path: "docs/features/a.md" },
      { level: "change", path: "docs/features/a.md" },
      { level: "evidence", path: "ev/a.md" },
      { level: "feature", path: "docs/features/b.md" },
      { level: "change", path: "docs/features/b.md" },
      { level: "evidence", path: "ev/b.md" },
    ]);
    expect(result.matches.map((m) => m.evidence)).toEqual([
      [{ path: "ev/a.md", content: "EV-A\n" }],
      [{ path: "ev/b.md", content: "EV-B\n" }],
    ]);
  });

  it("ASDLC-1/AC-21 several change records yield evidence in record order", () => {
    put("docs/features/index.json", JSON.stringify({ features: [entry("a", ["src/a.ts"])] }));
    put(
      "docs/features/a.md",
      featureDoc("a", [
        { work_item: WI, evidence: "ev/1.md" },
        { work_item: WI, evidence: "ev/2.md" },
      ]),
    );
    put("ev/1.md", "ONE\n");
    put("ev/2.md", "TWO\n");
    const result = findFeatures({ repoRoot: repo, query: "a" });
    expect(result.matches[0]?.evidence).toEqual([
      { path: "ev/1.md", content: "ONE\n" },
      { path: "ev/2.md", content: "TWO\n" },
    ]);
    expect(result.reads.filter((read) => read.level === "evidence")).toEqual([
      { level: "evidence", path: "ev/1.md" },
      { level: "evidence", path: "ev/2.md" },
    ]);
  });

  it("ASDLC-1/AC-21 a change record without evidence causes no evidence read", () => {
    put("docs/features/index.json", JSON.stringify({ features: [entry("a", ["src/a.ts"])] }));
    put("docs/features/a.md", featureDoc("a", [{ work_item: WI }]));
    const result = findFeatures({ repoRoot: repo, query: "a" });
    expect(result.reads.filter((read) => read.level === "evidence")).toEqual([]);
    expect(result.matches[0]?.evidence ?? []).toEqual([]);
    expect(result.matches[0]?.changes).toEqual([{ work_item: WI }]);
  });
});

describe("ASDLC-1/AC-21 findFeatures input and path-safety", () => {
  it("ASDLC-1/AC-21 neither query nor path throws naming the missing input", () => {
    seed();
    expect(() => findFeatures({ repoRoot: repo })).toThrow(/query|path/);
  });

  it("ASDLC-1/AC-21 empty query throws rather than matching everything", () => {
    seed();
    expect(() => findFeatures({ repoRoot: repo, query: "" })).toThrow(/query|path/);
  });

  it("ASDLC-1/AC-21 missing index.json throws naming index.json", () => {
    expect(() => findFeatures({ repoRoot: repo, query: "x" })).toThrow(/index\.json/);
  });

  it("ASDLC-1/AC-21 an evidence path outside the repo is never read", () => {
    const outside = join(repo, "..", `outside-${process.pid}.txt`);
    writeFileSync(outside, "OUTSIDE-SENTINEL-9913\n");
    try {
      put("docs/features/index.json", JSON.stringify({ features: [entry("a", ["src/a.ts"])] }));
      put(
        "docs/features/a.md",
        featureDoc("a", [{ work_item: WI, evidence: `../outside-${process.pid}.txt` }]),
      );
      const result = findFeatures({ repoRoot: repo, query: "a" });
      expect(JSON.stringify(result)).not.toContain("OUTSIDE-SENTINEL-9913");
      expect(result.reads.filter((read) => read.level === "evidence")).toEqual([]);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe("ASDLC-1/AC-21 initFeatures", () => {
  it("ASDLC-1/AC-21 creates the default root with an empty index", () => {
    initFeatures({ repoRoot: repo });
    const text = readFileSync(join(repo, "docs/features/index.json"), "utf8");
    expect(JSON.parse(text)).toEqual({ features: [] });
  });

  it("ASDLC-1/AC-21 creates the index at a custom root", () => {
    initFeatures({ repoRoot: repo, root: "custom/kb" });
    expect(JSON.parse(readFileSync(join(repo, "custom/kb/index.json"), "utf8"))).toEqual({
      features: [],
    });
    expect(existsSync(join(repo, "docs/features/index.json"))).toBe(false);
  });

  it("ASDLC-1/AC-21 does not scan the repo for existing source files", () => {
    put("src/auth/refresh.ts", "export const x = 1;\n");
    put("src/billing/charge.ts", "export const y = 2;\n");
    initFeatures({ repoRoot: repo });
    expect(JSON.parse(readFileSync(join(repo, "docs/features/index.json"), "utf8"))).toEqual({
      features: [],
    });
    expect(existsSync(join(repo, "docs/features/auth-refresh.md"))).toBe(false);
  });

  it("ASDLC-1/AC-21 findFeatures on a fresh init returns no matches", () => {
    initFeatures({ repoRoot: repo });
    expect(findFeatures({ repoRoot: repo, query: "x" })).toEqual({
      matches: [],
      reads: [{ level: "index", path: "docs/features/index.json" }],
    });
  });
});

describe("ASDLC-1/AC-21 dev_feature_* tools", () => {
  const ENABLED = { knowledge: { enabled: true } };
  // Run input through the same zod schema MCP enforces before the handler sees it.
  const parse = (name: string, input: Record<string, unknown>): Record<string, unknown> =>
    compileSchemaToZod(tool(name).parameters).parse(input) as Record<string, unknown>;
  const call = (name: string, input: Record<string, unknown>, config: unknown = ENABLED) =>
    tool(name).handler(parse(name, input), ctxWith(config));

  it("ASDLC-1/AC-21 dev_feature_find returns the same result as findFeatures", async () => {
    seed();
    const input = { query: "auth-refresh", cwd: repo };
    expect(parse("dev_feature_find", input)).toEqual(input);
    const result = await call("dev_feature_find", input);
    expect(result.ok).toBe(true);
    expect(result.details).toEqual(findFeatures({ repoRoot: repo, query: "auth-refresh" }));
    expect(result.text).toContain("auth-refresh");
  });

  it("ASDLC-1/AC-21 dev_feature_find supports path lookups", async () => {
    seed();
    const input = { path: "src/billing/charge.ts", cwd: repo };
    expect(parse("dev_feature_find", input)).toEqual(input);
    const result = await call("dev_feature_find", input);
    expect(result.details).toEqual(findFeatures({ repoRoot: repo, path: "src/billing/charge.ts" }));
    expect((result.details as { matches: Array<{ id: string }> }).matches.map((m) => m.id)).toEqual(
      ["billing"],
    );
  });

  it("ASDLC-1/AC-21 dev_feature_find depth index reads only index.json", async () => {
    seed();
    const input = { query: "auth-refresh", cwd: repo, depth: "index" };
    expect(parse("dev_feature_find", input)).toEqual(input);
    const result = await call("dev_feature_find", input);
    expect(result.details).toEqual(
      findFeatures({ repoRoot: repo, query: "auth-refresh", depth: "index" }),
    );
    expect((result.details as { reads: unknown[] }).reads).toEqual([
      { level: "index", path: "docs/features/index.json" },
    ]);
  });

  it("ASDLC-1/AC-21 dev_feature_find honours knowledge.root from config", async () => {
    seed("custom/kb");
    const result = await call(
      "dev_feature_find",
      { query: "auth-refresh", cwd: repo },
      { knowledge: { enabled: true, root: "custom/kb" } },
    );
    expect(result.details).toEqual(
      findFeatures({ repoRoot: repo, root: "custom/kb", query: "auth-refresh" }),
    );
  });

  it("ASDLC-1/AC-21 dev_feature_find with no index.json returns ok:false naming index.json", async () => {
    const result = await call("dev_feature_find", { query: "x", cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/index\.json/);
  });

  it("ASDLC-1/AC-21 dev_feature_impact returns the same result as impactFor", async () => {
    seed();
    put(
      `docs/dev/${WI}/plan.json`,
      JSON.stringify({
        tasks: [{ id: 1, files: [{ path: "src/billing/charge.ts", action: "delete" }] }],
      }),
    );
    const input = { id: WI, cwd: repo };
    expect(parse("dev_feature_impact", input)).toEqual(input);
    const result = await call("dev_feature_impact", input);
    expect(result.ok).toBe(true);
    expect(result.details).toEqual(impactFor({ repoRoot: repo, id: WI }));
    expect((result.details as { rows: Array<{ slug: string; relation: string }> }).rows).toEqual([
      expect.objectContaining({ slug: "billing", relation: "deprecates" }),
    ]);
  });

  it("ASDLC-1/AC-21 dev_feature_impact honours knowledge.root from config", async () => {
    seed("custom/kb");
    put(
      `docs/dev/${WI}/plan.json`,
      JSON.stringify({
        tasks: [{ id: 1, files: [{ path: "src/session/store.ts", action: "modify" }] }],
      }),
    );
    const result = await call(
      "dev_feature_impact",
      { id: WI, cwd: repo },
      { knowledge: { enabled: true, root: "custom/kb" } },
    );
    expect(existsSync(join(repo, "docs/features/index.json"))).toBe(false);
    expect(result.details).toEqual(impactFor({ repoRoot: repo, root: "custom/kb", id: WI }));
    expect((result.details as { rows: Array<{ slug: string; relation: string }> }).rows).toEqual([
      expect.objectContaining({ slug: "session-store", relation: "modifies" }),
    ]);
  });

  it("ASDLC-1/AC-21 dev_feature_impact for a work item without a plan returns ok:false naming plan.json", async () => {
    seed();
    const result = await call("dev_feature_impact", { id: "NOPE-1", cwd: repo });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/plan\.json/);
  });

  // Spec deployment flag: features ship dark behind knowledge.enabled.
  it.each([
    ["absent config", null],
    ["knowledge.enabled false", { knowledge: { enabled: false } }],
    ["knowledge without enabled", { knowledge: {} }],
  ])("ASDLC-1/AC-21 both tools are disabled with %s", async (_label, config) => {
    seed();
    put(`docs/dev/${WI}/plan.json`, JSON.stringify({ tasks: [] }));
    const found = await call("dev_feature_find", { query: "auth-refresh", cwd: repo }, config);
    expect(found.ok).toBe(false);
    expect(found.text).toMatch(/knowledge\.enabled/);
    const impact = await call("dev_feature_impact", { id: WI, cwd: repo }, config);
    expect(impact.ok).toBe(false);
    expect(impact.text).toMatch(/knowledge\.enabled/);
  });
});
