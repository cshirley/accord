import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
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
import Ajv from "ajv";
import { syncSpecMarkdownFromJson } from "../src/artifacts/spec-markdown.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { verifyContractLock } from "../src/contract/lock.js";
import { buildContractPr0 } from "../src/contract/pr0.js";
import { analyseImpact, type ImpactIndex, type ImpactPlan } from "../src/knowledge/impact.js";

const ID = "TESTIMP-1";
const BASE = `docs/dev/${ID}`;
const RELATIONS = ["new", "extends", "modifies", "deprecates", "depends_on"];

const feature = (
  id: string,
  code: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  title: id,
  description: `${id} feature`,
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
    feature("auth-refresh", ["src/auth/refresh.ts"], {
      depends_on: ["session-store"],
      related: ["audit-log"],
    }),
    feature("session-store", ["src/session/store.ts"], { depends_on: ["crypto-core"] }),
    feature("crypto-core", ["src/crypto/core.ts"]),
    feature("audit-log", ["src/audit/log.ts"]),
    feature("reports", ["src/shared/util.ts"]),
    feature("exports", ["src/shared/util.ts"]),
    feature("legacy-login", ["src/auth/login.ts"], { status: "deprecated" }),
    feature("billing", ["src/billing/charge.ts"]),
  ],
} as unknown as ImpactIndex;

const planOf = (files: Array<{ path: string; action: string }>): ImpactPlan => ({
  tasks: [{ id: 1, files }],
});
const rowOf = (rows: Array<{ slug: string; relation: string }>, slug: string) =>
  rows.find((row) => row.slug === slug);

describe("ASDLC-1/AC-19 analyseImpact", () => {
  it("ASDLC-1/AC-19 modify of an anchored file yields a modifies row for that feature only", () => {
    const result = analyseImpact(
      planOf([{ path: "src/billing/charge.ts", action: "modify" }]),
      INDEX,
    );
    expect(result.rows).toEqual([
      expect.objectContaining({ slug: "billing", relation: "modifies" }),
    ]);
    expect(result.decisions).toEqual([]);
  });

  it("ASDLC-1/AC-19 delete of an anchored file yields a deprecates row", () => {
    const result = analyseImpact(
      planOf([{ path: "src/billing/charge.ts", action: "delete" }]),
      INDEX,
    );
    expect(rowOf(result.rows, "billing")?.relation).toBe("deprecates");
  });

  it("ASDLC-1/AC-19 add of a file at an anchored path yields an extends row", () => {
    const result = analyseImpact(planOf([{ path: "src/billing/charge.ts", action: "add" }]), INDEX);
    expect(rowOf(result.rows, "billing")?.relation).toBe("extends");
  });

  it("ASDLC-1/AC-19 files intersecting no anchor yield no rows and no decisions", () => {
    const result = analyseImpact(
      planOf([
        { path: "src/unrelated/thing.ts", action: "add" },
        { path: "src/billing/charge.tsx", action: "modify" },
        { path: "src/billing", action: "modify" },
      ]),
      INDEX,
    );
    expect(result.rows).toEqual([]);
    expect(result.decisions).toEqual([]);
  });

  it("ASDLC-1/AC-19 traverses depends_on transitively as depends_on rows", () => {
    const result = analyseImpact(
      planOf([{ path: "src/auth/refresh.ts", action: "modify" }]),
      INDEX,
    );
    expect(rowOf(result.rows, "auth-refresh")?.relation).toBe("modifies");
    expect(rowOf(result.rows, "session-store")?.relation).toBe("depends_on");
    expect(rowOf(result.rows, "crypto-core")?.relation).toBe("depends_on");
    expect(result.decisions).toEqual([]);
  });

  it("ASDLC-1/AC-19 includes related features with a valid relation", () => {
    const result = analyseImpact(
      planOf([{ path: "src/auth/refresh.ts", action: "modify" }]),
      INDEX,
    );
    const related = rowOf(result.rows, "audit-log");
    expect(related).toBeDefined();
    expect(RELATIONS).toContain(related?.relation as string);
    // F-003: pinned to one value; a related feature is not itself modified/extended/deprecated/new
    expect(related?.relation).toBe("depends_on");
    expect(result.decisions).toEqual([]);
    // unrelated features stay out
    expect(rowOf(result.rows, "billing")).toBeUndefined();
    expect(rowOf(result.rows, "reports")).toBeUndefined();
  });

  it("ASDLC-1/AC-19 emits one row per feature (no duplicates) when several files hit it", () => {
    const result = analyseImpact(
      {
        tasks: [
          { id: 1, files: [{ path: "src/billing/charge.ts", action: "modify" }] },
          { id: 2, files: [{ path: "src/billing/charge.ts", action: "modify" }] },
        ],
      },
      INDEX,
    );
    expect(result.rows.filter((row) => row.slug === "billing")).toHaveLength(1);
  });

  it("ASDLC-1/AC-19 two features anchoring the same touched file become one overlap decision", () => {
    const result = analyseImpact(planOf([{ path: "src/shared/util.ts", action: "modify" }]), INDEX);
    expect(rowOf(result.rows, "reports")?.relation).toBe("modifies");
    expect(rowOf(result.rows, "exports")?.relation).toBe("modifies");
    expect(result.decisions).toHaveLength(1);
    const text = `${result.decisions[0]?.question} ${result.decisions[0]?.context}`;
    expect(text).toContain("reports");
    expect(text).toContain("exports");
    expect(result.decisions[0]?.kind).toBe("overlap");
  });

  it("ASDLC-1/AC-19 modifying a deprecated feature's anchor becomes a contradiction decision", () => {
    const result = analyseImpact(planOf([{ path: "src/auth/login.ts", action: "modify" }]), INDEX);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.kind).toBe("contradiction");
    expect(`${result.decisions[0]?.question} ${result.decisions[0]?.context}`).toContain(
      "legacy-login",
    );
  });

  it("ASDLC-1/AC-19 an empty index yields no rows and no decisions", () => {
    const result = analyseImpact(planOf([{ path: "src/a.ts", action: "add" }]), {
      features: [],
    } as ImpactIndex);
    expect(result).toEqual({ rows: [], decisions: [] });
  });

  it("ASDLC-1/AC-19 survives depends_on cycles and unknown slugs", () => {
    const index = {
      features: [
        feature("a", ["src/a.ts"], { depends_on: ["b", "ghost"] }),
        feature("b", ["src/b.ts"], { depends_on: ["a"] }),
      ],
    } as unknown as ImpactIndex;
    const result = analyseImpact(planOf([{ path: "src/a.ts", action: "modify" }]), index);
    expect(rowOf(result.rows, "a")?.relation).toBe("modifies");
    expect(rowOf(result.rows, "b")?.relation).toBe("depends_on");
    expect(rowOf(result.rows, "ghost")).toBeUndefined();
    expect(result.decisions).toEqual([]);
  });

  // F-011: paths are normalised before anchor matching
  it("ASDLC-1/AC-19 a ./-prefixed plan path matches the anchor (normalised)", () => {
    const result = analyseImpact(
      planOf([{ path: "./src/billing/charge.ts", action: "modify" }]),
      INDEX,
    );
    expect(rowOf(result.rows, "billing")?.relation).toBe("modifies");
  });

  // F-002: direct relation beats depends_on/related in every file and task order
  type PlanFile = { path: string; action: string };
  const refresh: PlanFile = { path: "src/auth/refresh.ts", action: "modify" };
  const store: PlanFile = { path: "src/session/store.ts", action: "modify" };
  const auditDelete: PlanFile = { path: "src/audit/log.ts", action: "delete" };
  it.each([
    ["refresh then store", [[refresh, store]], { "session-store": "modifies" }],
    ["store then refresh", [[store, refresh]], { "session-store": "modifies" }],
    ["two tasks refresh/store", [[refresh], [store]], { "session-store": "modifies" }],
    ["two tasks store/refresh", [[store], [refresh]], { "session-store": "modifies" }],
    ["refresh then audit delete", [[refresh, auditDelete]], { "audit-log": "deprecates" }],
    ["audit delete then refresh", [[auditDelete, refresh]], { "audit-log": "deprecates" }],
  ] as Array<[string, PlanFile[][], Record<string, string>]>)(
    "ASDLC-1/AC-19 direct relation wins over traversal: %s",
    (_name, taskFiles, expectedDirect) => {
      const result = analyseImpact(
        { tasks: taskFiles.map((files, index) => ({ id: index + 1, files })) },
        INDEX,
      );
      for (const [slug, relation] of Object.entries(expectedDirect)) {
        expect(rowOf(result.rows, slug)?.relation).toBe(relation);
      }
      expect(rowOf(result.rows, "auth-refresh")?.relation).toBe("modifies");
      if (!("session-store" in expectedDirect)) {
        // store untouched: reached only through depends_on
        expect(rowOf(result.rows, "session-store")?.relation).toBe("depends_on");
      }
      expect(rowOf(result.rows, "crypto-core")?.relation).toBe("depends_on");
      for (const slug of new Set(result.rows.map((row) => row.slug))) {
        expect(result.rows.filter((row) => row.slug === slug)).toHaveLength(1);
      }
    },
  );

  // F-004: contradiction rule per status x action
  const statusIndex = (status: string): ImpactIndex =>
    ({
      features: [feature("subject", ["src/subject.ts"], { status })],
    }) as unknown as ImpactIndex;
  it.each([
    ["superseded", "modify", "modifies", 1],
    ["deprecated", "modify", "modifies", 1],
    ["deprecated", "add", "extends", 1],
    ["deprecated", "delete", "deprecates", 0], // consistent retirement: no decision
    ["active", "modify", "modifies", 0],
    ["active", "delete", "deprecates", 0],
  ] as Array<[string, string, string, number]>)(
    "ASDLC-1/AC-19 status %s + action %s => relation %s, %i decision(s)",
    (status, action, relation, decisionCount) => {
      const result = analyseImpact(
        planOf([{ path: "src/subject.ts", action }]),
        statusIndex(status),
      );
      expect(rowOf(result.rows, "subject")?.relation).toBe(relation);
      expect(result.decisions).toHaveLength(decisionCount);
      if (decisionCount > 0) {
        expect(result.decisions[0]?.kind).toBe("contradiction");
        expect(`${result.decisions[0]?.question} ${result.decisions[0]?.context}`).toContain(
          "subject",
        );
      }
    },
  );
});

const SPEC = {
  schema_version: "1.0",
  work_item_id: ID,
  title: "t",
  date: "2026-01-01",
  problem_statement: "p",
  proposed_solution: "s",
  acceptance_criteria: [
    { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "Given a When b Then c" },
  ],
  scope: { in: ["x"], out: [] },
  verification: { commands: [], test_cases: [] },
};

function planJson(files: Array<{ path: string; action: string }>): string {
  return `${JSON.stringify(
    {
      schema_version: "1.0",
      work_item_id: ID,
      spec: `${BASE}/spec.json`,
      tasks: [
        {
          id: 1,
          title: "t1",
          covers_ac: ["AC-1"],
          challenge: false,
          files,
          steps: [{ tag: "impl", description: "d" }],
        },
      ],
    },
    null,
    2,
  )}\n`;
}

const cfg = (knowledge: boolean | { enabled: boolean; root?: string } | null): DevHarnessConfig =>
  ({
    schema_version: "1.0",
    language: "typescript",
    test: { command: "true", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
    stack: { enabled: true, contract: { lock: true, tag: true } },
    ...(knowledge === null
      ? {}
      : {
          knowledge:
            typeof knowledge === "boolean"
              ? { enabled: knowledge, root: "docs/features" }
              : knowledge,
        }),
  }) as unknown as DevHarnessConfig;

const specSchema = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "schemas", "spec-schema.json"), "utf8"),
);
const workItemSchema = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "schemas", "work-item-schema.json"), "utf8"),
);

let repo: string;
let originalCwd: string;
let nonGit: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}
function write(rel: string, content: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), content);
}
function seed(
  files: Array<{ path: string; action: string }>,
  opts: { index?: unknown; indexRel?: string | null; decisions?: unknown[] } = {},
): void {
  write(`${BASE}/brief.md`, "# Brief\nhello\n");
  write(`${BASE}/spec.json`, `${JSON.stringify(SPEC, null, 2)}\n`);
  write(`${BASE}/plan.json`, planJson(files));
  if (opts.indexRel !== null) {
    write(
      opts.indexRel ?? "docs/features/index.json",
      `${JSON.stringify(opts.index ?? INDEX, null, 2)}\n`,
    );
  }
  write(
    `.tasks/${ID}.json`,
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "planning",
      task_ids: [1],
      spec: `${BASE}/spec.json`,
      plan: `${BASE}/plan.json`,
      verify: null,
      brief: null,
      decisions: opts.decisions ?? [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  git("add", ".");
  git("commit", "-q", "-m", "seed");
}
const readSpec = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(repo, BASE, "spec.json"), "utf8"));
const readDecisions = (): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(join(repo, ".tasks", `${ID}.json`), "utf8")).decisions;

beforeEach(() => {
  originalCwd = process.cwd();
  nonGit = realpathSync(mkdtempSync(join(tmpdir(), "feature-impact-nogit-")));
  process.chdir(nonGit);
  repo = realpathSync(mkdtempSync(join(tmpdir(), "feature-impact-")));
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("README.md", "# r\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});
afterEach(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
  rmSync(nonGit, { recursive: true, force: true });
});

describe("ASDLC-1/AC-19 PR0 impact analysis", () => {
  it("ASDLC-1/AC-19 knowledge enabled writes features[] and an Impacted features table before the lock", async () => {
    seed([{ path: "src/auth/refresh.ts", action: "modify" }]);
    const result = await buildContractPr0(ID, cfg(true), repo);
    expect(result.ok).toBe(true);
    const features = readSpec().features as Array<{
      slug: string;
      relation: string;
      delta: string;
    }>;
    expect(Array.isArray(features)).toBe(true);
    const bySlug = (slug: string) => features.find((feature) => feature.slug === slug);
    expect(bySlug("auth-refresh")?.relation).toBe("modifies");
    expect(bySlug("session-store")?.relation).toBe("depends_on");
    expect(bySlug("crypto-core")?.relation).toBe("depends_on");
    expect(bySlug("audit-log")).toBeDefined();
    expect(bySlug("billing")).toBeUndefined();
    for (const feature of features) {
      expect(RELATIONS).toContain(feature.relation);
      expect(typeof feature.delta).toBe("string");
      expect(feature.delta.length).toBeGreaterThan(0);
    }
    // F-009: written spec.json conforms to spec-schema.json
    const ajv = new Ajv({ allErrors: true, strict: false });
    const valid = ajv.validate(specSchema, readSpec());
    expect(valid ? [] : ajv.errors).toEqual([]);
    expect(features.map((feature) => feature.slug).sort()).toEqual(
      [...new Set(features.map((feature) => feature.slug))].sort(),
    );

    const markdown = readFileSync(join(repo, BASE, "spec.md"), "utf8");
    expect(markdown).toContain("Impacted features");
    const row = markdown
      .split("\n")
      .find((line) => line.includes("auth-refresh") && line.includes("|"));
    expect(row).toContain("modifies");
    const dependsRow = markdown
      .split("\n")
      .find((line) => line.includes("session-store") && line.includes("|"));
    expect(dependsRow).toContain("depends_on");

    // F-006: the table is committed in PR0 and the tree is clean
    const committedMd = git("show", `HEAD:${BASE}/spec.md`);
    expect(committedMd).toContain("Impacted features");
    const committedRow = committedMd
      .split("\n")
      .find((line) => line.includes("auth-refresh") && line.includes("|"));
    expect(committedRow).toContain("modifies");
    expect(git("status", "--porcelain", "--untracked-files=all")).toBe("");

    // F-012: table is rendered from spec.json features[]; a later sync keeps it
    expect(syncSpecMarkdownFromJson(join(repo, BASE, "spec.json")).ok).toBe(true);
    const resynced = readFileSync(join(repo, BASE, "spec.md"), "utf8");
    expect(resynced).toContain("Impacted features");
    const resyncedRow = resynced
      .split("\n")
      .find((line) => line.includes("auth-refresh") && line.includes("|"));
    expect(resyncedRow).toContain("modifies");
  });

  it("ASDLC-1/AC-19 spec.json committed in PR0 carries features[] and the lock hashes it (unchanged right after)", async () => {
    seed([{ path: "src/auth/refresh.ts", action: "modify" }]);
    await buildContractPr0(ID, cfg(true), repo);
    const committed = JSON.parse(git("show", `HEAD:${BASE}/spec.json`));
    expect(committed.features).toEqual(readSpec().features);
    expect(committed.features.length).toBeGreaterThan(0);
    const lock = JSON.parse(readFileSync(join(repo, BASE, "contract.lock.json"), "utf8"));
    expect(Object.keys(lock.files)).toContain(`${BASE}/spec.json`);
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
  });

  it("ASDLC-1/AC-19 an overlap and a contradiction each become a pending decisions[] entry", async () => {
    seed([
      { path: "src/shared/util.ts", action: "modify" },
      { path: "src/auth/login.ts", action: "modify" },
    ]);
    const result = await buildContractPr0(ID, cfg(true), repo);
    expect(result.ok).toBe(true);
    const decisions = readDecisions();
    expect(decisions).toHaveLength(2);
    // F-001: decisions are valid work-item decisions
    const ajv = new Ajv({ allErrors: true, strict: false });
    const valid = ajv.validate(workItemSchema.properties.decisions, decisions);
    expect(valid ? [] : ajv.errors).toEqual([]);
    for (const decision of decisions) {
      expect(decision.status).toBe("pending");
      expect(decision.source).toBe("plan");
      expect(typeof decision.question).toBe("string");
      expect(typeof decision.asked_at).toBe("string");
      expect(Number.isNaN(Date.parse(decision.asked_at as string))).toBe(false);
      expect(typeof decision.phase).toBe("string");
      expect((decision.phase as string).length).toBeGreaterThan(0);
      expect(typeof decision.context).toBe("string");
      expect("kind" in decision).toBe(false);
    }
    // F-007: committed PR0 state snapshot carries the same decisions
    const committedState = JSON.parse(git("show", `HEAD:${BASE}/state/work-item.json`));
    expect(committedState.decisions).toHaveLength(2);
    expect(committedState.decisions.map((d: { id: string }) => d.id).sort()).toEqual(
      decisions.map((d) => d.id as string).sort(),
    );
    const text = (decision: Record<string, unknown>) => `${decision.question} ${decision.context}`;
    expect(
      decisions.filter((d) => text(d).includes("reports") && text(d).includes("exports")),
    ).toHaveLength(1);
    expect(decisions.filter((d) => text(d).includes("legacy-login"))).toHaveLength(1);
    expect(new Set(decisions.map((d) => d.id)).size).toBe(2);
  });

  it("ASDLC-1/AC-19 knowledge disabled writes no features[], no table and no decisions", async () => {
    seed([
      { path: "src/auth/refresh.ts", action: "modify" },
      { path: "src/shared/util.ts", action: "modify" },
    ]);
    const before = readFileSync(join(repo, BASE, "spec.json"), "utf8");
    const result = await buildContractPr0(ID, cfg(false), repo);
    expect(result.ok).toBe(true);
    expect(readFileSync(join(repo, BASE, "spec.json"), "utf8")).toBe(before);
    expect("features" in readSpec()).toBe(false);
    const specMd = join(repo, BASE, "spec.md");
    if (existsSync(specMd)) expect(readFileSync(specMd, "utf8")).not.toContain("Impacted features");
    expect(readDecisions()).toEqual([]);
  });

  it("ASDLC-1/AC-19 knowledge enabled with no intersecting features adds no decisions and no table rows", async () => {
    seed([{ path: "src/unrelated/new.ts", action: "add" }]);
    const result = await buildContractPr0(ID, cfg(true), repo);
    expect(result.ok).toBe(true);
    expect(readDecisions()).toEqual([]);
    const features = (readSpec().features ?? []) as unknown[];
    expect(features).toEqual([]);
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
  });
});

describe("ASDLC-1/AC-19 PR0 knowledge config and index resolution", () => {
  it("ASDLC-1/AC-19 no knowledge key: spec.json byte-identical, no features, no decisions (index present)", async () => {
    seed([{ path: "src/auth/refresh.ts", action: "modify" }]);
    const before = readFileSync(join(repo, BASE, "spec.json"), "utf8");
    const result = await buildContractPr0(ID, cfg(null), repo);
    expect(result.ok).toBe(true);
    expect(readFileSync(join(repo, BASE, "spec.json"), "utf8")).toBe(before);
    expect("features" in readSpec()).toBe(false);
    expect(readDecisions()).toEqual([]);
  });

  it("ASDLC-1/AC-19 enabled but index.json missing: ok, no features, no decisions, lock unchanged", async () => {
    seed([{ path: "src/auth/refresh.ts", action: "modify" }], { indexRel: null });
    const result = await buildContractPr0(ID, cfg({ enabled: true, root: "docs/features" }), repo);
    expect(result.ok).toBe(true);
    expect((readSpec().features ?? []) as unknown[]).toEqual([]);
    expect(readDecisions()).toEqual([]);
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
  });

  it("ASDLC-1/AC-19 enabled with knowledge.root kb/features reads the index there", async () => {
    seed([{ path: "src/auth/refresh.ts", action: "modify" }], {
      indexRel: "kb/features/index.json",
    });
    const result = await buildContractPr0(ID, cfg({ enabled: true, root: "kb/features" }), repo);
    expect(result.ok).toBe(true);
    const features = readSpec().features as Array<{ slug: string; relation: string }>;
    expect(features.find((f) => f.slug === "auth-refresh")?.relation).toBe("modifies");
  });
});

describe("ASDLC-1/AC-19 PR0 decisions write semantics", () => {
  const existing = {
    id: "plan-q-1",
    question: "pre-existing question",
    context: "ctx",
    source: "plan",
    phase: "planning",
    status: "pending",
    asked_at: "2026-01-01T00:00:00.000Z",
  };
  const overlapFiles = [
    { path: "src/shared/util.ts", action: "modify" },
    { path: "src/auth/login.ts", action: "modify" },
  ];

  it("ASDLC-1/AC-19 pre-existing decisions are preserved (appended, not replaced)", async () => {
    seed(overlapFiles, { decisions: [existing] });
    const result = await buildContractPr0(ID, cfg(true), repo);
    expect(result.ok).toBe(true);
    const decisions = readDecisions();
    expect(decisions).toHaveLength(3);
    expect(decisions.find((d) => d.id === "plan-q-1")).toEqual(existing);
  });

  it("ASDLC-1/AC-19 retry after a failed PR0 commit does not duplicate decisions", async () => {
    seed(overlapFiles);
    const hookPath = join(repo, ".git", "hooks", "pre-commit");
    mkdirSync(dirname(hookPath), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const failed = await buildContractPr0(ID, cfg(true), repo);
    expect(failed.ok).toBe(false);
    rmSync(hookPath, { force: true });
    const retried = await buildContractPr0(ID, cfg(true), repo);
    expect(retried.ok).toBe(true);
    const decisions = readDecisions();
    expect(decisions).toHaveLength(2);
    expect(new Set(decisions.map((d) => d.id)).size).toBe(2);
    expect((await verifyContractLock(ID, repo)).unchanged).toBe(true);
  });
});

describe("ASDLC-1/AC-30 spec schema features[] alignment", () => {
  const schema = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "schemas", "spec-schema.json"), "utf8"),
  );
  const check = (features: unknown): boolean => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    return ajv.validate(schema, { ...SPEC, features }) as boolean;
  };

  it("ASDLC-1/AC-30 spec without features[] stays valid (optional)", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    expect(ajv.validate(schema, SPEC)).toBe(true);
  });

  it.each(RELATIONS)("ASDLC-1/AC-30 accepts features[] relation %s", (relation) => {
    expect(check([{ slug: "auth-refresh", relation, delta: "adds refresh" }])).toBe(true);
  });

  it.each([
    ["unknown relation", [{ slug: "a", relation: "owns", delta: "x" }]],
    ["missing slug", [{ relation: "new", delta: "x" }]],
    ["missing relation", [{ slug: "a", delta: "x" }]],
    ["missing delta", [{ slug: "a", relation: "new" }]],
    ["empty slug", [{ slug: "", relation: "new", delta: "x" }]],
    ["extra key", [{ slug: "a", relation: "new", delta: "x", extra: 1 }]],
    ["non-string delta", [{ slug: "a", relation: "new", delta: 1 }]],
    ["object delta", [{ slug: "a", relation: "new", delta: {} }]],
    ["non-string slug", [{ slug: 1, relation: "new", delta: "x" }]],
    ["not an array", { slug: "a", relation: "new", delta: "x" }],
  ])("ASDLC-1/AC-30 rejects features[] with %s", (_name, features) => {
    expect(check(features)).toBe(false);
  });
});
