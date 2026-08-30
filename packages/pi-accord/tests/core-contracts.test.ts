import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateArtifact } from "../src/core/artifacts/validation.js";
import { devQuickFixBrief } from "../src/core/briefing/code-brief.js";
import { classifyPreflight } from "../src/core/commands/classify-dispatch.js";
import {
  devDispatch,
  parseHarnessTagArgs,
  parseKnownDevSubcommandArgs,
} from "../src/core/commands/dispatch.js";
import {
  formatRefinementResult,
  recommendIntentMode,
  refineWithTicketSignals,
} from "../src/core/commands/intent.js";
import {
  assertSubcommandRoutingComplete,
  getDevSubcommandOwner,
} from "../src/core/commands/subcommand-routing.js";
import type { DevHarnessConfig } from "../src/core/config/types.js";
import { devBootstrap } from "../src/core/work-items/lifecycle.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-test-"));
  tempDirs.push(dir);
  return dir;
}

function _markGitRoot(dir: string): void {
  mkdirSync(join(dir, ".git"), { recursive: true });
}

function sampleConfig(overrides: Partial<DevHarnessConfig> = {}): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: {
      command: "bun test",
      file_pattern: "*.test.ts",
    },
    type_check: "bun tsc --noEmit",
    lint: null,
    format: null,
    verification_commands: ["bun test", "bun tsc --noEmit"],
    ...overrides,
  };
}

function _agentsMdWithConfig(config: DevHarnessConfig): string {
  return [
    "# Project Agents",
    "",
    "## Dev Harness",
    "",
    "```json",
    JSON.stringify(config, null, 2),
    "```",
    "",
    "## Other Section",
    "Unrelated content.",
    "",
  ].join("\n");
}

afterEach(() => {
  process.chdir(originalCwd);
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("command dispatch", () => {
  test("routes known commands, help aliases, and free text deterministically", () => {
    expect(devDispatch("plan PROJ-123")).toEqual({
      type: "known",
      subcommand: "plan",
      args: "PROJ-123",
    });

    expect(devDispatch("? anything ignored")).toEqual({
      type: "known",
      subcommand: "help",
      args: "anything ignored",
    });

    expect(devDispatch("fix the login flow")).toEqual({
      type: "classify",
      text: "fix the login flow",
    });
  });

  test("parses /dev tag arguments without splitting multi-word labels", () => {
    expect(parseHarnessTagArgs("")).toEqual({ mode: "show" });
    expect(parseHarnessTagArgs("--clear")).toEqual({ mode: "clear" });
    expect(parseHarnessTagArgs("release hardening")).toEqual({
      mode: "set",
      label: "release hardening",
      newRunId: false,
    });
    expect(parseHarnessTagArgs("--new release hardening")).toEqual({
      mode: "set",
      label: "release hardening",
      newRunId: true,
    });
    expect(parseHarnessTagArgs("--new")).toEqual({
      mode: "set",
      label: "",
      newRunId: true,
    });
  });

  test("empty input suggests resuming a single work item", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    writeFileSync(
      join(project, ".tasks", "PROJ-1.json"),
      JSON.stringify({
        id: "PROJ-1",
        title: "Test work item",
        phase: "coding",
      }),
    );

    expect(devDispatch("")).toEqual({
      type: "empty",
      route: {
        route: "suggest_resume",
        id: "PROJ-1",
        title: "Test work item",
        phase: "coding",
      },
    });
  });
});

describe("parseKnownDevSubcommandArgs", () => {
  test("finds leading work item id and preserves flags", () => {
    expect(parseKnownDevSubcommandArgs("align", "PROJ-1 --force")).toEqual({
      rawArgs: "PROJ-1 --force",
      tokens: ["PROJ-1", "--force"],
      positional: ["PROJ-1"],
      leadingWorkItemId: "PROJ-1",
    });
  });

  test("returns empty structure for blank args", () => {
    expect(parseKnownDevSubcommandArgs("plan", "  ")).toEqual({
      rawArgs: "",
      tokens: [],
      positional: [],
    });
  });
});

describe("subcommand routing", () => {
  test("covers every DEV_SUBCOMMANDS entry", () => {
    assertSubcommandRoutingComplete();
    expect(getDevSubcommandOwner("resume")).toBe("core_orchestrator");
    expect(getDevSubcommandOwner("align")).toBe("core_orchestrator");
    expect(getDevSubcommandOwner("help")).toBe("extension_local");
    expect(getDevSubcommandOwner("gaps")).toBe("extension_local");
    expect(getDevSubcommandOwner("deviations")).toBe("extension_local");
  });
});

describe("classifyPreflight", () => {
  test("creates work item for ticket-only input (regression: /dev STEP-11488)", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    const pre = classifyPreflight("STEP-11488");
    expect(pre.bootstrapNotice).toContain("Created work item `STEP-11488`");
    expect(existsSync(join(project, ".tasks", "STEP-11488.json"))).toBe(true);
    const wi = JSON.parse(readFileSync(join(project, ".tasks", "STEP-11488.json"), "utf8"));
    expect(wi.phase).toBe("aligning");
    expect(wi.pattern).toBe("implement");
    expect(wi.variant).toBe("standard");
    expect(pre.intent.needs_confirmation).toBe(false);
  });

  test("creates work item for unambiguous ticket bootstrap", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    const line = "FOO-1 implement refresh tokens end-to-end with full pipeline and implement tests";
    const pre = classifyPreflight(line);
    expect(pre.bootstrapNotice).toContain("Created work item `FOO-1`");
    expect(existsSync(join(project, ".tasks", "FOO-1.json"))).toBe(true);
  });

  test("skips bootstrap when work item already exists", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    writeFileSync(
      join(project, ".tasks", "FOO-2.json"),
      JSON.stringify({
        id: "FOO-2",
        title: "Existing",
        phase: "speccing",
      }),
    );
    const pre = classifyPreflight("FOO-2 implement something else here with full pipeline wording");
    expect(pre.bootstrapNotice).toContain("already exists");
  });

  test("does not bootstrap commit-shaped ticket lines", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    const pre = classifyPreflight(
      "FOO-3 create a commit message for the staged changes and stage all files please",
    );
    expect(pre.bootstrapNotice).toContain("does not auto-bootstrap");
    expect(existsSync(join(project, ".tasks", "FOO-3.json"))).toBe(false);
  });
});

describe("intent enrichment", () => {
  test("upgrades narrow_change to pipeline when ticket signals indicate large scope", () => {
    const base = recommendIntentMode("fix @src/login.ts the handler");
    expect(base.intent_mode).toBe("narrow_change");

    const result = refineWithTicketSignals(base, {
      ac_count: 5,
      story_points: 5,
      subtask_count: 3,
      description_length: 800,
      issue_type: "Story",
    });

    expect(result.changed).toBe(true);
    expect(result.original.intent_mode).toBe("narrow_change");
    expect(result.refined.intent_mode).toBe("pipeline");
    expect(result.refined.recommended_pattern).toBe("implement");
    expect(result.refined.recommended_variant).toBe("standard");
    expect(result.refined.escalation_ceiling).toBe("pipeline_allowed");
    expect(result.refined.needs_confirmation).toBe(true);
    expect(result.refinement_reasons.some((r) => r.includes("ticket signals"))).toBe(true);
  });

  test("downgrades pipeline to narrow_change when ticket signals indicate small scope", () => {
    const base = recommendIntentMode("implement PROJ-456 add the button");
    expect(base.intent_mode).toBe("pipeline");

    const result = refineWithTicketSignals(base, {
      ac_count: 1,
      story_points: 1,
      subtask_count: 0,
      description_length: 80,
      issue_type: "Bug",
    });

    expect(result.changed).toBe(true);
    expect(result.original.intent_mode).toBe("pipeline");
    expect(result.original.recommended_variant).toBe("standard");
    expect(result.refined.intent_mode).toBe("narrow_change");
    expect(result.refined.recommended_pattern).toBe("quick_fix");
    expect(result.refined.recommended_variant).toBeUndefined();
    expect(result.refined.escalation_ceiling).toBe("no_pipeline_without_confirmation");
    expect(result.refined.needs_confirmation).toBe(true);
    expect(result.refinement_reasons.some((r) => r.includes("ac_count"))).toBe(true);
  });

  test("boosts confidence without changing mode when signals align", () => {
    const base = recommendIntentMode("PROJ-789 update the config");
    expect(base.intent_mode).toBe("pipeline");
    expect(base.confidence).not.toBe("high");

    const result = refineWithTicketSignals(base, {
      ac_count: 4,
      story_points: 3,
      subtask_count: 1,
    });

    expect(result.original.confidence).not.toBe("high");
    expect(result.refined.intent_mode).toBe("pipeline");
    expect(result.refined.confidence).toBe("high");
    expect(result.refined.needs_confirmation).toBe(false);
    expect(result.changed).toBe(true);
  });

  test("upgrades even high-confidence narrow_change when ticket scope is large", () => {
    const base = recommendIntentMode("fix @src/login.ts rename variable");
    expect(base.intent_mode).toBe("narrow_change");
    expect(base.confidence).toBe("high");

    const result = refineWithTicketSignals(base, {
      ac_count: 5,
      story_points: 8,
      subtask_count: 4,
    });

    expect(result.original.intent_mode).toBe("narrow_change");
    expect(result.original.confidence).toBe("high");
    expect(result.refined.intent_mode).toBe("pipeline");
    expect(result.refined.escalation_ceiling).toBe("pipeline_allowed");
    expect(result.changed).toBe(true);
  });

  test("leaves recommendation unchanged when signals are ambiguous", () => {
    const base = recommendIntentMode("PROJ-100 update the config");

    const result = refineWithTicketSignals(base, {
      ac_count: 2,
      story_points: 2,
      subtask_count: 1,
      description_length: 350,
    });

    expect(result.changed).toBe(false);
    expect(result.refined.intent_mode).toBe(base.intent_mode);
    expect(result.refined.confidence).toBe(base.confidence);
  });

  test("epic issue type strongly pushes towards pipeline", () => {
    const base = recommendIntentMode("quick fix @src/utils.ts cleanup");
    expect(base.intent_mode).toBe("narrow_change");

    const result = refineWithTicketSignals(base, {
      issue_type: "Epic",
      ac_count: 3,
      subtask_count: 2,
    });

    expect(result.changed).toBe(true);
    expect(result.refined.intent_mode).toBe("pipeline");
  });

  test("returns unchanged for empty signals", () => {
    const base = recommendIntentMode("fix @src/login.ts typo");

    const result = refineWithTicketSignals(base, {});

    expect(result.changed).toBe(false);
    expect(result.refined.intent_mode).toBe(base.intent_mode);
    expect(result.refined.confidence).toBe(base.confidence);
    expect(result.refinement_reasons).toHaveLength(0);
  });

  test("passes through non-refinable modes unchanged regardless of signals", () => {
    for (const text of [
      "why is the build broken",
      "review this code",
      "explain how auth works",
      "commit my changes",
    ]) {
      const base = recommendIntentMode(text);
      expect(["investigate", "review", "explain", "commit"]).toContain(base.intent_mode);

      const result = refineWithTicketSignals(base, {
        ac_count: 10,
        story_points: 13,
        subtask_count: 8,
        issue_type: "Epic",
      });

      expect(result.changed).toBe(false);
      expect(result.refined).toBe(base);
      expect(result.refinement_reasons).toHaveLength(0);
    }
  });

  test("does not mutate the base recommendation's arrays", () => {
    const base = recommendIntentMode("fix @src/login.ts the handler");
    const originalTargetPaths = [...base.target_paths];
    const originalReasons = [...base.reasons];

    refineWithTicketSignals(base, {
      ac_count: 5,
      story_points: 5,
      subtask_count: 3,
    });

    expect(base.target_paths).toEqual(originalTargetPaths);
    expect(base.reasons).toEqual(originalReasons);
  });

  test("linked_issue_count contributes to upgrade weight", () => {
    const base = recommendIntentMode("fix @src/login.ts the handler");
    expect(base.intent_mode).toBe("narrow_change");

    const result = refineWithTicketSignals(base, {
      ac_count: 3,
      linked_issue_count: 5,
    });

    expect(result.changed).toBe(true);
    expect(result.refined.intent_mode).toBe("pipeline");
  });

  test("already-high-confidence pipeline with confirming signals stays unchanged", () => {
    const base = recommendIntentMode("implement the full pipeline for PROJ-999 spec and plan");
    expect(base.intent_mode).toBe("pipeline");
    expect(base.confidence).toBe("high");

    const result = refineWithTicketSignals(base, {
      ac_count: 5,
      story_points: 5,
    });

    expect(result.changed).toBe(false);
    expect(result.refined.confidence).toBe("high");
  });

  test("formatRefinementResult shows transitions for changed result", () => {
    const base = recommendIntentMode("fix @src/login.ts the handler");
    const result = refineWithTicketSignals(base, {
      ac_count: 5,
      story_points: 5,
      subtask_count: 3,
    });

    const formatted = formatRefinementResult(result);
    expect(formatted).toContain("narrow_change");
    expect(formatted).toContain("pipeline");
    expect(formatted).toContain("refinement_reasons");
  });

  test("formatRefinementResult returns short message for unchanged result", () => {
    const base = recommendIntentMode("PROJ-100 update the config");
    const result = refineWithTicketSignals(base, { ac_count: 2 });

    const formatted = formatRefinementResult(result);
    expect(formatted).toBe("Ticket signals did not change the recommendation.");
  });
});

describe("quick_fix pattern contracts", () => {
  test("recommends and bootstraps narrow changes as quick_fix", async () => {
    const project = tempProject();
    process.chdir(project);

    const recommendation = recommendIntentMode("fix @src/login.ts typo");
    expect(recommendation.intent_mode).toBe("narrow_change");
    expect(recommendation.recommended_pattern).toBe("quick_fix");

    const result = devBootstrap("FIX-1", "Fix login typo", "quick_fix", undefined, {
      intent_mode: recommendation.intent_mode,
      intent_confidence: recommendation.confidence,
      escalation_ceiling: recommendation.escalation_ceiling,
      target_paths: recommendation.target_paths,
      out_of_scope: recommendation.out_of_scope,
    });

    expect(result.work_item.pattern).toBe("quick_fix");
    expect(result.work_item.phase).toBe("fixing");
    await expect(validateArtifact(result.path)).resolves.toEqual({ valid: true, errors: [] });

    const brief = devQuickFixBrief("FIX-1", sampleConfig());
    expect(brief.ok).toBe(true);
    if (!brief.ok) throw new Error(brief.error);
    expect(brief.value.brief_type).toBe("phase-test");
    expect(brief.value.brief).toContain("Quick Fix Test Brief");
    expect(brief.value.brief).toContain("### Quick Fix Contract");

    const taskFile = JSON.parse(readFileSync(join(project, ".tasks", "FIX-1-task-1.json"), "utf8"));
    expect(taskFile.phase).toBe("phase-test");
    expect(taskFile.pre_impl_gates).toBe("pending");
    expect(taskFile.quick_fix_contract.plan.expected_finish).toBe("Fix login typo");
    expect(taskFile.quick_fix_contract.test.strategy).toBe("no_test");
    expect(taskFile.quick_fix_contract.test.reason).toContain("Mechanical");

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "FIX-1.json"), "utf8"));
    expect(wi.spec).toBe(join("docs", "dev", "FIX-1", "spec.json"));
    expect(wi.plan).toBe(join("docs", "dev", "FIX-1", "plan.json"));
    expect(existsSync(join(project, "docs", "dev", "FIX-1", "spec.json"))).toBe(true);
    expect(existsSync(join(project, "docs", "dev", "FIX-1", "plan.json"))).toBe(true);

    await expect(validateArtifact(join(project, ".tasks", "FIX-1.json"))).resolves.toEqual({
      valid: true,
      errors: [],
    });
    await expect(validateArtifact(join(project, ".tasks", "FIX-1-task-1.json"))).resolves.toEqual({
      valid: true,
      errors: [],
    });
    await expect(
      validateArtifact(join(project, "docs", "dev", "FIX-1", "spec.json")),
    ).resolves.toEqual({ valid: true, errors: [] });
    await expect(
      validateArtifact(join(project, "docs", "dev", "FIX-1", "plan.json")),
    ).resolves.toEqual({ valid: true, errors: [] });
  });
});
