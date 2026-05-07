import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devQuickFixBrief } from "../src/core/briefing/code-brief.js";
import { recommendIntentMode } from "../src/core/commands/intent.js";
import {
  normalizeHarnessRelativePath,
  isHarnessTrackedJsonWritePath,
  isAgentsMdPath,
  formatArtifactValidationFailureMessage,
  validateHarnessArtifactWriteIfApplicable,
  collectSubagentEntries,
  firstSubagentAgentName,
  getPrimarySubagentEntry,
  prepareSubagentToolCall,
  processSubagentToolResult,
  runGatherPreflightOnSubagentCall,
  runVerifyPreflightOnSubagentCall,
  createOrchestratorUsageDedup,
  rememberOrchestratorFingerprint,
  processOrchestratorTurnEnd,
  seedHarnessSessionCostState,
  applyHarnessCostSeed,
  notifyPendingDecisionsIfAny,
} from "../src/core/harness/index.js";
import type { DevHarnessConfig } from "../src/core/config/types.js";
import type { HarnessMutableState } from "../src/core/harness/types.js";
import { devBootstrap } from "../src/core/work-items/lifecycle.js";
import { loadPricing } from "../src/core/telemetry/usage.js";

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

afterEach(() => {
  process.chdir(originalCwd);
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("harness paths", () => {
  test("normalizeHarnessRelativePath strips prefix to .tasks or docs", () => {
    expect(normalizeHarnessRelativePath("/repo/.tasks/FOO-1.json")).toBe(".tasks/FOO-1.json");
    expect(normalizeHarnessRelativePath("/repo/docs/dev/FOO-1/spec.json")).toBe("docs/dev/FOO-1/spec.json");
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
    expect(firstSubagentAgentName({ chain: [{ agent: "phase-gather", task: "y" }] })).toBe("phase-gather");
    expect(getPrimarySubagentEntry({ tasks: [{ agent: "z", task: "q" }] })).toEqual({ agent: "z", task: "q" });
  });
});

describe("harness subagent-prepare", () => {
  test("blocks phase-code when devConfig is null", () => {
    const input: Record<string, unknown> = { agent: "phase-code", task: "Do work" };
    expect(prepareSubagentToolCall(input, null).blockReason).toMatch(/Run \/dev init/);
  });

  test("injects Project Stack when devConfig present", () => {
    const input: Record<string, unknown> = { agent: "phase-code", task: "TASK" };
    expect(prepareSubagentToolCall(input, sampleConfig()).blockReason).toBeUndefined();
    expect(String(input.task)).toContain("Project Stack");
  });

  test("remaps cursor-agent/ model prefix", () => {
    const input: Record<string, unknown> = {
      agent: "phase-align",
      task: "x",
      model: "cursor-agent/composer-2",
    };
    prepareSubagentToolCall(input, null);
    expect(input.model).toBe("composer-2");
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
    const res = await validateHarnessArtifactWriteIfApplicable(join(project, ".tasks", "BAD-1.json"));
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
    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
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

    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
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
    expect(state.costCache.get("USD-1")).toBeGreaterThanOrEqual(0);
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

    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
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
    expect(await runVerifyPreflightOnSubagentCall({ agent: "phase-code", task: "" }, null)).toEqual({});
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
    if ("error" in qf) throw new Error(qf.error);

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
    expect(await runGatherPreflightOnSubagentCall({ agent: "phase-code", task: "x" }, null, new Set(), {})).toEqual(
      {},
    );
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
  test("returns empty string when details.results missing", async () => {
    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    expect(
      await processSubagentToolResult({
        details: {},
        state,
        pricing: loadPricing(),
      }),
    ).toBe("");
  });

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

  test("injects validated phase-code return packet from assistant fenced JSON", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PKP-1", "Packet test", "quick_fix", undefined, quickFixIntent());

    const body = `Summary\n\`\`\`json\n${JSON.stringify(validPhaseCodePacket, null, 2)}\n\`\`\``;
    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-code",
            task: "Implement PKP-1",
            messages: [{ role: "assistant", content: [{ type: "text", text: body }] }],
          },
        ],
      },
      state,
      pricing: loadPricing(),
    });
    expect(out).toContain("phase-code Return Packet");
    expect(out).toContain('"status": "done"');
    expect(out).not.toContain("Return packet validation failed");
  });

  test("surfaces invalid return packet against phase-code schema", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PKP-INV-1", "Invalid packet", "quick_fix", undefined, quickFixIntent());

    const badPacket = {
      status: "done",
      files_changed: [],
      tests_passing: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    const body = `\`\`\`json\n${JSON.stringify(badPacket, null, 2)}\n\`\`\``;
    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-code",
            task: "PKP-INV-1",
            messages: [{ role: "assistant", content: [{ type: "text", text: body }] }],
          },
        ],
      },
      state,
      pricing: loadPricing(),
    });
    expect(out).toContain("Return packet validation failed");
  });

  test("detects empty assistant response for a phase agent", async () => {
    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
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
      state,
      pricing: loadPricing(),
    });
    expect(out).toContain("empty response");
    expect(out).toContain("phase-code");
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
    const body = `\`\`\`json\n${JSON.stringify(validPhaseCodePacket, null, 2)}\n\`\`\``;
    const state: HarnessMutableState = {
      devConfig: cfg,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
    const out = await processSubagentToolResult({
      details: {
        results: [
          {
            agent: "phase-code",
            task: "PKP-PC-1",
            messages: [{ role: "assistant", content: [{ type: "text", text: body }] }],
          },
        ],
      },
      state,
      pricing: loadPricing(),
    });
    expect(out).toContain("Post-Code Verification");
    expect(out).toMatch(/exit 0/);
  });

  test("appends usage line when subagent reports billable usage", async () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("USG-1", "Usage", "quick_fix", undefined, quickFixIntent());

    const state: HarnessMutableState = {
      devConfig: null,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    };
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
      state,
      pricing: loadPricing(),
    });
    const jsonl = join(project, ".tasks", "USG-1-usage.jsonl");
    expect(existsSync(jsonl)).toBe(true);
    const line = readFileSync(jsonl, "utf8").trim().split("\n").pop();
    expect(line).toContain("USG-1");
    expect(line).toContain("subagent");
  });
});
