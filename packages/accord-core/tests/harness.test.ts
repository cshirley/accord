import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devQuickFixBrief } from "@clive.shirley/accord-core/briefing/code-brief.js";
import { recommendIntentMode } from "@clive.shirley/accord-core/commands/intent.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import {
  applyHarnessCostSeed,
  collectSubagentEntries,
  createOrchestratorUsageDedup,
  firstSubagentAgentName,
  formatArtifactValidationFailureMessage,
  getPrimarySubagentEntry,
  isAgentsMdPath,
  isHarnessTrackedJsonWritePath,
  normalizeHarnessRelativePath,
  notifyPendingDecisionsIfAny,
  prepareSubagentToolCall,
  processOrchestratorTurnEnd,
  processSubagentToolResult,
  rememberOrchestratorFingerprint,
  runGatherPreflightOnSubagentCall,
  runVerifyPreflightOnSubagentCall,
  seedHarnessSessionCostState,
  validateHarnessArtifactWriteIfApplicable,
} from "@clive.shirley/accord-core/harness/index.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/harness/types.js";
import { readLastTestOutput } from "@clive.shirley/accord-core/tasks/store.js";
import type { QuickFixContract } from "@clive.shirley/accord-core/tasks/types.js";
import { loadPricing } from "@clive.shirley/accord-core/telemetry/usage.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-harness-"));
  tempDirs.push(dir);
  return dir;
}

function sampleConfig(overrides: Partial<DevHarnessConfig> = {}): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "*.test.ts" },
    type_check: "bun tsc --noEmit",
    lint: null,
    format: null,
    verification_commands: ["bun test"],
    ...overrides,
  };
}

function emptyHarnessState(devConfig: DevHarnessConfig | null = null): HarnessMutableState {
  return {
    devConfig,
    costCache: new Map(),
    sessionCost: 0,
    activeWorkItem: null,
  };
}

function fencedJsonAssistantBody(payload: unknown): string {
  return `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

function quickFixContractFixture(
  testStrategy: "existing_tests" | "new_red_test",
): QuickFixContract {
  return {
    plan: {
      summary: "s",
      target_paths: [],
      out_of_scope: [],
      expected_finish: "done",
    },
    test: {
      strategy: testStrategy,
      red_required: testStrategy === "new_red_test",
      command: "bun test",
      reason: "r",
    },
  };
}

function persistPrimaryTaskId(project: string, workItemId: string): void {
  const wiPath = join(project, ".tasks", `${workItemId}.json`);
  const wi = JSON.parse(readFileSync(wiPath, "utf8")) as { task_ids: number[] };
  wi.task_ids = [1];
  writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`, "utf8");
}

async function processSingleSubagentAssistantText(
  agent: string,
  task: string,
  assistantText: string,
  state: HarnessMutableState,
): Promise<string> {
  return processSubagentToolResult({
    details: {
      results: [
        {
          agent,
          task,
          messages: [{ role: "assistant", content: [{ type: "text", text: assistantText }] }],
        },
      ],
    },
    state,
    pricing: loadPricing(),
  });
}

afterEach(() => {
  process.chdir(originalCwd);
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("harness paths", () => {
  test("normalizeHarnessRelativePath strips prefix to .tasks or docs", () => {
    expect(normalizeHarnessRelativePath("/repo/.tasks/FOO-1.json")).toBe(".tasks/FOO-1.json");
    expect(normalizeHarnessRelativePath("/repo/docs/dev/FOO-1/spec.json")).toBe(
      "docs/dev/FOO-1/spec.json",
    );
  });

  test("isHarnessTrackedJsonWritePath accepts .tasks and docs/dev JSON only", () => {
    expect(isHarnessTrackedJsonWritePath(".tasks/X-1.json")).toBe(true);
    expect(isHarnessTrackedJsonWritePath("docs/dev/X-1/spec.json")).toBe(true);
    expect(isHarnessTrackedJsonWritePath("docs/other/x.json")).toBe(false);
    expect(isHarnessTrackedJsonWritePath(".tasks/x.txt")).toBe(false);
  });

  test("isAgentsMdPath", () => {
    expect(isAgentsMdPath("/a/AGENTS.md")).toBe(true);
    expect(isAgentsMdPath("AGENTS.md")).toBe(true);
    expect(isAgentsMdPath("/a/README.md")).toBe(false);
    expect(isAgentsMdPath(undefined)).toBe(false);
  });
});

describe("harness subagent-entries", () => {
  test("collectSubagentEntries pushes root agent payload then chain/tasks slots", () => {
    const entries = collectSubagentEntries({
      agent: "a1",
      task: "t1",
      chain: [{ agent: "a2", task: "t2" }],
      tasks: [{ agent: "a3", task: "t3" }],
    });
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ agent: "a1", task: "t1" });
    expect(entries[1]).toEqual({ agent: "a2", task: "t2" });
    expect(entries[2]).toEqual({ agent: "a3", task: "t3" });
  });

  test("firstSubagentAgentName and getPrimarySubagentEntry", () => {
    expect(firstSubagentAgentName({ agent: "phase-code", task: "x" })).toBe("phase-code");
    expect(firstSubagentAgentName({ chain: [{ agent: "phase-gather", task: "y" }] })).toBe(
      "phase-gather",
    );
    expect(getPrimarySubagentEntry({ tasks: [{ agent: "z", task: "q" }] })).toEqual({
      agent: "z",
      task: "q",
    });
  });
});

describe("harness subagent-prepare", () => {
  test("blocks phase-code when devConfig is null", () => {
    const input: Record<string, unknown> = { agent: "phase-code", task: "Do work" };
    expect(prepareSubagentToolCall(input, null).blockReason).toMatch(/Run \/dev init/);
  });

  test("injects Project Stack into systemAppend when devConfig present", () => {
    const input: Record<string, unknown> = { agent: "phase-code", task: "TASK" };
    expect(prepareSubagentToolCall(input, sampleConfig()).blockReason).toBeUndefined();
    expect(String(input.systemAppend)).toContain("Project Stack");
    expect(String(input.task)).toBe("TASK");
  });

  test("leaves a provider-qualified model untouched", () => {
    const input: Record<string, unknown> = {
      agent: "phase-align",
      task: "x",
      model: "cursor/composer-2.5",
    };
    prepareSubagentToolCall(input, null);
    expect(input.model).toBe("cursor/composer-2.5");
  });
});

describe("harness artifact-write helper", () => {
  test("formatArtifactValidationFailureMessage lists errors", () => {
    const msg = formatArtifactValidationFailureMessage("/p/f.json", ["bad", "worse"]);
    expect(msg).toContain("/p/f.json");
    expect(msg).toContain("bad");
    expect(msg).toContain("worse");
  });

  test("validateHarnessArtifactWriteIfApplicable skips non-tracked paths", async () => {
    expect(await validateHarnessArtifactWriteIfApplicable(undefined)).toEqual({ skip: true });
    expect(await validateHarnessArtifactWriteIfApplicable("README.md")).toEqual({ skip: true });
  });

  test("validateHarnessArtifactWriteIfApplicable rejects invalid work item JSON", async () => {
    const project = tempProject();
    mkdirSync(join(project, ".tasks"), { recursive: true });
    writeFileSync(join(project, ".tasks", "BAD-1.json"), "{ not valid work item }\n", "utf8");
    const res = await validateHarnessArtifactWriteIfApplicable(
      join(project, ".tasks", "BAD-1.json"),
    );
    expect(res.skip).toBe(false);
    if (!("valid" in res) || res.skip) throw new Error("expected validation branch");
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });
});

describe("harness orchestrator usage", () => {
  test("rememberOrchestratorFingerprint dedupes identical fingerprints", () => {
    const dedup = createOrchestratorUsageDedup();
    expect(rememberOrchestratorFingerprint(dedup, "a")).toBe(true);
    expect(rememberOrchestratorFingerprint(dedup, "a")).toBe(false);
    expect(rememberOrchestratorFingerprint(dedup, "b")).toBe(true);
  });

  test("processOrchestratorTurnEnd is a no-op without billable usage", () => {
    const state = emptyHarnessState();
    const dedup = createOrchestratorUsageDedup();
    const msg = { role: "assistant", content: [], usage: { input: 0, output: 0 } };
    expect(
      processOrchestratorTurnEnd({
        message: msg,
        workItemId: "X-1",
        state,
        pricing: loadPricing(),
        dedup,
      }),
    ).toBe(false);
  });

  test("processOrchestratorTurnEnd records when usage is billable", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("USD-1", "usage test", "quick_fix");

    const state = emptyHarnessState();
    const dedup = createOrchestratorUsageDedup();
    const msg = {
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input: 100, output: 50 },
      id: "turn-msg-1",
    };
    expect(
      processOrchestratorTurnEnd({
        message: msg,
        workItemId: "USD-1",
        state,
        pricing: loadPricing(),
        dedup,
      }),
    ).toBe(true);
    expect(state.activeWorkItem).toBe("USD-1");
    // Billable input/output > 0 with default pricing must produce a positive
    // cost. >= 0 would silently pass a regression that returned 0.
    expect(state.costCache.get("USD-1")!).toBeGreaterThan(0);

    // Side-effect: the orchestrator turn must persist a usage line tagged
    // source="orchestrator" so retro / cost rollup can attribute it.
    const jsonl = join(project, ".tasks", "USD-1-usage.jsonl");
    expect(existsSync(jsonl)).toBe(true);
    const line = readFileSync(jsonl, "utf8").trim().split("\n").pop()!;
    expect(line).toContain("USD-1");
    expect(line).toContain('"source":"orchestrator"');
  });
});

describe("harness session cost seed", () => {
  test("seedHarnessSessionCostState reflects discovered work items", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("SEED-1", "one", "quick_fix");
    const seed = seedHarnessSessionCostState();
    expect(seed.costCache.has("SEED-1")).toBe(true);
    expect(seed.activeWorkItem).toBe("SEED-1");
    expect(seed.sessionCost).toBe(seed.costCache.get("SEED-1") ?? -1);

    const state = emptyHarnessState();
    applyHarnessCostSeed(state, seed);
    expect(state.activeWorkItem).toBe("SEED-1");
  });

  test("seedHarnessSessionCostState leaves activeWorkItem null when multiple items", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("M-1", "a", "quick_fix");
    devBootstrap("M-2", "b", "quick_fix");
    const seed = seedHarnessSessionCostState();
    expect(seed.activeWorkItem).toBeNull();
  });
});

describe("harness pending decisions notify", () => {
  test("notifyPendingDecisionsIfAny does not notify when queue empty", () => {
    const project = tempProject();
    process.chdir(project);
    const calls: string[] = [];
    notifyPendingDecisionsIfAny({
      notify: (_level, m) => {
        calls.push(m);
      },
    });
    expect(calls).toEqual([]);
  });
});

describe("harness verify preflight", () => {
  test("returns {} when agent is not phase-verify*", async () => {
    expect(await runVerifyPreflightOnSubagentCall({ agent: "phase-code", task: "" }, null)).toEqual(
      {},
    );
  });

  test("blocks when spec/plan missing for work item in task", async () => {
    const project = tempProject();
    process.chdir(project);
    const r = await runVerifyPreflightOnSubagentCall(
      {
        agent: "phase-verify-acceptance",
        task: "work_item_id: VFY-9\ncontext",
      },
      sampleConfig(),
    );
    expect(r.blockReason).toMatch(/Spec not found/);
  });

  test("chain phase-code then phase-verify runs verify preflight on the verify step", async () => {
    const project = tempProject();
    process.chdir(project);
    const input: Record<string, unknown> = {
      chain: [
        { agent: "phase-code", task: "work_item_id: CHN-1\nimplement" },
        {
          agent: "phase-verify-acceptance",
          task: "work_item_id: CHN-1\nverify",
        },
      ],
    };
    const blocked = await runVerifyPreflightOnSubagentCall(input, sampleConfig());
    expect(blocked.blockReason).toMatch(/Spec not found/);

    const recommendation = recommendIntentMode("fix @src/x.ts typo");
    devBootstrap("CHN-1", "Chain verify", "quick_fix", undefined, {
      intent_mode: recommendation.intent_mode,
      intent_confidence: recommendation.confidence,
      escalation_ceiling: recommendation.escalation_ceiling,
      target_paths: recommendation.target_paths,
      out_of_scope: recommendation.out_of_scope,
    });
    const cfg = sampleConfig({ verification_commands: ["true"] });
    const qf = devQuickFixBrief("CHN-1", cfg);
    if (!qf.ok) throw new Error(qf.error);

    const okInput: Record<string, unknown> = {
      chain: [
        { agent: "phase-code", task: "work_item_id: CHN-1\nimplement" },
        {
          agent: "phase-verify-acceptance",
          task: "work_item_id: CHN-1\nverify",
        },
      ],
    };
    const ok = await runVerifyPreflightOnSubagentCall(okInput, cfg);
    expect(ok.blockReason).toBeUndefined();
    const chain = okInput.chain as { task?: string }[];
    expect(String(chain[1]?.task)).toContain("Verification Preflight");
    expect(String(chain[0]?.task)).not.toContain("Verification Preflight");
  });

  test("chain with two phase-verify steps appends preflight to every verify entry", async () => {
    const project = tempProject();
    process.chdir(project);
    const recommendation = recommendIntentMode("fix @src/x.ts typo");
    devBootstrap("CHN-2", "Dual verify", "quick_fix", undefined, {
      intent_mode: recommendation.intent_mode,
      intent_confidence: recommendation.confidence,
      escalation_ceiling: recommendation.escalation_ceiling,
      target_paths: recommendation.target_paths,
      out_of_scope: recommendation.out_of_scope,
    });
    const cfg = sampleConfig({ verification_commands: ["true"] });
    const qf = devQuickFixBrief("CHN-2", cfg);
    if (!qf.ok) throw new Error(qf.error);

    const input: Record<string, unknown> = {
      chain: [
        { agent: "phase-code", task: "work_item_id: CHN-2\nimplement" },
        {
          agent: "phase-verify-acceptance",
          task: "work_item_id: CHN-2\nverify acceptance",
        },
        {
          agent: "phase-verify-infra",
          task: "work_item_id: CHN-2\nverify infra",
        },
      ],
    };
    const ok = await runVerifyPreflightOnSubagentCall(input, cfg);
    expect(ok.blockReason).toBeUndefined();
    const chain = input.chain as { task?: string }[];
    expect(String(chain[1]?.task)).toContain("Verification Preflight");
    expect(String(chain[2]?.task)).toContain("Verification Preflight");
    expect(String(chain[0]?.task)).not.toContain("Verification Preflight");
  });

  test("parallel tasks with phase-verify agents append preflight to each verify task", async () => {
    const project = tempProject();
    process.chdir(project);
    const recommendation = recommendIntentMode("fix @src/x.ts typo");
    devBootstrap("TSK-VFY-1", "Parallel verify", "quick_fix", undefined, {
      intent_mode: recommendation.intent_mode,
      intent_confidence: recommendation.confidence,
      escalation_ceiling: recommendation.escalation_ceiling,
      target_paths: recommendation.target_paths,
      out_of_scope: recommendation.out_of_scope,
    });
    const cfg = sampleConfig({ verification_commands: ["true"] });
    const qf = devQuickFixBrief("TSK-VFY-1", cfg);
    if (!qf.ok) throw new Error(qf.error);

    const input: Record<string, unknown> = {
      tasks: [
        {
          agent: "phase-verify-acceptance",
          task: "work_item_id: TSK-VFY-1\nverify acceptance",
        },
        {
          agent: "phase-verify-infra",
          task: "work_item_id: TSK-VFY-1\nverify infra",
        },
      ],
    };
    const ok = await runVerifyPreflightOnSubagentCall(input, cfg);
    expect(ok.blockReason).toBeUndefined();
    const tasks = input.tasks as { task?: string }[];
    expect(String(tasks[0]?.task)).toContain("Verification Preflight");
    expect(String(tasks[1]?.task)).toContain("Verification Preflight");
  });

  test("appends verification preflight when spec/plan exist and commands succeed", async () => {
    const project = tempProject();
    process.chdir(project);
    const recommendation = recommendIntentMode("fix @src/x.ts typo");
    devBootstrap("VFY-OK-1", "Fix typo", "quick_fix", undefined, {
      intent_mode: recommendation.intent_mode,
      intent_confidence: recommendation.confidence,
      escalation_ceiling: recommendation.escalation_ceiling,
      target_paths: recommendation.target_paths,
      out_of_scope: recommendation.out_of_scope,
    });
    const cfg = sampleConfig({ verification_commands: ["true"] });
    const qf = devQuickFixBrief("VFY-OK-1", cfg);
    if (!qf.ok) throw new Error(qf.error);

    const input: Record<string, unknown> = {
      agent: "phase-verify-acceptance",
      task: "Continue verify for VFY-OK-1",
    };
    const r = await runVerifyPreflightOnSubagentCall(input, cfg);
    expect(r.blockReason).toBeUndefined();
    expect(String(input.task)).toContain("Verification Preflight");
    expect(String(input.task)).toMatch(/`true`/);
    expect(String(input.task)).toMatch(/exit 0/);
  });
});

describe("harness gather preflight", () => {
  test("no-op when agent is not phase-gather", async () => {
    expect(
      await runGatherPreflightOnSubagentCall(
        { agent: "phase-code", task: "x" },
        null,
        new Set(),
        {},
      ),
    ).toEqual({});
  });

  test("blocks when user declines proceed on unavailable sources", async () => {
    const input: Record<string, unknown> = {
      agent: "phase-gather",
      task: "work_item_id: GTH-1",
    };
    const r = await runGatherPreflightOnSubagentCall(input, null, new Set(), {
      confirm: async () => false,
    });
    expect(r.blockReason).toMatch(/cancelled/);
  });

  test("plain-text tracker with no enrichments proceeds without block", async () => {
    const input: Record<string, unknown> = {
      agent: "phase-gather",
      task: "base",
    };
    const cfg = sampleConfig({ tracker: { type: "plain-text" } });
    const r = await runGatherPreflightOnSubagentCall(input, cfg, new Set(["noop_tool"]), {
      notify: () => {},
    });
    expect(r.blockReason).toBeUndefined();
    expect(String(input.task)).toContain("Gather Preflight");
  });
});

describe("harness processSubagentToolResult", () => {
  function quickFixIntent() {
    const recommendation = recommendIntentMode("fix @src/x.ts typo");
    return {
      intent_mode: recommendation.intent_mode,
      intent_confidence: recommendation.confidence,
      escalation_ceiling: recommendation.escalation_ceiling,
      target_paths: recommendation.target_paths,
      out_of_scope: recommendation.out_of_scope,
    };
  }

  const validPhaseCodePacket = {
    status: "done" as const,
    files_changed: ["src/x.ts"],
    tests_passing: true,
    ac_covered: ["AC-1"],
    deviations_emitted: 0,
    reviews_requested: 0,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };

  test("returns empty string when details.results missing", async () => {
    expect(
      await processSubagentToolResult({
        details: {},
        state: emptyHarnessState(),
        pricing: loadPricing(),
      }),
    ).toBe("");
  });

  test("prefers parsedReturn from programmatic spawn results", async () => {
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-align",
            task: "ACCORD-1 align",
            exitCode: 0,
            messages: [],
            parsedReturn: { status: "done", summary: "aligned" },
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });
    expect(out).toContain("phase-align Return Packet");
    expect(out).toContain('"summary": "aligned"');
  });

  test("injects validated phase-code return packet from assistant fenced JSON", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PKP-1", "Packet test", "quick_fix", undefined, quickFixIntent());

    const body = `Summary\n${fencedJsonAssistantBody(validPhaseCodePacket)}`;
    const out = await processSingleSubagentAssistantText(
      "phase-code",
      "Implement PKP-1",
      body,
      emptyHarnessState(),
    );
    expect(out).toContain("phase-code Return Packet");
    expect(out).toContain('"status": "done"');
    expect(out).not.toContain("Return packet validation failed");
  });

  test("surfaces invalid return packet against phase-code schema", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PKP-INV-1", "Invalid packet", "quick_fix", undefined, quickFixIntent());

    // v2 phase-code schema no longer requires ac_covered/deviations_emitted; the old
    // "badPacket" (missing those) is now schema-valid. Violate `anyOf: [changes, files_changed]`
    // instead (status "done" with neither changes[] nor files_changed[]).
    const badPacket = {
      status: "done",
      tests_passing: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const out = await processSingleSubagentAssistantText(
      "phase-code",
      "PKP-INV-1",
      fencedJsonAssistantBody(badPacket),
      emptyHarnessState(),
    );
    expect(out).toContain("Return packet validation failed");
  });

  test("backfills missing packet usage from host-measured result.usage", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PKP-USG-1", "Backfill usage", "quick_fix", undefined, quickFixIntent());

    const packetWithoutUsage = {
      status: "done",
      files_changed: ["a.ts"],
      tests_passing: true,
      ac_covered: [],
    };
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-code",
            task: "PKP-USG-1",
            model: "test-model",
            exitCode: 0,
            usage: { input: 100, output: 40 },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: fencedJsonAssistantBody(packetWithoutUsage) }],
              },
            ],
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });
    expect(out).not.toContain("Return packet validation failed");
    expect(out).toContain('"prompt_tokens": 100');
    expect(out).toContain('"completion_tokens": 40');
  });

  test("detects empty assistant response for a phase agent", async () => {
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-code",
            task: "ORPHAN-1",
            model: "test-model",
            stopReason: "end_turn",
            exitCode: 0,
            messages: [{ role: "assistant", content: [] }],
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });
    expect(out).toContain("empty response");
    expect(out).toContain("phase-code");
  });

  test("accepts streamed output when assistant message content is empty", async () => {
    const packet = { status: "done", summary: "planned" };
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-align",
            task: "ACCORD-STREAM-1 align",
            exitCode: 0,
            messages: [{ role: "assistant", content: [] }],
            output: `Done\n\`\`\`json\n${JSON.stringify(packet)}\n\`\`\``,
            liveActivity: { streamingText: `Done\n\`\`\`json\n${JSON.stringify(packet)}\n\`\`\`` },
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });
    expect(out).not.toContain("empty response");
    expect(out).toContain("phase-align Return Packet");
  });

  test("runs post-code verification when devConfig supplies type_check", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PKP-PC-1", "Post-code", "quick_fix", undefined, quickFixIntent());

    const cfg = sampleConfig({
      type_check: process.platform === "win32" ? "cmd /c exit 0" : "true",
      test: { command: "   ", file_pattern: "*.ts" },
      verification_commands: ["true"],
    });
    const out = await processSingleSubagentAssistantText(
      "phase-code",
      "PKP-PC-1",
      fencedJsonAssistantBody(validPhaseCodePacket),
      emptyHarnessState(cfg),
    );
    expect(out).toContain("Post-Code Verification");
    expect(out).toMatch(/exit 0/);
  });

  test("applies quick_fix task updates after validated review-test packet", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("QRT-1", "quick fix review apply", "quick_fix", undefined, quickFixIntent());
    persistPrimaryTaskId(project, "QRT-1");
    writeTaskFixture(
      {
        workItemId: "QRT-1",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "review-test",
        preImplGates: "pending",
        quickFixContract: quickFixContractFixture("existing_tests"),
      },
      project,
    );

    const reviewPacket = { verdict: "clean" as const, findings: [] };
    const out = await processSingleSubagentAssistantText(
      "review-test",
      "Run review-test for harness item QRT-1",
      fencedJsonAssistantBody(reviewPacket),
      emptyHarnessState(),
    );
    expect(out).toContain("Quick-fix (review-test)");
    const task = readTaskFixture("QRT-1", 1, project);
    expect(task.control.phase).toBe("phase-code");
  });

  test("applies quick_fix phase-test → review-test handoff after validated phase-test packet", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("QPT-1", "quick fix phase test apply", "quick_fix", undefined, quickFixIntent());
    persistPrimaryTaskId(project, "QPT-1");
    writeTaskFixture(
      {
        workItemId: "QPT-1",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "phase-test",
        preImplGates: "pending",
        quickFixContract: quickFixContractFixture("new_red_test"),
      },
      project,
    );

    const phaseTestPacket = {
      status: "done" as const,
      test_files: ["src/qpt.test.ts"],
      red_confirmed: true,
      test_output: "FAIL: expected 403",
      ac_covered: ["AC-1"],
      deviations_emitted: 0,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const out = await processSingleSubagentAssistantText(
      "phase-test",
      "Run phase-test for harness item QPT-1",
      fencedJsonAssistantBody(phaseTestPacket),
      emptyHarnessState(),
    );
    expect(out).toContain("Quick-fix (phase-test)");
    const task = readTaskFixture("QPT-1", 1, project);
    expect(task.control.phase).toBe("review-test");
    expect(task.control.test_files).toEqual(["src/qpt.test.ts"]);
    expect(readLastTestOutput(task)).toBe("FAIL: expected 403");
    // v2 has no flat `ac_covered` — it's derived from requirements[].changes at brief time, and
    // quick_fix tasks (coversAc: []) route every change to the catch-all `_task` requirement, so
    // there is no per-AC requirement to assert coverage against here.
  });

  test("applies implement phase-test → review-test handoff after validated phase-test packet", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("IPT-1", "implement phase test apply", "implement", "express");
    persistPrimaryTaskId(project, "IPT-1");
    writeTaskFixture(
      {
        workItemId: "IPT-1",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "phase-test",
        coversAc: ["AC-1"],
      },
      project,
    );

    const phaseTestPacket = {
      status: "done" as const,
      test_files: ["src/ipt.test.ts"],
      red_confirmed: true,
      ac_covered: ["AC-1"],
      deviations_emitted: 0,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const out = await processSingleSubagentAssistantText(
      "phase-test",
      "Run phase-test for harness item IPT-1",
      fencedJsonAssistantBody(phaseTestPacket),
      emptyHarnessState(),
    );
    expect(out).toContain("Implement (phase-test)");
    const task = readTaskFixture("IPT-1", 1, project);
    expect(task.control.phase).toBe("review-test");
    expect(task.control.test_files).toEqual(["src/ipt.test.ts"]);
    // AC-1 requirement exists (coversAc), so — unlike quick_fix — coverage is attributable:
    // the legacy ac_covered assertion becomes a requirement-changes assertion.
    expect(task.requirements.find((r) => r.id === "AC-1")?.changes.map((c) => c.file)).toEqual([
      "src/ipt.test.ts",
    ]);
  });

  test("applies implement review-test → phase-code handoff after validated review-test packet", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("IRT-1", "implement review test apply", "implement", "express");
    persistPrimaryTaskId(project, "IRT-1");
    writeTaskFixture(
      {
        workItemId: "IRT-1",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "review-test",
        preImplGates: "pending",
        coversAc: ["AC-1"],
        testFiles: ["src/irt.test.ts"],
      },
      project,
    );

    const reviewPacket = {
      verdict: "clean" as const,
      findings: [] as Array<{ severity: string; issue: string }>,
    };
    const out = await processSingleSubagentAssistantText(
      "review-test",
      "Run review-test for harness item IRT-1",
      fencedJsonAssistantBody(reviewPacket),
      emptyHarnessState(),
    );
    expect(out).toContain("Implement (review-test)");
    const task = readTaskFixture("IRT-1", 1, project);
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.pre_impl_gates).toBe("complete");
  });

  test("review-test warning-only issues advance to phase-code (with severity_gate config)", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("QRT-2", "gate", "quick_fix", undefined, quickFixIntent());
    persistPrimaryTaskId(project, "QRT-2");
    writeTaskFixture(
      {
        workItemId: "QRT-2",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "review-test",
        preImplGates: "pending",
        quickFixContract: quickFixContractFixture("existing_tests"),
      },
      project,
    );

    const reviewPacket = {
      verdict: "issues" as const,
      findings: [
        {
          severity: "warning" as const,
          issue: "flakey assertion order",
          evidence: "e",
          recommendation: "r",
        },
      ],
    };
    await processSingleSubagentAssistantText(
      "review-test",
      "Review tests for QRT-2",
      fencedJsonAssistantBody(reviewPacket),
      emptyHarnessState(
        sampleConfig({
          orchestration: { quick_fix_loop: { severity_gate: "block" } },
        }),
      ),
    );
    const task = readTaskFixture("QRT-2", 1, project);
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.test_review.used).toBe(0);
  });

  test("review-test warning-only issues retry phase-test when severity_gate is warn", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("QRT-4", "warn gate", "quick_fix", undefined, quickFixIntent());
    persistPrimaryTaskId(project, "QRT-4");
    writeTaskFixture(
      {
        workItemId: "QRT-4",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "review-test",
        preImplGates: "pending",
        quickFixContract: quickFixContractFixture("existing_tests"),
      },
      project,
    );

    const reviewPacket = {
      verdict: "issues" as const,
      findings: [
        {
          severity: "warning" as const,
          issue: "missing negative case",
          evidence: "e",
          recommendation: "r",
          file: "src/qrt4.test.ts",
          line: 1,
        },
      ],
    };
    const out = await processSingleSubagentAssistantText(
      "review-test",
      "Review tests for QRT-4",
      fencedJsonAssistantBody(reviewPacket),
      emptyHarnessState(
        sampleConfig({
          orchestration: { quick_fix_loop: { severity_gate: "warn", max_test_review_loops: 3 } },
        }),
      ),
    );
    expect(out).toMatch(/retrying \*\*phase-test\*\*/i);
    const task = readTaskFixture("QRT-4", 1, project);
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.test_review.used).toBe(1);
  });

  test("review-test warning-only issues advance to phase-code (no devConfig)", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("QRT-3", "gate", "quick_fix", undefined, quickFixIntent());
    persistPrimaryTaskId(project, "QRT-3");
    writeTaskFixture(
      {
        workItemId: "QRT-3",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "review-test",
        preImplGates: "pending",
        quickFixContract: quickFixContractFixture("existing_tests"),
      },
      project,
    );

    const reviewPacket = {
      verdict: "issues" as const,
      findings: [
        {
          severity: "warning" as const,
          issue: "flakey assertion order",
          evidence: "e",
          recommendation: "r",
        },
      ],
    };
    await processSingleSubagentAssistantText(
      "review-test",
      "Review tests for QRT-3 (no devConfig)",
      fencedJsonAssistantBody(reviewPacket),
      emptyHarnessState(),
    );
    const task = readTaskFixture("QRT-3", 1, project);
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.test_review.used).toBe(0);
  });

  test("blocks quick_fix when review-test issues hit loop cap (quick_fix_loop_blocked)", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("QFBC-1", "loop cap", "quick_fix", undefined, quickFixIntent());
    persistPrimaryTaskId(project, "QFBC-1");
    writeTaskFixture(
      {
        workItemId: "QFBC-1",
        taskId: 1,
        ownerNonce: "abcdef",
        phase: "review-test",
        preImplGates: "pending",
        quickFixContract: quickFixContractFixture("existing_tests"),
      },
      project,
    );

    const reviewPacket = {
      verdict: "issues" as const,
      findings: [
        {
          severity: "critical" as const,
          issue: "tests fail",
          evidence: "e",
          recommendation: "r",
          file: "src/qfbc.test.ts",
          line: 1,
        },
      ],
    };
    const out = await processSingleSubagentAssistantText(
      "review-test",
      "Review tests for QFBC-1",
      fencedJsonAssistantBody(reviewPacket),
      emptyHarnessState(
        sampleConfig({
          orchestration: { quick_fix_loop: { max_test_review_loops: 0, severity_gate: "warn" } },
        }),
      ),
    );
    expect(out).toContain("Quick-fix:");
    expect(out).toMatch(/cap reached/i);

    const task = readTaskFixture("QFBC-1", 1, project);
    expect(task.control.status).toBe("blocked");
    // v1's flat `events[]` (`quick_fix_loop_blocked`) is gone — the equivalent v2 fact is the
    // `control.blocked` cap record plus the harness `<round>/decision` log entry.
    expect(task.control.blocked?.kind).toBe("cap");
    expect(task.control.blocked?.reason).toMatch(/cap reached/i);
    const decisionEntry = task.log.find((e) => e.result === "blocked");
    expect(decisionEntry).toBeDefined();
    expect(decisionEntry?.note).toMatch(/cap reached/i);

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "QFBC-1.json"), "utf8")) as {
      updated?: string;
    };
    expect(typeof wi.updated).toBe("string");
    expect(wi.updated!.length).toBeGreaterThan(0);
  });

  test("appends usage line when subagent reports billable usage", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("USG-1", "Usage", "quick_fix", undefined, quickFixIntent());

    await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-align",
            task: "USG-1 align",
            usage: { input: 100, output: 50 },
            messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });
    const jsonl = join(project, ".tasks", "USG-1-usage.jsonl");
    expect(existsSync(jsonl)).toBe(true);
    const line = readFileSync(jsonl, "utf8").trim().split("\n").pop();
    expect(line).toContain("USG-1");
    expect(line).toContain("subagent");
  });

  test("promotes a stuck packet from ANY agent to decisions[] (universal safety net)", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("STK-1", "Stuck verify", "implement", "standard");

    const stuckPacket = {
      status: "stuck",
      question:
        "AC-2 says 'export excludes soft-deleted rows' but the API has no filter flag \u2014 add one or amend the AC?",
      context: "phase-verify-acceptance could not confirm AC-2",
      tried: "Checked export endpoint and query builder for a soft-delete filter",
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    };

    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-verify-acceptance",
            task: "STK-1",
            model: "test-model",
            exitCode: 0,
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: fencedJsonAssistantBody(stuckPacket) }],
              },
            ],
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });

    expect(out).toContain("is stuck");
    expect(out).toContain("AC-2");

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "STK-1.json"), "utf8"));
    expect(wi.decisions).toHaveLength(1);
    expect(wi.decisions[0]).toMatchObject({
      id: "phase-verify-acceptance-stuck-1",
      source: "escalation",
      status: "pending",
    });
    expect(wi.decisions[0].question).toContain("AC-2");
    expect(wi.decisions[0].context).toContain("Tried:");

    // Respawning with the identical stuck packet must not duplicate the decision.
    await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-verify-acceptance",
            task: "STK-1",
            model: "test-model",
            exitCode: 0,
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: fencedJsonAssistantBody(stuckPacket) }],
              },
            ],
          },
        ],
      },
      state: emptyHarnessState(),
      pricing: loadPricing(),
    });
    const wi2 = JSON.parse(readFileSync(join(project, ".tasks", "STK-1.json"), "utf8"));
    expect(wi2.decisions).toHaveLength(1);
  });
});

describe("harness pipeline artifact preflight", () => {
  test("blocks phase-spec when brief missing for implement/standard", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    devBootstrap("GATE-1", "Gate test", "implement", "standard");

    const { runPipelineArtifactPreflightOnSubagentCall } = await import(
      "@clive.shirley/accord-core/subagent/preflight/pipeline-artifacts.js"
    );
    const r = await runPipelineArtifactPreflightOnSubagentCall({
      agent: "phase-spec",
      task: "work_item_id: GATE-1\ncontinue spec",
    });
    expect(r.blockReason).toMatch(/Brief required before spec/);
  });

  test("allows phase-spec when brief exists on disk", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    mkdirSync(join(project, "docs", "dev", "GATE-2"), { recursive: true });
    writeFileSync(join(project, "docs", "dev", "GATE-2", "brief.md"), "# Problem Brief\n\nBody.\n");
    devBootstrap("GATE-2", "Gate test 2", "implement", "standard");

    const { runPipelineArtifactPreflightOnSubagentCall } = await import(
      "@clive.shirley/accord-core/subagent/preflight/pipeline-artifacts.js"
    );
    const r = await runPipelineArtifactPreflightOnSubagentCall({
      agent: "phase-spec",
      task: "work_item_id: GATE-2",
    });
    expect(r.blockReason).toBeUndefined();
  });

  test("chain phase-spec then phase-plan gates every pipeline step at tool-start", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    mkdirSync(join(project, "docs", "dev", "GATE-3"), { recursive: true });
    writeFileSync(join(project, "docs", "dev", "GATE-3", "brief.md"), "# Problem Brief\n\nBody.\n");
    devBootstrap("GATE-3", "Chain gate", "implement", "standard");

    const { runPipelineArtifactPreflightOnSubagentCall } = await import(
      "@clive.shirley/accord-core/subagent/preflight/pipeline-artifacts.js"
    );
    const r = await runPipelineArtifactPreflightOnSubagentCall({
      chain: [
        { agent: "phase-spec", task: "work_item_id: GATE-3\nwrite spec" },
        { agent: "phase-plan", task: "work_item_id: GATE-3\nwrite plan" },
      ],
    });
    expect(r.blockReason).toMatch(/Spec required before plan/);
  });

  test("chain blocks phase-spec first step when brief missing", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    devBootstrap("GATE-4", "Chain no brief", "implement", "standard");

    const { runPipelineArtifactPreflightOnSubagentCall } = await import(
      "@clive.shirley/accord-core/subagent/preflight/pipeline-artifacts.js"
    );
    const r = await runPipelineArtifactPreflightOnSubagentCall({
      chain: [
        { agent: "phase-spec", task: "work_item_id: GATE-4\nwrite spec" },
        { agent: "phase-plan", task: "work_item_id: GATE-4\nwrite plan" },
      ],
    });
    expect(r.blockReason).toMatch(/Brief required before spec/);
  });

  test("chain phase-spec then phase-plan succeeds when brief and spec exist", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, ".tasks"), { recursive: true });
    mkdirSync(join(project, "docs", "dev", "GATE-5"), { recursive: true });
    writeFileSync(join(project, "docs", "dev", "GATE-5", "brief.md"), "# Problem Brief\n\nBody.\n");
    writeFileSync(
      join(project, "docs", "dev", "GATE-5", "spec.json"),
      `${JSON.stringify(
        {
          schema_version: "1.0",
          work_item_id: "GATE-5",
          title: "Gate chain ok",
          date: "2026-05-27",
          problem_statement: "Problem",
          proposed_solution: "Solution",
          acceptance_criteria: [
            { id: "AC-1", requirement: "MUST", type: "constraint", criterion: "Works" },
          ],
          scope: { in: ["src"], out: [] },
          verification: { commands: ["bun test"], test_cases: [] },
        },
        null,
        2,
      )}\n`,
    );
    devBootstrap("GATE-5", "Chain ok", "implement", "standard");

    const { runPipelineArtifactPreflightOnSubagentCall } = await import(
      "@clive.shirley/accord-core/subagent/preflight/pipeline-artifacts.js"
    );
    const r = await runPipelineArtifactPreflightOnSubagentCall({
      chain: [
        { agent: "phase-spec", task: "work_item_id: GATE-5\nwrite spec" },
        { agent: "phase-plan", task: "work_item_id: GATE-5\nwrite plan" },
      ],
    });
    expect(r.blockReason).toBeUndefined();
  });
});

describe("phase-align post-result", () => {
  test("advances to speccing when brief on disk", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, "docs", "dev", "ALN-1"), { recursive: true });
    writeFileSync(join(project, "docs", "dev", "ALN-1", "brief.md"), "# Brief\n\nAligned.\n");
    devBootstrap("ALN-1", "Align done", "implement", "standard");

    const { applyPhaseAlignPostResult } = await import(
      "@clive.shirley/accord-core/orchestration/post-result/phase-align.js"
    );
    const out = applyPhaseAlignPostResult("ALN-1", {
      status: "done",
      brief_path: "docs/dev/ALN-1/brief.md",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(out).toMatch(/Brief recorded/);
    expect(out).toMatch(/speccing/);

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "ALN-1.json"), "utf8"));
    expect(wi.phase).toBe("speccing");
    expect(wi.brief).toBe("docs/dev/ALN-1/brief.md");
  });

  test("needs_input promotes reflections to decisions[] and writes a checkpoint", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("ALN-2", "Align reflect", "implement", "standard");

    const { applyPhaseAlignPostResult } = await import(
      "@clive.shirley/accord-core/orchestration/post-result/phase-align.js"
    );
    const out = applyPhaseAlignPostResult("ALN-2", {
      status: "needs_input",
      brief: { core_problem: "draft" },
      markers: [{ id: "m1", claim: "Users need X", status: "proposed" }],
      reflections: [
        { id: "r1", type: "probe", text: "Is X the right scope, or should it include Y?" },
      ],
      convergence: { round: 1, converged: false },
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(out).toMatch(/needs your input/);
    expect(out).toContain("r1");

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "ALN-2.json"), "utf8"));
    expect(wi.phase).toBe("aligning");
    expect(wi.decisions).toHaveLength(1);
    expect(wi.decisions[0]).toMatchObject({ id: "r1", status: "pending", source: "align" });

    const cp = JSON.parse(readFileSync(join(project, ".tasks", "ALN-2-checkpoint.json"), "utf8"));
    expect(cp.phase).toBe("aligning");
    expect(cp.pending).toEqual(["r1"]);
    expect(cp.draft.brief).toEqual({ core_problem: "draft" });
    expect(cp.draft.markers).toEqual([{ id: "m1", claim: "Users need X", status: "proposed" }]);
  });
});

describe("phase-spec post-result", () => {
  test("advances to planning and writes spec.md when spec.json on disk", async () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(join(project, "docs", "dev", "SPC-1"), { recursive: true });
    writeFileSync(
      join(project, "docs", "dev", "SPC-1", "spec.json"),
      `${JSON.stringify(
        {
          schema_version: "1.0",
          work_item_id: "SPC-1",
          title: "Spec done",
          date: "2026-05-27",
          problem_statement: "Problem",
          proposed_solution: "Solution",
          acceptance_criteria: [
            { id: "AC-1", requirement: "MUST", type: "constraint", criterion: "Works" },
          ],
          scope: { in: ["src"], out: [] },
          verification: { commands: ["bun test"], test_cases: [] },
        },
        null,
        2,
      )}\n`,
    );
    devBootstrap("SPC-1", "Spec path", "implement", "standard");
    const wiBefore = JSON.parse(readFileSync(join(project, ".tasks", "SPC-1.json"), "utf8"));
    wiBefore.phase = "speccing";
    writeFileSync(join(project, ".tasks", "SPC-1.json"), `${JSON.stringify(wiBefore, null, 2)}\n`);

    const { applyPhaseSpecPostResult } = await import(
      "@clive.shirley/accord-core/orchestration/post-result/phase-spec.js"
    );
    const out = applyPhaseSpecPostResult("SPC-1", {
      status: "done",
      spec_path: "docs/dev/SPC-1/spec.json",
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    expect(out).toMatch(/Spec recorded/);
    expect(out).toMatch(/spec\.md/);
    expect(out).toMatch(/planning/);
    expect(existsSync(join(project, "docs", "dev", "SPC-1", "spec.md"))).toBe(true);

    const wi = JSON.parse(readFileSync(join(project, ".tasks", "SPC-1.json"), "utf8"));
    expect(wi.phase).toBe("planning");
    expect(wi.spec).toBe("docs/dev/SPC-1/spec.json");
  });
});

describe("dev artifact scope (monorepo app cwd)", () => {
  function markGitRoot(dir: string): void {
    mkdirSync(join(dir, ".git"), { recursive: true });
  }

  test("ignores repo-root brief when cwd is a nested app package", async () => {
    const repo = tempProject();
    markGitRoot(repo);
    const appDir = join(repo, "apps", "portal");
    mkdirSync(appDir, { recursive: true });
    mkdirSync(join(repo, "docs", "dev", "APP-1"), { recursive: true });
    writeFileSync(
      join(repo, "docs", "dev", "APP-1", "brief.md"),
      "# Root brief\n\nShould not satisfy app-scoped gates.\n",
    );
    mkdirSync(join(appDir, ".tasks"), { recursive: true });
    process.chdir(appDir);
    devBootstrap("APP-1", "App scoped", "implement", "standard");

    const { checkBriefPresentForSpeccing } = await import(
      "@clive.shirley/accord-core/subagent/preflight/pipeline-artifacts.js"
    );
    const missing = checkBriefPresentForSpeccing("APP-1");
    expect(missing.ok).toBe(false);

    mkdirSync(join(appDir, "docs", "dev", "APP-1"), { recursive: true });
    writeFileSync(
      join(appDir, "docs", "dev", "APP-1", "brief.md"),
      "# App brief\n\nScoped to apps/portal.\n",
    );
    const present = checkBriefPresentForSpeccing("APP-1");
    expect(present.ok).toBe(true);
    if (present.ok) {
      expect(present.path.replace(/\\/g, "/")).toMatch(
        /apps\/portal\/docs\/dev\/APP-1\/brief\.md$/,
      );
    }
  });

  test("resolveDevArtifactPathForId does not walk to repo root from nested cwd", async () => {
    const repo = tempProject();
    markGitRoot(repo);
    const appDir = join(repo, "apps", "portal");
    mkdirSync(appDir, { recursive: true });
    mkdirSync(join(repo, "docs", "dev", "APP-2"), { recursive: true });
    writeFileSync(join(repo, "docs", "dev", "APP-2", "brief.md"), "# Root\n\nOnly at root.\n");
    process.chdir(appDir);

    const { resolveDevArtifactPathForId } = await import(
      "@clive.shirley/accord-core/work-items/artifact-discovery.js"
    );
    expect(resolveDevArtifactPathForId("APP-2", "brief")).toBe("docs/dev/APP-2/brief.md");
    expect(existsSync(join(appDir, "docs", "dev", "APP-2", "brief.md"))).toBe(false);
  });
});
