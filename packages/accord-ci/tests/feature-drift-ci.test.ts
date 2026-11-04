import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildImplementSpawnTaskBrief } from "@clive.shirley/accord-core/briefing/task-requirements.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import { writeTaskFixture } from "../../accord-core/tests/helpers/task-fixture.js";
import { createFeatureDriftRule } from "../src/checks/feature-drift.js";
import { evidenceRules, runEvidenceCheck } from "../src/evidence-check.js";

const ANCHOR = "src/widget/render.ts";
const OTHER_ANCHOR = "src/gadget/run.ts";
const DOC_REL = "docs/features/widget.md";
const OTHER_DOC_REL = "docs/features/gadget.md";
const AC_TEXT = "Widget renders exactly three columns";

function featureDoc(slug: string, anchor: string, acText: string, extra = ""): string {
  return `---
id: ${slug}
type: feature
title: ${slug} feature
description: ${slug} capability
tags: []
status: active
owners: []
acs:
  - id: ${slug}-AC-1
    text: ${acText}
    tests: []
anchors:
  code:
    - ${anchor}
  interfaces: []
depends_on: []
related: []
supersedes: []
changes: []
${extra}---

# ${slug}
`;
}

function cfg(knowledge: Record<string, unknown> | undefined): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: ["bun test"],
    ...(knowledge ? { knowledge } : {}),
  } as DevHarnessConfig;
}

// ---------------------------------------------------------------------------
// CI drift rule
// ---------------------------------------------------------------------------
describe("ASDLC-1/AC-22 CI feature-drift rule", () => {
  let repo: string;
  const sh = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
  const write = (rel: string, content: string): void => {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  const commit = (message: string): string => {
    sh("add", "-A");
    sh("commit", "-q", "-m", message);
    return sh("rev-parse", "HEAD");
  };
  const run = async (
    base: string,
    config: DevHarnessConfig | null,
    warn: (line: string) => void = () => {},
  ) =>
    runEvidenceCheck([createFeatureDriftRule(repo, { config, warn })], {
      base,
      head: sh("rev-parse", "HEAD"),
    });
  const agentsMd = (knowledge: Record<string, unknown> | undefined): string =>
    `# Repo\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(
      {
        schema_version: "1.0",
        language: "typescript",
        test: { command: "bun test", file_pattern: "**/*.test.ts" },
        verification_commands: ["bun test"],
        ...(knowledge ? { knowledge } : {}),
      },
      null,
      2,
    )}\n\`\`\`\n`;

  /** main has code + two feature docs; leaves HEAD on branch `pr`. */
  function mainWithFeatures(): string {
    write(ANCHOR, "export const a = 1;\n");
    write(OTHER_ANCHOR, "export const g = 1;\n");
    write("src/unanchored.ts", "export const u = 1;\n");
    write(DOC_REL, featureDoc("widget", ANCHOR, AC_TEXT));
    write(OTHER_DOC_REL, featureDoc("gadget", OTHER_ANCHOR, "Gadget runs"));
    const main = commit("init");
    sh("checkout", "-q", "-b", "pr");
    return main;
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "feature-drift-ci-"));
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "t@example.com");
    sh("config", "user.name", "t");
    sh("config", "commit.gpgsign", "false");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("ASDLC-1/AC-22 rule is named feature-drift and registered in evidenceRules()", () => {
    expect(createFeatureDriftRule(repo, { config: cfg({ enabled: true }) }).name).toBe(
      "feature-drift",
    );
    expect(evidenceRules().map((rule) => rule.name)).toContain("feature-drift");
  });

  test("ASDLC-1/AC-22 block: non-harness PR touching an anchored file without doc change fails naming feature and file", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    commit("manual edit of anchored file");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.exitCode).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rule).toBe("feature-drift");
    expect(result.failures[0]?.message).toContain("widget");
    expect(result.failures[0]?.message).toContain(ANCHOR);
    expect(result.failures[0]?.message).not.toContain("gadget");
  });

  test("ASDLC-1/AC-22 block: passes when the PR also changes the owning feature doc", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    write(DOC_REL, featureDoc("widget", ANCHOR, `${AC_TEXT} (updated)`));
    commit("edit anchored file and doc");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.failures).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  test("ASDLC-1/AC-22 block: changing a different feature's doc does not satisfy the drift", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    write(OTHER_DOC_REL, featureDoc("gadget", OTHER_ANCHOR, "Gadget runs (updated)"));
    commit("edit anchored file and wrong doc");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain("widget");
  });

  test("ASDLC-1/AC-22 block: passes with a no-change declaration naming the feature", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    sh("add", "-A");
    sh("commit", "-q", "-m", "refactor render\n\nFeature-Unchanged: widget");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.failures).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  test("ASDLC-1/AC-22 block: a no-change declaration for another feature does not cover widget", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    sh("add", "-A");
    sh("commit", "-q", "-m", "refactor render\n\nFeature-Unchanged: gadget");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain("widget");
  });

  test("ASDLC-1/AC-22 block: PR touching no anchored file passes", async () => {
    const main = mainWithFeatures();
    write("src/unanchored.ts", "export const u = 2;\n");
    commit("unrelated change");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.failures).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  test("ASDLC-1/AC-22 block: two drifting features are both reported", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    write(OTHER_ANCHOR, "export const g = 2;\n");
    commit("edit both anchors");
    const result = await run(main, cfg({ enabled: true, drift_check: "block" }));
    expect(result.exitCode).toBe(1);
    const text = result.failures.map((failure) => failure.message).join("\n");
    expect(text).toContain("widget");
    expect(text).toContain("gadget");
  });

  const SILENT_MODES: Array<[string, Record<string, unknown> | undefined]> = [
    ["knowledge disabled (enabled false)", { enabled: false, drift_check: "block" }],
    ["knowledge key absent", undefined],
    ["knowledge.enabled unset", { drift_check: "block" }],
    ["drift_check off", { enabled: true, drift_check: "off" }],
  ];
  for (const [label, knowledge] of SILENT_MODES) {
    test(`ASDLC-1/AC-22 passes silently on drifting anchored edit with ${label}`, async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      commit("manual edit of anchored file");
      const reports: string[] = [];
      const result = await run(main, cfg(knowledge), (line) => reports.push(line));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
      expect(reports).toEqual([]);
    });
  }

  const WARN_MODES: Array<[string, Record<string, unknown>]> = [
    ["drift_check warn", { enabled: true, drift_check: "warn" }],
    ["drift_check defaulted (warn)", { enabled: true }],
  ];
  for (const [label, knowledge] of WARN_MODES) {
    test(`ASDLC-1/AC-22 ${label}: passes but reports the drift naming feature and file`, async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      commit("manual edit of anchored file");
      const reports: string[] = [];
      const result = await run(main, cfg(knowledge), (line) => reports.push(line));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain("widget");
      expect(reports[0]).toContain(ANCHOR);
      expect(reports[0]).not.toContain("gadget");
    });
  }

  test("ASDLC-1/AC-22 warn mode with doc change reports nothing", async () => {
    const main = mainWithFeatures();
    write(ANCHOR, "export const a = 2;\n");
    write(DOC_REL, featureDoc("widget", ANCHOR, `${AC_TEXT} (updated)`));
    commit("anchor and doc");
    const reports: string[] = [];
    const result = await run(main, cfg({ enabled: true, drift_check: "warn" }), (l) =>
      reports.push(l),
    );
    expect(result.exitCode).toBe(0);
    expect(reports).toEqual([]);
  });

  test("ASDLC-1/AC-22 honours knowledge.root for feature docs", async () => {
    write(ANCHOR, "export const a = 1;\n");
    write("kb/widget.md", featureDoc("widget", ANCHOR, AC_TEXT));
    const main = commit("init");
    sh("checkout", "-q", "-b", "pr");
    write(ANCHOR, "export const a = 2;\n");
    commit("edit anchor");
    const result = await run(main, cfg({ enabled: true, drift_check: "block", root: "kb" }));
    expect(result.exitCode).toBe(1);
    expect(result.failures[0]?.message).toContain("widget");
  });

  // ASDLC-1/AC-22 production wiring: rule loads knowledge config from the repo's AGENTS.md.
  describe("production wiring (config loaded from cwd AGENTS.md)", () => {
    let originalCwd: string;
    beforeEach(() => {
      originalCwd = process.cwd();
    });
    afterEach(() => process.chdir(originalCwd));

    function mainWithAgents(knowledge: Record<string, unknown> | undefined): string {
      write("AGENTS.md", agentsMd(knowledge));
      return mainWithFeatures();
    }

    test("ASDLC-1/AC-22 createFeatureDriftRule(cwd) without config option blocks using AGENTS.md block config", async () => {
      const main = mainWithAgents({ enabled: true, drift_check: "block" });
      write(ANCHOR, "export const a = 2;\n");
      commit("manual edit");
      const result = await runEvidenceCheck([createFeatureDriftRule(repo)], {
        base: main,
        head: sh("rev-parse", "HEAD"),
      });
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain("widget");
    });

    test("ASDLC-1/AC-22 evidenceRules() feature-drift rule blocks via process cwd AGENTS.md", async () => {
      const main = mainWithAgents({ enabled: true, drift_check: "block" });
      write(ANCHOR, "export const a = 2;\n");
      commit("manual edit");
      const head = sh("rev-parse", "HEAD");
      process.chdir(repo);
      const result = await runEvidenceCheck(
        evidenceRules().filter((rule) => rule.name === "feature-drift"),
        { base: main, head },
      );
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.rule).toBe("feature-drift");
      expect(result.failures[0]?.message).toContain("widget");
    });

    test("ASDLC-1/AC-22 AGENTS.md without a knowledge key passes (both entry points)", async () => {
      const main = mainWithAgents(undefined);
      write(ANCHOR, "export const a = 2;\n");
      commit("manual edit");
      const head = sh("rev-parse", "HEAD");
      const direct = await runEvidenceCheck([createFeatureDriftRule(repo)], { base: main, head });
      expect(direct.failures).toEqual([]);
      expect(direct.exitCode).toBe(0);
      process.chdir(repo);
      const viaRegistry = await runEvidenceCheck(
        evidenceRules().filter((rule) => rule.name === "feature-drift"),
        { base: main, head },
      );
      expect(viaRegistry.failures).toEqual([]);
      expect(viaRegistry.exitCode).toBe(0);
    });
  });

  // ASDLC-1/AC-22 commit-range semantics.
  describe("commit range", () => {
    const BLOCK = { enabled: true, drift_check: "block" };
    const DECL = "chore\n\nFeature-Unchanged: widget";

    test("ASDLC-1/AC-22 range: commit 1 edits anchor, commit 2 edits unanchored file -> fails", async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      commit("anchor");
      write("src/unanchored.ts", "export const u = 2;\n");
      commit("unanchored");
      const result = await run(main, cfg(BLOCK));
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain("widget");
    });

    test("ASDLC-1/AC-22 range: commit 1 edits anchor, commit 2 edits the doc -> passes", async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      commit("anchor");
      write(DOC_REL, featureDoc("widget", ANCHOR, `${AC_TEXT} (updated)`));
      commit("doc");
      const result = await run(main, cfg(BLOCK));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });

    test("ASDLC-1/AC-22 range: renaming an anchored file without doc change fails naming the old path", async () => {
      const main = mainWithFeatures();
      sh("mv", ANCHOR, "src/widget/draw.ts");
      commit("rename anchored file");
      const result = await run(main, cfg(BLOCK));
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain("widget");
      expect(result.failures[0]?.message).toContain(ANCHOR);
    });

    test("ASDLC-1/AC-22 range: declaration on a main commit before the branch point does not cover the PR", async () => {
      write(ANCHOR, "export const a = 1;\n");
      write(DOC_REL, featureDoc("widget", ANCHOR, AC_TEXT));
      commit("init");
      sh("commit", "-q", "--allow-empty", "-m", DECL);
      const main = sh("rev-parse", "HEAD");
      sh("checkout", "-q", "-b", "pr");
      write(ANCHOR, "export const a = 2;\n");
      commit("anchor without declaration");
      const result = await run(main, cfg(BLOCK));
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain("widget");
    });

    test("ASDLC-1/AC-22 range: declaration on an earlier PR commit covers a later anchor edit", async () => {
      const main = mainWithFeatures();
      write("src/unanchored.ts", "export const u = 2;\n");
      commit(DECL);
      write(ANCHOR, "export const a = 2;\n");
      commit("anchor");
      const result = await run(main, cfg(BLOCK));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });

    test("ASDLC-1/AC-22 range: diff is taken from the merge-base, not the base tip", async () => {
      const first = mainWithFeatures();
      void first;
      write("src/unanchored.ts", "export const u = 2;\n");
      commit("pr change");
      sh("checkout", "-q", "main");
      write(ANCHOR, "export const a = 3;\n");
      commit(DECL);
      const mainTip = sh("rev-parse", "HEAD");
      sh("checkout", "-q", "pr");
      const result = await run(mainTip, cfg(BLOCK));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });
  });

  // ASDLC-1/AC-22 doc-to-feature mapping.
  describe("feature doc location", () => {
    const BLOCK = { enabled: true, drift_check: "block" };

    test("ASDLC-1/AC-22 doc in a nested path with a different file name satisfies the drift", async () => {
      write(ANCHOR, "export const a = 1;\n");
      write("docs/features/ui/widget-spec.md", featureDoc("widget", ANCHOR, AC_TEXT));
      const main = commit("init");
      sh("checkout", "-q", "-b", "pr");
      write(ANCHOR, "export const a = 2;\n");
      write("docs/features/ui/widget-spec.md", featureDoc("widget", ANCHOR, `${AC_TEXT} (u)`));
      commit("anchor and doc");
      const result = await run(main, cfg(BLOCK));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });

    test("ASDLC-1/AC-22 custom root: editing doc under knowledge.root satisfies the drift", async () => {
      write(ANCHOR, "export const a = 1;\n");
      write("kb/widget.md", featureDoc("widget", ANCHOR, AC_TEXT));
      const main = commit("init");
      sh("checkout", "-q", "-b", "pr");
      write(ANCHOR, "export const a = 2;\n");
      write("kb/widget.md", featureDoc("widget", ANCHOR, `${AC_TEXT} (u)`));
      commit("anchor and doc");
      const result = await run(main, cfg({ ...BLOCK, root: "kb" }));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });
  });

  // ASDLC-1/AC-22 declaration parsing.
  describe("no-change declaration parsing", () => {
    const BLOCK = { enabled: true, drift_check: "block" };

    test("ASDLC-1/AC-22 declaration for widget-v2 does not cover widget", async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      commit("refactor\n\nFeature-Unchanged: widget-v2");
      const result = await run(main, cfg(BLOCK));
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain("widget");
    });

    test("ASDLC-1/AC-22 id in subject plus declaration for gadget does not cover widget", async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      commit("refactor widget render\n\nFeature-Unchanged: gadget");
      const result = await run(main, cfg(BLOCK));
      expect(result.exitCode).toBe(1);
      expect(result.failures[0]?.message).toContain("widget");
    });

    test("ASDLC-1/AC-22 two declaration trailers cover two drifting features", async () => {
      const main = mainWithFeatures();
      write(ANCHOR, "export const a = 2;\n");
      write(OTHER_ANCHOR, "export const g = 2;\n");
      commit("refactor\n\nFeature-Unchanged: gadget\nFeature-Unchanged: widget");
      const result = await run(main, cfg(BLOCK));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });
  });

  // ASDLC-1/AC-22 fail closed on git errors.
  describe("git errors", () => {
    const BAD_BASE = "0000000000000000000000000000000000000000";

    test("ASDLC-1/AC-22 block mode: unresolvable base fails closed", async () => {
      mainWithFeatures();
      const result = await run(BAD_BASE, cfg({ enabled: true, drift_check: "block" }));
      expect(result.exitCode).toBe(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.rule).toBe("feature-drift");
      expect(result.failures[0]?.message).toContain("cannot resolve base");
    });

    test("ASDLC-1/AC-22 knowledge disabled: unresolvable base adds no failure", async () => {
      mainWithFeatures();
      const result = await run(BAD_BASE, cfg({ enabled: false }));
      expect(result.failures).toEqual([]);
      expect(result.exitCode).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Review brief invariants
// ---------------------------------------------------------------------------
describe("ASDLC-1/AC-22 review brief carries impacted feature docs as invariants", () => {
  let tempCwd: string;
  let originalCwd: string;

  function seed(): void {
    mkdirSync(".tasks", { recursive: true });
    mkdirSync(join("docs", "dev", "FK-1"), { recursive: true });
    mkdirSync(join("docs", "features"), { recursive: true });
    writeFileSync(join("docs/features/widget.md"), featureDoc("widget", ANCHOR, AC_TEXT), "utf8");
    writeFileSync(
      join("docs/features/gadget.md"),
      featureDoc("gadget", OTHER_ANCHOR, "Gadget runs in a loop"),
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "FK-1", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "does thing" },
        ],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "does thing", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "FK-1", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [
              { path: ANCHOR, action: "modify" },
              { path: "src/a.test.ts", action: "add" },
            ],
            steps: [{ tag: "test", description: "red" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join(".tasks", "FK-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        id: "FK-1",
        title: "t",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
        pattern: "implement",
        variant: "standard",
        phase: "implementing",
        spec: "docs/dev/FK-1/spec.json",
        plan: "docs/dev/FK-1/plan.json",
        verify: null,
        brief: null,
        task_ids: [1],
        decisions: [],
        deviations: [],
        cost_usd: 0,
      })}\n`,
      "utf8",
    );
    writeTaskFixture({
      workItemId: "FK-1",
      taskId: 1,
      ownerNonce: "aabbcc",
      phase: "review-code",
      coversAc: ["AC-1"],
      acText: { "AC-1": "does thing" },
      testFiles: ["src/a.test.ts"],
    });
  }

  function brief(agent: string, config: DevHarnessConfig): string {
    const result = buildImplementSpawnTaskBrief({
      workItemId: "FK-1",
      dispatchAgent: agent,
      phase: "implementing",
      title: "t",
      pattern: "implement",
      devConfig: config,
    });
    if (!result.ok) throw new Error(result.error);
    if (result.value === null) throw new Error("brief was null");
    return result.value;
  }

  beforeEach(() => {
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(join(tmpdir(), "feature-drift-brief-"));
    process.chdir(tempCwd);
    resetSpawnPreflightCheckForTests();
    seed();
  });
  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempCwd)) rmSync(tempCwd, { recursive: true, force: true });
  });

  for (const agent of ["review-code", "review-security", "review-test"]) {
    test(`ASDLC-1/AC-22 ${agent} brief has an Impacted features section with the impacted feature's ACs and a regression-is-a-finding instruction`, () => {
      const text = brief(agent, cfg({ enabled: true }));
      expect(text).toContain("Impacted features");
      expect(text).toMatch(/Impacted features[\s\S]*\bwidget\b[\s\S]*widget-AC-1/);
      expect(text).toContain("widget-AC-1");
      expect(text).toContain(AC_TEXT);
      expect(text).toMatch(/invariant/i);
      expect(text).toMatch(/regression[^\n]*finding/i);
      // Only impacted features: gadget's anchors are not in the task files.
      expect(text).not.toContain("Gadget runs in a loop");
    });
  }

  for (const agent of ["review-code", "review-security", "review-test"]) {
    test(`ASDLC-1/AC-22 ${agent} brief adds nothing when knowledge is disabled or unset`, () => {
      for (const config of [cfg({ enabled: false }), cfg(undefined)]) {
        const text = brief(agent, config);
        expect(text).not.toContain("Impacted features");
        expect(text).not.toContain(AC_TEXT);
        expect(text).not.toContain("widget-AC-1");
      }
    });
  }

  test("ASDLC-1/AC-22 non-review agents (phase-code) do not get the invariants section", () => {
    const text = brief("phase-code", cfg({ enabled: true }));
    expect(text).not.toContain("Impacted features");
    expect(text).not.toContain(AC_TEXT);
  });

  test("ASDLC-1/AC-22 knowledge enabled but no feature anchored by task files adds nothing", () => {
    writeFileSync(
      join("docs/features/widget.md"),
      featureDoc("widget", "src/elsewhere.ts", AC_TEXT),
      "utf8",
    );
    const text = brief("review-code", cfg({ enabled: true }));
    expect(text).not.toContain("Impacted features");
    expect(text).not.toContain(AC_TEXT);
  });

  test("ASDLC-1/AC-22 brief honours knowledge.root", () => {
    rmSync("docs/features/widget.md");
    mkdirSync("kb", { recursive: true });
    writeFileSync("kb/widget.md", featureDoc("widget", ANCHOR, AC_TEXT), "utf8");
    const text = brief("review-code", cfg({ enabled: true, root: "kb" }));
    expect(text).toContain("widget-AC-1");
    expect(text).toContain(AC_TEXT);
  });

  test("ASDLC-1/AC-22 brief lists every AC of the impacted feature", () => {
    writeFileSync(
      "docs/features/widget.md",
      featureDoc("widget", ANCHOR, AC_TEXT).replace(
        "anchors:",
        "  - id: widget-AC-2\n    text: Widget header is sticky\n    tests: []\nanchors:",
      ),
      "utf8",
    );
    const text = brief("review-code", cfg({ enabled: true }));
    for (const needle of ["widget-AC-1", AC_TEXT, "widget-AC-2", "Widget header is sticky"]) {
      expect(text).toContain(needle);
    }
  });

  test("ASDLC-1/AC-22 brief lists every impacted feature when task files anchor several", () => {
    const planPath = join("docs", "dev", "FK-1", "plan.json");
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    plan.tasks[0].files.push({ path: OTHER_ANCHOR, action: "modify" });
    writeFileSync(planPath, `${JSON.stringify(plan)}\n`, "utf8");
    const text = brief("review-code", cfg({ enabled: true }));
    expect(text).toContain(AC_TEXT);
    expect(text).toContain("Gadget runs in a loop");
  });
});
