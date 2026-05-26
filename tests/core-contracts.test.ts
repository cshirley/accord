import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRequiresConfig } from "../src/core/agents/registry.js";
import { validateArtifact, validateReturn } from "../src/core/artifacts/validation.js";
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
import { extractDevHarnessJson, loadDevHarnessConfig } from "../src/core/config/agents-md.js";
import { devInitWrite } from "../src/core/config/init-write.js";
import { resolveConfigLocation } from "../src/core/config/placement.js";
import type { DevHarnessConfig } from "../src/core/config/types.js";
import {
  createLogContext,
  createLogger,
  getLogLevel,
  type LogLevel,
  resolveLogLevel,
  setLogLevel,
} from "../src/core/logging.js";
import {
  assembleHandoffContent,
  extractReturnPacketFromSubagentResult,
  formatMissingPacketWarning,
  formatPacketInjection,
} from "../src/core/subagent/index.js";
import { formatConfigBrief, formatVerificationResults } from "../src/core/verification/runner.js";
import { TASKS_DIR, writeJson } from "../src/core/work-items/io.js";
import {
  devBootstrap,
  devFinalizeWorkItem,
  devPromoteEvents,
  devTransition,
} from "../src/core/work-items/lifecycle.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-test-"));
  tempDirs.push(dir);
  return dir;
}

function markGitRoot(dir: string): void {
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

function agentsMdWithConfig(config: DevHarnessConfig): string {
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
    expect(getDevSubcommandOwner("resume")).toBe("core_orchestrator_when_flagged");
    expect(getDevSubcommandOwner("align")).toBe("skill");
    expect(getDevSubcommandOwner("help")).toBe("extension_local");
  });
});

describe("classifyPreflight", () => {
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
    expect(brief.value.brief_type).toBe("review-test");
    expect(brief.value.brief).toContain("review-test");
    expect(brief.value.brief).toContain("### Quick Fix Contract");

    const taskFile = JSON.parse(readFileSync(join(project, ".tasks", "FIX-1-task-1.json"), "utf8"));
    expect(taskFile.phase).toBe("review-test");
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

  test("creates a RED-test mini contract for non-mechanical quick fixes", async () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("BUG-1", "Fix login validation bug", "quick_fix", undefined, {
      intent_mode: "narrow_change",
      intent_confidence: "high",
      target_paths: ["src/login.ts"],
      expected_finish: "Invalid credentials return a validation error",
    });

    const brief = devQuickFixBrief("BUG-1", sampleConfig());
    expect(brief.ok).toBe(true);
    if (!brief.ok) throw new Error(brief.error);

    expect(brief.value.brief_type).toBe("phase-test");
    expect(brief.value.brief).toContain("## Quick Fix Test Brief");
    expect(brief.value.brief).toContain("regression test");
    expect(brief.value.brief).toContain("### Covered Acceptance Criteria");
    expect(brief.value.brief).toContain("**AC-1**");

    const taskFile = JSON.parse(readFileSync(join(project, ".tasks", "BUG-1-task-1.json"), "utf8"));
    expect(taskFile.phase).toBe("phase-test");
    expect(taskFile.pre_impl_gates).toBe("pending");
    expect(taskFile.quick_fix_contract).toMatchObject({
      plan: {
        target_paths: ["src/login.ts"],
        expected_finish: "Invalid credentials return a validation error",
      },
      test: {
        strategy: "new_red_test",
        red_required: true,
      },
    });
    expect(taskFile.quick_fix_contract.test.command).toBe("bun test");

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "BUG-1.json"), "utf8"));
    expect(wi.spec).toBe(join("docs", "dev", "BUG-1", "spec.json"));
    expect(wi.plan).toBe(join("docs", "dev", "BUG-1", "plan.json"));

    await expect(validateArtifact(join(project, ".tasks", "BUG-1-task-1.json"))).resolves.toEqual({
      valid: true,
      errors: [],
    });
    await expect(
      validateArtifact(join(project, "docs", "dev", "BUG-1", "spec.json")),
    ).resolves.toEqual({ valid: true, errors: [] });
    await expect(
      validateArtifact(join(project, "docs", "dev", "BUG-1", "plan.json")),
    ).resolves.toEqual({ valid: true, errors: [] });
  });

  test("existing_tests strategy starts at phase-test before review-test", async () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("REG-1", "Make failing test pass for red already", "quick_fix", undefined, {
      intent_mode: "narrow_change",
      intent_confidence: "high",
      target_paths: ["src/auth.ts"],
      expected_finish: "Make failing test pass for red already",
    });

    const brief = devQuickFixBrief("REG-1", sampleConfig());
    expect(brief.ok).toBe(true);
    if (!brief.ok) throw new Error(brief.error);

    expect(brief.value.brief_type).toBe("phase-test");
    expect(brief.value.brief).toContain("## Quick Fix Test Brief");

    const taskFile = JSON.parse(readFileSync(join(project, ".tasks", "REG-1-task-1.json"), "utf8"));
    expect(taskFile.phase).toBe("phase-test");
    expect(taskFile.pre_impl_gates).toBe("pending");
    expect(taskFile.quick_fix_contract.test.strategy).toBe("existing_tests");

    await expect(validateArtifact(join(project, ".tasks", "REG-1-task-1.json"))).resolves.toEqual({
      valid: true,
      errors: [],
    });
    await expect(
      validateArtifact(join(project, "docs", "dev", "REG-1", "spec.json")),
    ).resolves.toEqual({ valid: true, errors: [] });
    await expect(
      validateArtifact(join(project, "docs", "dev", "REG-1", "plan.json")),
    ).resolves.toEqual({ valid: true, errors: [] });
  });

  test("dev_code_brief works for quick fixes after stubs are written", async () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("QF-CB-1", "Fix the auth timeout", "quick_fix", undefined, {
      intent_mode: "narrow_change",
      intent_confidence: "high",
      target_paths: ["src/auth.ts"],
      expected_finish: "Auth timeout returns 408 instead of 500",
    });

    const qfBrief = devQuickFixBrief("QF-CB-1", sampleConfig());
    expect(qfBrief.ok).toBe(true);

    const { devCodeBrief } = await import("../src/core/briefing/code-brief.js");
    const codeBrief = devCodeBrief("QF-CB-1", "1", sampleConfig());
    expect(codeBrief.ok).toBe(true);
    if (!codeBrief.ok) throw new Error(codeBrief.error);
    expect(codeBrief.value.brief).toContain("## Code Task Brief");
    expect(codeBrief.value.brief).toContain("**AC-1**");
    expect(codeBrief.value.brief).toContain("Auth timeout returns 408 instead of 500");
  });
});

describe("work item lifecycle", () => {
  test("devTransition updates phase, sets artifact paths, and deletes checkpoint", () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("LIFE-1", "Lifecycle test", "implement", "standard");
    mkdirSync(join(project, "docs", "dev", "LIFE-1"), { recursive: true });
    writeFileSync(join(project, "docs", "dev", "LIFE-1", "brief.md"), "# Brief\n\nAligned.\n");
    writeFileSync(join(project, ".tasks", "LIFE-1-checkpoint.json"), JSON.stringify({ draft: {} }));

    const result = devTransition("LIFE-1", "speccing", {
      brief: "docs/dev/LIFE-1/brief.md",
      spec: "docs/dev/LIFE-1/spec.json",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.work_item.phase).toBe("speccing");
    expect(result.value.work_item.spec).toBe("docs/dev/LIFE-1/spec.json");
    expect(result.value.work_item.plan).toBeNull();

    const checkpointExists = require("node:fs").existsSync(
      join(project, ".tasks", "LIFE-1-checkpoint.json"),
    );
    expect(checkpointExists).toBe(false);
  });

  test("devTransition returns error for missing work item", () => {
    const project = tempProject();
    process.chdir(project);

    const result = devTransition("NOPE-1", "coding");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("NOPE-1");
  });

  test("devFinalizeWorkItem persists terminal outcome and retro", () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("FIN-1", "Finalize test", "implement");

    const result = devFinalizeWorkItem("FIN-1", {
      terminal_outcome: "done",
      next_action: "merge PR",
      retro: { summary: "Smooth delivery", verify_verdict: "pass" },
      shift_left_findings: [
        {
          category: "spec_plan_gap",
          evidence: "Missing edge case",
          recommendation: "Add negative ACs",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    expect(result.value.work_item.terminal_outcome).toBe("done");
    expect(result.value.work_item.completed_at).toBeTruthy();
    expect(result.value.work_item.next_action).toBe("merge PR");
    expect(result.value.work_item.retro?.summary).toBe("Smooth delivery");
    expect(result.value.work_item.retro?.ran_at).toBeTruthy();
    expect(result.value.work_item.shift_left_findings).toHaveLength(1);
    expect(result.value.work_item.shift_left_findings?.[0].category).toBe("spec_plan_gap");
  });

  test("devFinalizeWorkItem returns error for missing work item", () => {
    const project = tempProject();
    process.chdir(project);

    const result = devFinalizeWorkItem("NOPE-2", { terminal_outcome: "blocked" });
    expect(result.ok).toBe(false);
  });

  test("devPromoteEvents promotes escalations to decisions and deduplicates", () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("PROMO-1", "Promotion test", "implement");

    const taskFile = {
      schema_version: "1.0",
      work_item_id: "PROMO-1",
      task_id: 1,
      owner_nonce: "abc123",
      phase: "phase-code",
      status: "done",
      events: [
        { type: "escalation", question: "Should we use Redis?", context: "caching layer" },
        { type: "escalation", question: "Second escalation", context: "another" },
      ],
    };
    writeJson(join(TASKS_DIR, "PROMO-1-task-1.json"), taskFile);

    const result = devPromoteEvents("PROMO-1", "1");
    expect(result.escalations_added).toBe(2);
    expect(result.deviations_added).toBe(0);
    expect(result.review_requested).toBe(false);

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "PROMO-1.json"), "utf8"));
    expect(wi.decisions).toHaveLength(2);
    expect(wi.decisions[0].question).toBe("Should we use Redis?");
    expect(wi.decisions[0].status).toBe("pending");
    expect(wi.decisions[1].question).toBe("Second escalation");

    // Dedup: promoting same events again should add nothing
    const result2 = devPromoteEvents("PROMO-1", "1");
    expect(result2.escalations_added).toBe(0);
  });

  test("devPromoteEvents promotes deviations and deduplicates", () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("PROMO-2", "Deviation test", "implement");

    const taskFile = {
      schema_version: "1.0",
      work_item_id: "PROMO-2",
      task_id: 2,
      owner_nonce: "def456",
      phase: "phase-code",
      status: "done",
      events: [
        {
          type: "deviation",
          description: "Used SQLite instead of Postgres",
          reason: "simpler for MVP",
        },
      ],
    };
    writeJson(join(TASKS_DIR, "PROMO-2-task-2.json"), taskFile);

    const result = devPromoteEvents("PROMO-2", "2");
    expect(result.deviations_added).toBe(1);

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "PROMO-2.json"), "utf8"));
    expect(wi.deviations).toHaveLength(1);
    expect(wi.deviations[0].description).toBe("Used SQLite instead of Postgres");
    expect(wi.deviations[0].task_id).toBe(2);

    // Dedup: same deviation should not be added again
    const result2 = devPromoteEvents("PROMO-2", "2");
    expect(result2.deviations_added).toBe(0);
  });

  test("devPromoteEvents triggers review agents for request_review events", () => {
    const project = tempProject();
    process.chdir(project);

    devBootstrap("PROMO-3", "Review request test", "implement");

    const taskFile = {
      schema_version: "1.0",
      work_item_id: "PROMO-3",
      task_id: 1,
      owner_nonce: "ghi789",
      phase: "phase-code",
      status: "done",
      events: [
        { type: "request_review", files: ["src/auth/login.ts", "tests/auth/login.test.ts"] },
      ],
    };
    writeJson(join(TASKS_DIR, "PROMO-3-task-1.json"), taskFile);

    const result = devPromoteEvents("PROMO-3", "1");
    expect(result.review_requested).toBe(true);
    expect(result.review_agents).toContain("review-code");
    expect(result.review_agents).toContain("review-test");
    expect(result.review_agents).toContain("review-security");
  });

  test("devPromoteEvents returns empty result for missing work item or task", () => {
    const project = tempProject();
    process.chdir(project);

    const result = devPromoteEvents("NOPE-3", "1");
    expect(result.escalations_added).toBe(0);
    expect(result.deviations_added).toBe(0);
    expect(result.review_requested).toBe(false);
  });
});

describe("agent registry contracts", () => {
  test("ad-hoc review agents can run without project config", () => {
    expect(agentRequiresConfig("review-code")).toBe(false);
    expect(agentRequiresConfig("review-test")).toBe(false);
  });
});

describe("AGENTS.md config contracts", () => {
  test("extracts only the compatibility Dev Harness JSON section", () => {
    const config = sampleConfig();
    const content = agentsMdWithConfig(config);

    expect(JSON.parse(extractDevHarnessJson(content)!)).toMatchObject({
      schema_version: "1.0",
      language: "typescript",
      test: { command: "bun test" },
    });
  });

  test("extractDevHarnessJson is reusable across calls (no /g lastIndex leak)", () => {
    // Guards against a refactor that hoists the /g fence regex to module
    // scope: persistent lastIndex would break the second call. Calling the
    // same function on the same and different inputs must always return
    // the canonical JSON block.
    const goContent = agentsMdWithConfig(sampleConfig({ language: "go" }));
    const rustContent = agentsMdWithConfig(sampleConfig({ language: "rust" }));

    expect(JSON.parse(extractDevHarnessJson(goContent)!).language).toBe("go");
    expect(JSON.parse(extractDevHarnessJson(rustContent)!).language).toBe("rust");
    expect(JSON.parse(extractDevHarnessJson(goContent)!).language).toBe("go");
    expect(JSON.parse(extractDevHarnessJson(goContent)!).language).toBe("go");
  });

  test("loads config from a linked root AGENTS.md", () => {
    const root = tempProject();
    const packageDir = join(root, "packages", "app");
    markGitRoot(root);
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), agentsMdWithConfig(sampleConfig({ language: "go" })));
    writeFileSync(
      join(packageDir, "AGENTS.md"),
      [
        "# Package Agents",
        "",
        "## Dev Harness",
        "",
        "<!-- dev_harness_ref: ../../AGENTS.md -->",
        "",
      ].join("\n"),
    );

    const config = loadDevHarnessConfig(packageDir);

    expect(config?.language).toBe("go");
    expect(config?.test.command).toBe("bun test");
  });

  test("returns null when Dev Harness heading exists but has no JSON block", () => {
    const content = [
      "## Dev Harness",
      "",
      "This section has prose but no fenced JSON block.",
      "",
      "## Other",
    ].join("\n");

    expect(extractDevHarnessJson(content)).toBeNull();
  });

  test("rejects incomplete config instead of returning a partial object", () => {
    const project = tempProject();
    markGitRoot(project);
    writeFileSync(
      join(project, "AGENTS.md"),
      [
        "## Dev Harness",
        "",
        "```json",
        JSON.stringify({ schema_version: "1.0", language: "typescript" }),
        "```",
        "",
      ].join("\n"),
    );

    expect(loadDevHarnessConfig(project)).toBeNull();
  });
});

describe("config placement and writes", () => {
  test("detects nested projects with existing root config", () => {
    const root = tempProject();
    const nested = join(root, "apps", "web");
    markGitRoot(root);
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), agentsMdWithConfig(sampleConfig()));

    expect(resolveConfigLocation(nested)).toMatchObject({
      type: "root_exists",
      gitRoot: root,
      rootAgentsMd: join(root, "AGENTS.md"),
    });
  });

  test("writes root config and local ref for nested packages", () => {
    const root = tempProject();
    const nested = join(root, "packages", "api");
    markGitRoot(root);
    mkdirSync(nested, { recursive: true });

    const result = devInitWrite({
      config: sampleConfig({ language: "python" }),
      target: "root",
      cwd: nested,
      git_root: root,
    });

    expect(result.ref_created).toBe(true);
    expect(result.summary).toContain("Written ACCORD config");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain('"language": "python"');
    expect(readFileSync(join(nested, "AGENTS.md"), "utf8")).toContain(
      "dev_harness_ref: ../../AGENTS.md",
    );
  });

  test("link_only writes ref directive without touching root AGENTS.md", () => {
    const root = tempProject();
    const nested = join(root, "packages", "lib");
    markGitRoot(root);
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), agentsMdWithConfig(sampleConfig()));

    const rootBefore = readFileSync(join(root, "AGENTS.md"), "utf8");

    const result = devInitWrite({
      config: sampleConfig({ language: "ruby" }),
      target: "link_only",
      cwd: nested,
      git_root: root,
    });

    expect(result.ref_created).toBe(true);
    expect(result.written_to).toEqual([join(nested, "AGENTS.md")]);
    expect(readFileSync(join(nested, "AGENTS.md"), "utf8")).toContain(
      "dev_harness_ref: ../../AGENTS.md",
    );
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(rootBefore);
  });

  test("replaces an existing compatibility section without touching later sections", () => {
    const project = tempProject();
    writeFileSync(
      join(project, "AGENTS.md"),
      [
        "# Existing",
        "",
        "## Dev Harness",
        "",
        "old config",
        "",
        "## Keep Me",
        "Preserved.",
        "",
      ].join("\n"),
    );

    devInitWrite({
      config: sampleConfig({ language: "rust" }),
      target: "local",
      cwd: project,
    });

    const content = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(content).toContain('"language": "rust"');
    expect(content).not.toContain("old config");
    expect(content).toContain("## Keep Me\nPreserved.");
  });
});

describe("validation and verification formatting", () => {
  test("validates known return packets and rejects malformed ones", async () => {
    const valid = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "schemas", "examples", "phase-code.json"), "utf8"),
    )[0];

    await expect(validateReturn("phase-code", valid)).resolves.toEqual({ valid: true, errors: [] });

    const invalid = { status: "done" };
    const result = await validateReturn("phase-code", invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("validates artifact schema versions before compiling schemas", async () => {
    const project = tempProject();
    const workItemPath = join(project, "PROJ-1.json");
    writeFileSync(workItemPath, JSON.stringify({ schema_version: "0.1" }));

    const result = await validateArtifact(workItemPath);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("schema_version mismatch");
  });

  test("formats verification failures with command output", () => {
    const formatted = formatVerificationResults(
      [
        { command: "bun test", exitCode: 0, output: "", durationMs: 12 },
        { command: "bun tsc", exitCode: 2, output: "type error", durationMs: 34 },
      ],
      "Verification Preflight",
    );

    expect(formatted).toContain("## Verification Preflight");
    expect(formatted).toContain("`bun tsc` → exit 2");
    expect(formatted).toContain("type error");
    expect(formatted).toContain("Verification failures detected");
  });

  test("formats project stack briefs from ACCORD config", () => {
    const brief = formatConfigBrief(sampleConfig({ lint: "bun lint" }));

    expect(brief).toContain("## Project Stack (from AGENTS.md ACCORD config)");
    expect(brief).toContain("**Test command:** `bun test`");
    expect(brief).toContain("**Lint:** `bun lint`");
  });

  test("extracts return packets from common subagent result shapes", () => {
    const packet = { status: "done", usage: { prompt_tokens: 0, completion_tokens: 0 } };
    const fenced = `done\n\n\`\`\`json\n${JSON.stringify(packet)}\n\`\`\``;

    expect(
      extractReturnPacketFromSubagentResult({
        messages: [{ role: "assistant", content: [{ type: "text", text: fenced }] }],
      }),
    ).toMatchObject({ status: "done" });
    expect(
      extractReturnPacketFromSubagentResult({
        content: [{ type: "text", text: fenced }],
      }),
    ).toMatchObject({ status: "done" });
    expect(
      extractReturnPacketFromSubagentResult({
        output: fenced,
      }),
    ).toMatchObject({ status: "done" });
  });
});

describe("subagent result handoff", () => {
  test("formatPacketInjection produces a fenced JSON block the orchestrator can parse", () => {
    const packet = {
      status: "done",
      files: ["src/a.ts"],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const injected = formatPacketInjection("phase-gather", packet);

    expect(injected).toContain("## phase-gather Return Packet");
    expect(injected).toContain("```json");
    expect(injected).toContain('"status": "done"');

    const re = /```json\s*\n([\s\S]*?)\n```/;
    const match = injected.match(re);
    expect(match).toBeTruthy();
    expect(match?.[1]).toBeDefined();
    const roundTripped = JSON.parse(match![1]!);
    expect(roundTripped).toEqual(packet);
  });

  test("formatMissingPacketWarning names the agent and lists result keys", () => {
    const warning = formatMissingPacketWarning("phase-explore", ["agent", "usage", "messages"]);
    expect(warning).toContain("phase-explore");
    expect(warning).toContain("agent, messages, usage");
    expect(warning).toContain("Return packet missing");
  });

  test("assembleHandoffContent preserves all existing content blocks and appends", () => {
    const existing = [
      { type: "text", text: "Block 1" },
      { type: "text", text: "Block 2" },
    ];
    const appended = "\n\nInjected packet here";
    const result = assembleHandoffContent(existing, appended);

    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("Block 1");
    expect(result[0].text).toContain("Block 2");
    expect(result[0].text).toContain("Injected packet here");
  });

  test("assembleHandoffContent handles bare string content blocks", () => {
    const existing = ["just a string", { type: "text", text: "structured" }];
    const result = assembleHandoffContent(existing as any, "\nextra");
    expect(result[0].text).toContain("just a string");
    expect(result[0].text).toContain("structured");
    expect(result[0].text).toContain("extra");
  });

  test("assembleHandoffContent handles undefined/empty existing content", () => {
    const result = assembleHandoffContent(undefined, "\npacket data");
    expect(result[0].text).toBe("\npacket data");
  });

  test("end-to-end: extraction + injection produces parseable handoff", () => {
    const packet = {
      status: "done",
      context: "test",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    };
    const fenced = `Some prose.\n\n\`\`\`json\n${JSON.stringify(packet)}\n\`\`\``;

    const extracted = extractReturnPacketFromSubagentResult({
      messages: [{ role: "assistant", content: [{ type: "text", text: fenced }] }],
    });
    expect(extracted).toBeTruthy();

    const injected = formatPacketInjection("phase-gather", extracted);
    const assembled = assembleHandoffContent(
      [{ type: "text", text: "Original Pi summary" }],
      injected,
    );

    expect(assembled[0].text).toContain("Original Pi summary");
    const reExtracted = extractReturnPacketFromSubagentResult({
      content: assembled,
    });
    expect(reExtracted).toEqual(extracted);
  });
});

// ── Logging ─────────────────────────────────────────────

describe("logging", () => {
  let savedLevel: LogLevel;

  beforeEach(() => {
    savedLevel = getLogLevel();
  });

  afterEach(() => {
    setLogLevel(savedLevel);
    delete process.env.ACCORD_LOG_LEVEL;
  });

  test("setLogLevel / getLogLevel round-trips", () => {
    setLogLevel("debug");
    expect(getLogLevel()).toBe("debug");
    setLogLevel("error");
    expect(getLogLevel()).toBe("error");
  });

  test("logger suppresses below current level", () => {
    setLogLevel("warn");
    const calls: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => calls.push(msg);
    try {
      const log = createLogger("test");
      log.debug("nope");
      log.info("nope");
      log.warn("yes-warn");
      log.error("yes-error");
      expect(calls).toHaveLength(2);
      expect(calls[0]).toContain("[accord:test:warn]");
      expect(calls[1]).toContain("[accord:test:error]");
    } finally {
      console.error = origError;
    }
  });

  test("silent level suppresses everything", () => {
    setLogLevel("silent");
    const calls: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => calls.push(msg);
    try {
      const log = createLogger("test");
      log.debug("x");
      log.info("x");
      log.warn("x");
      log.error("x");
      expect(calls).toHaveLength(0);
    } finally {
      console.error = origError;
    }
  });

  test("debug level emits everything", () => {
    setLogLevel("debug");
    const calls: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => calls.push(msg);
    try {
      const log = createLogger("t");
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
      expect(calls).toHaveLength(4);
    } finally {
      console.error = origError;
    }
  });

  test("resolveLogLevel prefers env over config", () => {
    process.env.ACCORD_LOG_LEVEL = "debug";
    expect(resolveLogLevel("error")).toBe("debug");
  });

  test("resolveLogLevel falls back to config", () => {
    expect(resolveLogLevel("info")).toBe("info");
  });

  test("resolveLogLevel defaults to error for invalid values", () => {
    expect(resolveLogLevel("banana")).toBe("error");
    process.env.ACCORD_LOG_LEVEL = "nonsense";
    expect(resolveLogLevel("info")).toBe("error");
  });

  test("resolveLogLevel defaults to error when nothing provided", () => {
    expect(resolveLogLevel()).toBe("error");
    expect(resolveLogLevel(null)).toBe("error");
    expect(resolveLogLevel(undefined)).toBe("error");
  });

  test("LogContext instances are isolated from each other", () => {
    const ctx1 = createLogContext();
    const ctx2 = createLogContext();
    ctx1.setLevel("debug");
    ctx2.setLevel("error");
    expect(ctx1.getLevel()).toBe("debug");
    expect(ctx2.getLevel()).toBe("error");

    const calls: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => calls.push(msg);
    try {
      const log1 = ctx1.createLogger("a");
      const log2 = ctx2.createLogger("b");
      log1.debug("from-ctx1");
      log2.debug("from-ctx2");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("[accord:a:debug]");
    } finally {
      console.error = origError;
    }
  });

  test("default context functions remain backwards-compatible", () => {
    setLogLevel("info");
    expect(getLogLevel()).toBe("info");
    const calls: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => calls.push(msg);
    try {
      const log = createLogger("compat");
      log.debug("nope");
      log.info("yes");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("[accord:compat:info]");
    } finally {
      console.error = origError;
    }
  });
});
