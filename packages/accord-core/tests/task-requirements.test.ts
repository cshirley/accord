import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devCodeBrief } from "@clive.shirley/accord-core/briefing/code-brief.js";
import { syncTaskFileOwnerNonceForSpawn } from "@clive.shirley/accord-core/briefing/sync-task-owner-nonce.js";
import {
  buildImplementSpawnTaskBrief,
  filterTestCasesForAcIds,
  formatAcceptanceCriterionLine,
  sliceTaskRequirements,
} from "@clive.shirley/accord-core/briefing/task-requirements.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { applyPhaseTestPostResult } from "@clive.shirley/accord-core/orchestration/post-result/index.js";
import { resolveResumeOrchestration } from "@clive.shirley/accord-core/orchestration/resolve/resume.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import { readTaskFixture, taskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

function minimalDevConfig(): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: ["bun test"],
  };
}

let tempCwd: string;
let originalCwd: string;

function writeWorkItem(id: string, body: Record<string, unknown>): void {
  writeFileSync(join(".tasks", `${id}.json`), `${JSON.stringify(body)}\n`, "utf8");
}

describe("task-requirements", () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(join(tmpdir(), "accord-task-req-"));
    process.chdir(tempCwd);
    mkdirSync(".tasks", { recursive: true });
    // See orchestration.test.ts: reset the process-wide preflight backend singleton so this
    // host-neutral suite doesn't depend on a real host backend/machine credentials.
    resetSpawnPreflightCheckForTests();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempCwd)) rmSync(tempCwd, { recursive: true, force: true });
  });

  test("formatAcceptanceCriterionLine prefers scenario text", () => {
    const line = formatAcceptanceCriterionLine({
      id: "AC-1",
      type: "scenario",
      scenario: "User can log in",
    });
    expect(line).toContain("User can log in");
    expect(line).not.toContain("undefined");
  });

  test("filterTestCasesForAcIds filters by covers", () => {
    const cases = filterTestCasesForAcIds(
      {
        verification: {
          test_cases: [
            { id: "TC-1", covers: "AC-1", scenario: "a", tier: "unit" },
            { id: "TC-2", covers: "AC-2", scenario: "b", tier: "unit" },
          ],
        },
      },
      ["AC-1"],
    );
    expect(cases).toHaveLength(1);
    expect((cases[0] as { id: string }).id).toBe("TC-1");
  });

  test("buildImplementSpawnTaskBrief inlines test_cases for phase-test", () => {
    mkdirSync(join("docs", "dev", "TR-1"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "TR-1", "spec.json"),
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
      join("docs", "dev", "TR-1", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [{ path: "src/a.test.ts", action: "modify" }],
            steps: [{ tag: "test", description: "red" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeWorkItem("TR-1", {
      schema_version: "1.0",
      id: "TR-1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/TR-1/spec.json",
      plan: "docs/dev/TR-1/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "TR-1",
      taskId: 1,
      ownerNonce: "aabbcc",
      phase: "phase-test",
      coversAc: ["AC-1"],
      acText: { "AC-1": "does thing" },
    });

    const brief = buildImplementSpawnTaskBrief({
      workItemId: "TR-1",
      dispatchAgent: "phase-test",
      phase: "implementing",
      title: "t",
      pattern: "implement",
      devConfig: minimalDevConfig(),
    });
    expect(brief.ok).toBe(true);
    if (!brief.ok) throw new Error(brief.error);
    expect(brief.value).not.toBeNull();
    expect(brief.value).toContain("Task requirements");
    expect(brief.value).toContain('"test_cases"');
    expect(brief.value).toContain("aabbcc");
    expect(brief.value).toContain("does thing");

    const sliced = sliceTaskRequirements("TR-1", 1, minimalDevConfig());
    expect(sliced.ok).toBe(true);
    if (sliced.ok) {
      expect(sliced.value.owner_nonce).toBe("aabbcc");
      expect(sliced.value.test_cases).toHaveLength(1);
    }
  });

  test("buildImplementSpawnTaskBrief passes test_output and spec contract fields to review-test", () => {
    mkdirSync(join("docs", "dev", "TR-RT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "TR-RT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [
          { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "does thing" },
        ],
        constraints: ["no real network"],
        scope: { out: [{ item: "legacy API", reason: "deprecated" }] },
        rejected_alternatives: [{ name: "polling", reason: "too slow" }],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "does thing", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "TR-RT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [{ path: "src/a.test.ts", action: "modify" }],
            steps: [{ tag: "test", description: "red" }],
          },
        ],
        guidance: [{ directive: "use colocated tests", source: "convention" }],
      })}\n`,
      "utf8",
    );
    writeWorkItem("TR-RT", {
      schema_version: "1.0",
      id: "TR-RT",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/TR-RT/spec.json",
      plan: "docs/dev/TR-RT/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    // Seed at phase-test, then drive the real phase-test → review-test transition so the
    // v2 task file ends up with a genuine sidecar test_output, confirmed RED, and an
    // AC-1 requirement covered by a `test`-kind change (ac_covered is derived, not stored).
    writeTaskFixture({
      workItemId: "TR-RT",
      taskId: 1,
      ownerNonce: "ddeeff",
      phase: "phase-test",
      coversAc: ["AC-1"],
      acText: { "AC-1": "does thing" },
    });
    applyPhaseTestPostResult(
      "TR-RT",
      {
        status: "done",
        changes: [{ file: "src/a.test.ts", action: "add", kind: "test", ac_ids: ["AC-1"] }],
        red_confirmed: true,
        test_output: "FAIL: expected 401",
      },
      minimalDevConfig(),
    );

    const brief = buildImplementSpawnTaskBrief({
      workItemId: "TR-RT",
      dispatchAgent: "review-test",
      phase: "implementing",
      title: "t",
      pattern: "implement",
      devConfig: minimalDevConfig(),
    });
    expect(brief.ok).toBe(true);
    if (!brief.ok) throw new Error(brief.error);
    expect(brief.value).not.toBeNull();
    expect(brief.value).toContain('"test_output": "FAIL: expected 401"');
    expect(brief.value).toContain('"constraints"');
    expect(brief.value).toContain('"scope_out"');
    expect(brief.value).toContain('"rejected_alternatives"');
    expect(brief.value).toContain('"ac_covered"');
    expect(brief.value).toContain("convention");
  });

  test("dev_code_brief syncs minted owner_nonce to per-task file before phase-code", () => {
    mkdirSync(join("docs", "dev", "TR-SYNC"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "TR-SYNC", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "scenario", scenario: "s" }],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "s", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "TR-SYNC", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [{ path: "src/a.ts", action: "modify" }],
            steps: [{ tag: "impl", description: "do it" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeWorkItem("TR-SYNC", {
      schema_version: "1.0",
      id: "TR-SYNC",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/TR-SYNC/spec.json",
      plan: "docs/dev/TR-SYNC/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    // owner_nonce is deliberately not a valid 6-hex nonce so devCodeBrief mints and syncs one.
    writeTaskFixture({
      workItemId: "TR-SYNC",
      taskId: 1,
      ownerNonce: "not-hex",
      phase: "phase-code",
      preImplGates: "complete",
      coversAc: ["AC-1"],
      acText: { "AC-1": "s" },
      testFiles: ["src/a.test.ts"],
    });

    const result = devCodeBrief("TR-SYNC", "1", minimalDevConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.brief).toContain(`**owner_nonce:** ${result.value.owner_nonce}`);

    const onDisk = readTaskFixture("TR-SYNC", 1);
    expect(onDisk.control.owner_nonce).toBe(result.value.owner_nonce);
    expect(onDisk.control.owner_nonce).toMatch(/^[0-9a-f]{6}$/);
  });

  test("syncTaskFileOwnerNonceForSpawn blocks when assigned nonce disagrees with on-disk nonce", () => {
    const taskFile = taskFixture({
      workItemId: "TR-DRIFT",
      taskId: 1,
      ownerNonce: "aabbcc",
      phase: "phase-test",
      coversAc: ["AC-1"],
    });

    const blocked = syncTaskFileOwnerNonceForSpawn({
      workItemId: "TR-DRIFT",
      taskId: 1,
      ownerNonce: "111111",
      minted: true,
      dispatchAgent: "phase-test",
      taskFile: taskFile as unknown as Record<string, unknown>,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error("expected drift block");
    expect(blocked.error).toContain("owner_nonce drift");
  });

  test("resolveResumeOrchestration uses rich brief for implementing phase-test", () => {
    mkdirSync(join("docs", "dev", "WI-RT"), { recursive: true });
    writeFileSync(
      join("docs", "dev", "WI-RT", "spec.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        acceptance_criteria: [{ id: "AC-1", requirement: "MUST", type: "scenario", scenario: "s" }],
        verification: {
          commands: ["bun test"],
          test_cases: [{ id: "TC-1", covers: "AC-1", scenario: "s", tier: "unit" }],
        },
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join("docs", "dev", "WI-RT", "plan.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        tasks: [
          {
            id: 1,
            title: "t",
            covers_ac: ["AC-1"],
            challenge: false,
            files: [],
            steps: [{ tag: "test", description: "t" }],
          },
        ],
      })}\n`,
      "utf8",
    );
    writeWorkItem("WI-RT", {
      schema_version: "1.0",
      id: "WI-RT",
      title: "rt",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      spec: "docs/dev/WI-RT/spec.json",
      plan: "docs/dev/WI-RT/plan.json",
      verify: null,
      brief: null,
      task_ids: [1],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    });
    writeTaskFixture({
      workItemId: "WI-RT",
      taskId: 1,
      ownerNonce: "112233",
      phase: "phase-test",
      coversAc: ["AC-1"],
      acText: { "AC-1": "s" },
    });

    const r = resolveResumeOrchestration("WI-RT", minimalDevConfig());
    expect(r.outcome).toBe("spawn");
    if (r.outcome === "spawn") {
      expect(r.agent).toBe("phase-test");
      expect(r.task).toContain("Task requirements");
      expect(r.task).not.toContain("Read the work item JSON under `.tasks/`");
    }
  });
});
