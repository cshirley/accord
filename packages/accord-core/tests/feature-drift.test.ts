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
import { getCloseoutBranchHook, registerCloseoutBranchHook } from "../src/commit/hooks.js";
import { resolveKnowledgeConfig } from "../src/config/stack-flags.js";
import type { DevHarnessConfig } from "../src/config/types.js";
import { writeContractLock } from "../src/contract/lock.js";
import { runKnowledgeCloseoutUpdate } from "../src/knowledge/closeout-update.js";
import { checkDrift } from "../src/knowledge/drift.js";
import { loadFeatureDocs, validateFeatures } from "../src/knowledge/feature-doc.js";
import { commitWorkItemArtifacts } from "../src/orchestration/commit-on-task-done.js";

const ID = "DRIFT-1";
const BILLING = "docs/features/billing.md";
const AUDIT = "docs/features/audit.md";
const SCENARIO_1 = "Given a charge When it is made Then the ledger records it";

let originalCwd: string;
let repo: string;
let savedCloseoutHook: ReturnType<typeof getCloseoutBranchHook>;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}
function write(file: string, content: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
}
const cfg = (knowledge: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test" },
    knowledge,
    ...extra,
  }) as unknown as DevHarnessConfig;

function featureDoc(slug: string, anchor: string, acs = "acs: []"): string {
  return `---\nid: ${slug}\ntype: feature\ntitle: ${slug}\ndescription: ${slug} feature\ntags: []\nstatus: active\nowners: []\n${acs}\nanchors:\n  code:\n    - ${anchor}\n  interfaces: []\ndepends_on: []\nrelated: []\nsupersedes: []\nchanges: []\n---\n# ${slug}\n`;
}

beforeEach(() => {
  // Other test files import src/stack/branches.ts, which registers a global closeout-branch hook
  // that refuses closeout in this temp repo; isolate from it and restore afterwards.
  savedCloseoutHook = getCloseoutBranchHook();
  registerCloseoutBranchHook(undefined);
  originalCwd = process.cwd();
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-drift-")));
  process.chdir(repo);
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".tasks/\n");
  write("src/billing/charge.ts", "export const charge = 1;\n");
  write("src/audit/log.ts", "export const log = 1;\n");
  write("src/unanchored.ts", "export const u = 1;\n");
  write(
    "tests/charge.test.ts",
    'it("DRIFT-1/AC-1 charge recorded", () => {});\nit("DRIFT-1/AC-10 other thing", () => {});\nit("DRIFT-1/AC-2 refund", () => {});\nit("DRIFT-1/AC-4 idempotent", () => {});\nit("OTHER-1/AC-1 foreign", () => {});\nit("XDRIFT-1/AC-1 lookalike", () => {});\n',
  );
  write(BILLING, featureDoc("billing", "src/billing/charge.ts"));
  write(AUDIT, featureDoc("audit", "src/audit/log.ts"));
  mkdirSync(".tasks", { recursive: true });
  write(
    `.tasks/${ID}.json`,
    JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Drift fixture",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: `docs/dev/${ID}/spec.json`,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  write(`docs/dev/${ID}/brief.md`, "# brief\n");
  write(
    `docs/dev/${ID}/spec.json`,
    JSON.stringify({
      work_item_id: ID,
      acceptance_criteria: [
        {
          id: "AC-1",
          requirement: "MUST",
          type: "scenario",
          scenario: SCENARIO_1,
          feature: "billing",
        },
        {
          id: "AC-2",
          requirement: "MUST",
          type: "scenario",
          scenario: "Given a refund When issued Then credit",
          feature: "billing",
        },
        { id: "AC-3", requirement: "MUST", type: "scenario", scenario: "No feature slug here" },
        {
          id: "AC-4",
          requirement: "MUST",
          type: "constraint",
          criterion: "Charges are idempotent per key",
          feature: "billing",
        },
      ],
    }),
  );
  write(
    `docs/dev/${ID}/plan.json`,
    JSON.stringify({
      tasks: [
        {
          id: 1,
          title: "charge",
          files: [
            { path: "src/billing/charge.ts", action: "modify" },
            { path: "tests/charge.test.ts", action: "add" },
            { path: "src/unanchored.ts", action: "modify" },
          ],
        },
      ],
    }),
  );
  git("add", ".");
  git("commit", "-q", "-m", "base");
});

afterEach(() => {
  registerCloseoutBranchHook(savedCloseoutHook);
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

async function lockCommit(): Promise<string> {
  await writeContractLock(ID, repo);
  git("add", ".");
  git("commit", "-q", "-m", "contract");
  return git("rev-parse", "HEAD").trim();
}

type Change = Record<string, unknown>;
function billing() {
  const doc = loadFeatureDocs(repo).find((d) => d.id === "billing");
  if (!doc) throw new Error("billing doc missing");
  return doc;
}

describe("ASDLC-1/AC-20 runKnowledgeCloseoutUpdate", () => {
  it("ASDLC-1/AC-20 appends changes[] entry linking work item, PR, evidence and contract sha", async () => {
    const sha = await lockCommit();
    const result = await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, {
      pr: "https://github.com/o/r/pull/7",
    });
    expect(result.ok).toBe(true);
    expect(result.paths).toContain(BILLING);
    const changes = billing().changes as Change[];
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      work_item: ID,
      pr: "https://github.com/o/r/pull/7",
      contract_sha: sha,
    });
    expect(changes[0]?.evidence).toMatch(new RegExp(`^docs/dev/${ID}/evidence/`));
  });

  it("ASDLC-1/AC-20 applies AC delta and records <ID>/AC-<n> to feature AC id mapping", async () => {
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const doc = billing();
    expect(doc.acs).toHaveLength(3);
    const map = (doc.changes[0] as { ac_map: Record<string, string> }).ac_map;
    expect(Object.keys(map).sort()).toEqual([`${ID}/AC-1`, `${ID}/AC-2`, `${ID}/AC-4`]);
    expect(map[`${ID}/AC-1`]).not.toBe(map[`${ID}/AC-2`]);
    const ac4 = doc.acs.find((a) => a.id === map[`${ID}/AC-4`]);
    expect(ac4?.text).toContain("Charges are idempotent per key");
    const ac1 = doc.acs.find((a) => a.id === map[`${ID}/AC-1`]);
    const ac2 = doc.acs.find((a) => a.id === map[`${ID}/AC-2`]);
    expect(ac1?.text).toContain(SCENARIO_1);
    expect(ac1?.text).not.toContain('"requirement"');
    expect(ac2?.text).toContain("refund");
  });

  it("ASDLC-1/AC-20 acs[].tests lists only tests carrying the exact qualified id (AC-1 is not AC-10)", async () => {
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const doc = billing();
    const map = (doc.changes[0] as { ac_map: Record<string, string> }).ac_map;
    const ac1 = doc.acs.find((a) => a.id === map[`${ID}/AC-1`]);
    const ac2 = doc.acs.find((a) => a.id === map[`${ID}/AC-2`]);
    expect(ac1?.tests).toEqual([`tests/charge.test.ts#${ID}/AC-1 charge recorded`]);
    expect(ac2?.tests).toEqual([`tests/charge.test.ts#${ID}/AC-2 refund`]);
    expect(
      validateFeatures({ repoRoot: repo }).errors.filter(
        (e) => e.feature === "billing" && e.code === "unresolved-test",
      ),
    ).toEqual([]);
  });

  it("ASDLC-1/AC-20 touches only features anchored by changed files and skips ACs without a feature slug", async () => {
    await lockCommit();
    const before = readFileSync(join(repo, AUDIT), "utf8");
    const result = await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    expect(result.paths).toEqual([BILLING]);
    expect(readFileSync(join(repo, AUDIT), "utf8")).toBe(before);
    expect(JSON.stringify(billing().acs)).not.toContain("No feature slug here");
  });

  it("ASDLC-1/AC-20 is idempotent: a second run adds no duplicate changes[] entry or AC", async () => {
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const firstMap = (billing().changes[0] as { ac_map: Record<string, string> }).ac_map;
    write(
      "tests/charge.test.ts",
      `${readFileSync(join(repo, "tests/charge.test.ts"), "utf8")}it("${ID}/AC-1 second charge", () => {});\n`,
    );
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const doc = billing();
    expect(doc.changes).toHaveLength(1);
    expect(doc.acs).toHaveLength(3);
    const map = (doc.changes[0] as { ac_map: Record<string, string> }).ac_map;
    expect(map).toEqual(firstMap);
    const ac1 = doc.acs.find((a) => a.id === map[`${ID}/AC-1`]);
    expect(ac1?.tests).toEqual([
      `tests/charge.test.ts#${ID}/AC-1 charge recorded`,
      `tests/charge.test.ts#${ID}/AC-1 second charge`,
    ]);
  });

  it("ASDLC-1/AC-20 writes nothing when knowledge.enabled is false or absent", async () => {
    await lockCommit();
    const before = readFileSync(join(repo, BILLING), "utf8");
    for (const config of [cfg({ enabled: false }), null]) {
      const result = await runKnowledgeCloseoutUpdate(ID, config, repo, { pr: "7" });
      expect(result.paths).toEqual([]);
    }
    expect(readFileSync(join(repo, BILLING), "utf8")).toBe(before);
  });

  it("ASDLC-1/AC-20 honours a custom knowledge.root", async () => {
    await lockCommit();
    git("mv", "docs/features", "docs/kb");
    git("commit", "-q", "-am", "move");
    const result = await runKnowledgeCloseoutUpdate(
      ID,
      cfg({ enabled: true, root: "docs/kb" }),
      repo,
      { pr: "7" },
    );
    expect(result.paths).toEqual(["docs/kb/billing.md"]);
    expect(existsSync(join(repo, "docs/features"))).toBe(false);
    const kb = loadFeatureDocs(repo, "docs/kb").find((d) => d.id === "billing");
    expect(kb?.changes).toHaveLength(1);
    const kbEntry = kb?.changes[0] as Change | undefined;
    expect(kbEntry?.work_item).toBe(ID);
  });
});

describe("ASDLC-1/AC-20 commitWorkItemArtifacts closeout hook", () => {
  it("ASDLC-1/AC-20 closeout commit contains updated feature docs when knowledge.enabled (stack disabled)", async () => {
    const sha = await lockCommit();
    const result = await commitWorkItemArtifacts(ID, cfg({ enabled: true }), repo);
    expect(result.ok).toBe(true);
    expect(result.files).toContain(BILLING);
    const committed = git("show", "--name-only", "--pretty=format:", "HEAD").trim().split("\n");
    expect(committed).toContain(BILLING);
    expect(committed).not.toContain(AUDIT);
    expect(git("status", "--porcelain", "--", "docs/features").trim()).toBe("");
    const doc = loadFeatureDocs(repo).find((d) => d.id === "billing");
    const first = doc?.changes[0] as Change | undefined;
    expect(first).toMatchObject({ work_item: ID, contract_sha: sha });
    expect(first?.evidence).toMatch(new RegExp(`^docs/dev/${ID}/evidence/`));
  });

  it("ASDLC-1/AC-20 closeout commit leaves feature docs untouched when knowledge is disabled", async () => {
    await lockCommit();
    const result = await commitWorkItemArtifacts(ID, cfg({ enabled: false }), repo);
    expect(result.files ?? []).not.toContain(BILLING);
    expect(billing().changes).toEqual([]);
  });
});

describe("ASDLC-1/AC-20 checkDrift", () => {
  const changed = ["src/billing/charge.ts", "src/unanchored.ts"];
  const base = () => ({ repoRoot: repo, workItemId: ID, changedFiles: changed });

  it("ASDLC-1/AC-20 off passes and reports nothing even when the doc was not updated", () => {
    expect(checkDrift({ ...base(), severity: "off" })).toEqual({
      ok: true,
      severity: "off",
      findings: [],
    });
  });

  it("ASDLC-1/AC-20 warn reports the drifted feature but still passes", () => {
    const result = checkDrift({ ...base(), severity: "warn" });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([{ feature: "billing", files: ["src/billing/charge.ts"] }]);
  });

  it("ASDLC-1/AC-20 block fails with the same finding", () => {
    const result = checkDrift({ ...base(), severity: "block" });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("block");
    expect(result.findings).toEqual([{ feature: "billing", files: ["src/billing/charge.ts"] }]);
  });

  it("ASDLC-1/AC-20 block passes once closeout updated the doc, in every severity", async () => {
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    for (const severity of ["off", "warn", "block"] as const) {
      expect(checkDrift({ ...base(), severity })).toEqual({ ok: true, severity, findings: [] });
    }
  });

  it("ASDLC-1/AC-20 a changes[] entry for another work item does not count as updated", () => {
    write(
      BILLING,
      featureDoc("billing", "src/billing/charge.ts").replace(
        "changes: []",
        "changes:\n  - work_item: OTHER-9\n    pr: '1'",
      ),
    );
    expect(checkDrift({ ...base(), severity: "block" }).ok).toBe(false);
  });

  it("ASDLC-1/AC-20 block passes when the feature is declared unchanged, but only that feature", () => {
    expect(checkDrift({ ...base(), severity: "block", declaredUnchanged: ["billing"] })).toEqual({
      ok: true,
      severity: "block",
      findings: [],
    });
    const other = checkDrift({ ...base(), severity: "block", declaredUnchanged: ["audit"] });
    expect(other.ok).toBe(false);
  });

  it("ASDLC-1/AC-20 changes touching no anchored file produce no findings", () => {
    const result = checkDrift({
      ...base(),
      changedFiles: ["src/unanchored.ts"],
      severity: "block",
    });
    expect(result).toEqual({ ok: true, severity: "block", findings: [] });
  });

  it("ASDLC-1/AC-20 honours a custom features root", () => {
    git("mv", "docs/features", "docs/kb");
    expect(checkDrift({ ...base(), severity: "block", root: "docs/kb" }).findings).toHaveLength(1);
    expect(checkDrift({ ...base(), severity: "block" }).findings).toEqual([]);
  });
});

const headFiles = () => git("show", "--name-only", "--pretty=format:", "HEAD").trim().split("\n");

function docWith(slug: string, anchors: string[], changes: unknown[] = [], acs: unknown[] = []) {
  const fm = {
    id: slug,
    type: "feature",
    title: `${slug} title`,
    description: `${slug} feature`,
    tags: [],
    status: "active",
    owners: [],
    acs,
    anchors: { code: anchors, interfaces: [] },
    depends_on: [],
    related: [],
    supersedes: [],
    changes,
  };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n# ${slug}\n\nExisting prose\n`;
}

describe("ASDLC-1/AC-20 closeout preserves existing feature doc content", () => {
  it("ASDLC-1/AC-20 appends to seeded changes[]/acs[], keeps unique ids, frontmatter and body", async () => {
    const seededAcs = [
      { id: "AC-1", text: "Existing A", tests: ["tests/charge.test.ts#OTHER-1/AC-1 foreign"] },
      {
        id: "billing/AC-1",
        text: "Existing B",
        tests: ["tests/charge.test.ts#OTHER-1/AC-1 foreign"],
      },
    ];
    const seededChange = { work_item: "OTHER-9", pr: "1", ac_map: { "OTHER-9/AC-1": "AC-1" } };
    write(BILLING, docWith("billing", ["src/billing/charge.ts"], [seededChange], seededAcs));
    git("add", ".");
    git("commit", "-q", "-m", "seed");
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const doc = billing();
    expect(doc.changes).toHaveLength(2);
    expect(doc.changes[0]).toEqual(seededChange);
    const entry = doc.changes[1] as { work_item: string; ac_map: Record<string, string> };
    expect(entry.work_item).toBe(ID);
    expect(doc.acs).toHaveLength(5);
    expect(doc.acs[0]).toEqual(seededAcs[0]);
    expect(doc.acs[1]).toEqual(seededAcs[1]);
    expect(new Set(doc.acs.map((a) => a.id)).size).toBe(5);
    const mapped = Object.values(entry.ac_map);
    expect(mapped).toHaveLength(3);
    expect(mapped).not.toContain("AC-1");
    expect(mapped).not.toContain("billing/AC-1");
    expect(doc.anchors.code).toEqual(["src/billing/charge.ts"]);
    expect(doc.title).toBe("billing title");
    expect(doc.status).toBe("active");
    expect(doc.description).toBe("billing feature");
    expect(doc.body).toContain("Existing prose");
  });
});

describe("ASDLC-1/AC-20 closeout robustness", () => {
  it("ASDLC-1/AC-20 discovers tests written as test(), single-quoted and template literals in unlisted files", async () => {
    write(
      "tests/refund.test.ts",
      "test('DRIFT-1/AC-2 refund single', () => {});\nit(`DRIFT-1/AC-2 refund tpl`, () => {});\n",
    );
    git("add", ".");
    git("commit", "-q", "-m", "refund tests");
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const doc = billing();
    const map = (doc.changes[0] as { ac_map: Record<string, string> }).ac_map;
    const ac2 = doc.acs.find((a) => a.id === map[`${ID}/AC-2`]);
    expect([...(ac2?.tests ?? [])].sort()).toEqual(
      [
        `tests/charge.test.ts#${ID}/AC-2 refund`,
        `tests/refund.test.ts#${ID}/AC-2 refund single`,
        `tests/refund.test.ts#${ID}/AC-2 refund tpl`,
      ].sort(),
    );
    expect(
      validateFeatures({ repoRoot: repo }).errors.filter(
        (e) => e.feature === "billing" && e.code === "unresolved-test",
      ),
    ).toEqual([]);
  });

  it("ASDLC-1/AC-20 an entry for DRIFT-10 does not make closeout skip DRIFT-1", async () => {
    write(
      BILLING,
      docWith("billing", ["src/billing/charge.ts"], [{ work_item: "DRIFT-10", pr: "1" }]),
    );
    git("add", ".");
    git("commit", "-q", "-m", "seed");
    await lockCommit();
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const changes = billing().changes as Change[];
    expect(changes).toHaveLength(2);
    expect(changes[1]?.work_item).toBe(ID);
  });
});

describe("ASDLC-1/AC-20 anchors, not slugs, select features", () => {
  it("ASDLC-1/AC-20 an anchored feature with no slugged AC still gets an ID changes[] entry", async () => {
    write(
      `docs/dev/${ID}/plan.json`,
      JSON.stringify({
        tasks: [
          {
            id: 1,
            title: "charge",
            files: [
              { path: "src/billing/charge.ts", action: "modify" },
              { path: "src/audit/log.ts", action: "modify" },
            ],
          },
        ],
      }),
    );
    await lockCommit();
    const result = await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    expect([...result.paths].sort()).toEqual([AUDIT, BILLING]);
    const audit = loadFeatureDocs(repo).find((d) => d.id === "audit");
    expect(audit?.changes).toHaveLength(1);
    const entry = audit?.changes[0] as { work_item: string; ac_map?: Record<string, string> };
    expect(entry.work_item).toBe(ID);
    expect(audit?.acs).toEqual([]);
    expect(entry.ac_map ?? {}).toEqual({});
    expect(
      checkDrift({
        repoRoot: repo,
        workItemId: ID,
        changedFiles: ["src/billing/charge.ts", "src/audit/log.ts", "src/unanchored.ts"],
        severity: "block",
      }),
    ).toEqual({ ok: true, severity: "block", findings: [] });
  });
});

describe("ASDLC-1/AC-20 contract sha and missing lock", () => {
  it("ASDLC-1/AC-20 contract_sha is the lock commit, not HEAD", async () => {
    const lockSha = await lockCommit();
    write("src/billing/charge.ts", "export const charge = 2;\n");
    git("add", ".");
    git("commit", "-q", "-m", "task 1");
    await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    const sha = (billing().changes[0] as Change).contract_sha;
    expect(sha).toBe(lockSha);
    expect(sha).not.toBe(git("rev-parse", "HEAD").trim());
  });

  it("ASDLC-1/AC-20 closeout still updates docs when no contract lock exists (stack disabled)", async () => {
    const result = await runKnowledgeCloseoutUpdate(ID, cfg({ enabled: true }), repo, { pr: "7" });
    expect(result.ok).toBe(true);
    expect(result.paths).toEqual([BILLING]);
    const entry = billing().changes[0] as {
      work_item: string;
      contract_sha?: string | null;
      ac_map: Record<string, string>;
    };
    expect(entry.work_item).toBe(ID);
    expect(Object.keys(entry.ac_map).sort()).toEqual([`${ID}/AC-1`, `${ID}/AC-2`, `${ID}/AC-4`]);
    expect(entry.contract_sha ?? null).toBeNull();
  });

  it("ASDLC-1/AC-20 commitWorkItemArtifacts commits feature docs with no contract lock", async () => {
    const result = await commitWorkItemArtifacts(ID, cfg({ enabled: true }), repo);
    expect(result.ok).toBe(true);
    expect(headFiles()).toContain(BILLING);
  });
});

describe("ASDLC-1/AC-20 commitWorkItemArtifacts with stack.enabled", () => {
  it("ASDLC-1/AC-20 stack closeout commits the updated feature docs on a clean tree", async () => {
    await lockCommit();
    const result = await commitWorkItemArtifacts(
      ID,
      cfg({ enabled: true }, { stack: { enabled: true } }),
      repo,
    );
    expect(result.ok).toBe(true);
    expect(result.files).toContain(BILLING);
    expect(headFiles()).toContain(BILLING);
    expect(git("status", "--porcelain", "--", "docs/features").trim()).toBe("");
    expect((billing().changes[0] as Change).work_item).toBe(ID);
  });

  it("ASDLC-1/AC-20 refused stack closeout (dirty tree) writes no feature docs", async () => {
    await lockCommit();
    write("scratch.txt", "dirty\n");
    const result = await commitWorkItemArtifacts(
      ID,
      cfg({ enabled: true }, { stack: { enabled: true } }),
      repo,
    );
    expect(result.ok).toBe(false);
    expect(billing().changes).toEqual([]);
  });
});

describe("ASDLC-1/AC-20 closeout stages only the paths the hook wrote", () => {
  it("ASDLC-1/AC-20 an uncommitted edit to another feature doc is not swept into the closeout commit", async () => {
    await lockCommit();
    write(AUDIT, `${readFileSync(join(repo, AUDIT), "utf8")}\nLocal edit\n`);
    const result = await commitWorkItemArtifacts(ID, cfg({ enabled: true }), repo);
    expect(result.ok).toBe(true);
    expect(headFiles()).toContain(BILLING);
    expect(headFiles()).not.toContain(AUDIT);
    expect(git("status", "--porcelain", "--", AUDIT)).toContain("M");
  });

  it("ASDLC-1/AC-20 a custom knowledge.root is staged and committed", async () => {
    git("mv", "docs/features", "docs/kb");
    git("commit", "-q", "-am", "move");
    await lockCommit();
    const result = await commitWorkItemArtifacts(ID, cfg({ enabled: true, root: "docs/kb" }), repo);
    expect(result.ok).toBe(true);
    expect(headFiles()).toContain("docs/kb/billing.md");
    expect(git("status", "--porcelain", "--", "docs/kb").trim()).toBe("");
  });
});

describe("ASDLC-1/AC-20 checkDrift multi-feature and config", () => {
  it("ASDLC-1/AC-20 reports every drifted feature with only the changed anchored files", () => {
    write("src/billing/refund.ts", "export const refund = 1;\n");
    write(BILLING, docWith("billing", ["src/billing/charge.ts", "src/billing/refund.ts"]));
    const options = {
      repoRoot: repo,
      workItemId: ID,
      changedFiles: ["src/billing/charge.ts", "src/audit/log.ts", "src/unanchored.ts"],
      severity: "block" as const,
    };
    const all = checkDrift(options);
    expect(all.ok).toBe(false);
    expect(all.findings).toEqual([
      { feature: "audit", files: ["src/audit/log.ts"] },
      { feature: "billing", files: ["src/billing/charge.ts"] },
    ]);
    const partial = checkDrift({ ...options, declaredUnchanged: ["billing"] });
    expect(partial.ok).toBe(false);
    expect(partial.findings).toEqual([{ feature: "audit", files: ["src/audit/log.ts"] }]);
  });

  it("ASDLC-1/AC-20 an entry for DRIFT-10 does not count as an update for DRIFT-1", () => {
    write(
      BILLING,
      docWith("billing", ["src/billing/charge.ts"], [{ work_item: "DRIFT-10", pr: "1" }]),
    );
    const result = checkDrift({
      repoRoot: repo,
      workItemId: ID,
      changedFiles: ["src/billing/charge.ts"],
      severity: "block",
    });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ feature: "billing", files: ["src/billing/charge.ts"] }]);
  });

  it("ASDLC-1/AC-20 default knowledge.drift_check resolves to warn: reports but passes", () => {
    const severity = resolveKnowledgeConfig(cfg({ enabled: true })).drift_check;
    expect(severity).toBe("warn");
    const result = checkDrift({
      repoRoot: repo,
      workItemId: ID,
      changedFiles: ["src/billing/charge.ts"],
      severity,
    });
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("warn");
    expect(result.findings).toEqual([{ feature: "billing", files: ["src/billing/charge.ts"] }]);
  });
});
