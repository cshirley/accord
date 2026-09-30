/**
 * Task-pipeline agent returns are persisted to disk before they are validated or applied, so an
 * invalid packet, a missing packet, or a crash never loses the agent's work:
 * - brief task_id / owner_nonce are parsed from the embedded JSON payload
 * - every host pins `in_flight {stage: spawned}` before spawn (shared preflight)
 * - raw packet sidecar is written before validation; invalid packets are logged, not dropped
 * - malformed `events[]` entries are quarantined instead of rejecting the whole packet
 * - crash recovery never applies a sidecar that was not validated
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateReturnQuarantiningEvents } from "@clive.shirley/accord-core/artifacts/validation.js";
import { formatImplementSpawnTaskBrief } from "@clive.shirley/accord-core/briefing/task-requirements.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import {
  prepareWorkflowStateBeforeSpawn,
  prepareWorkflowStateForSubagentInput,
  processSubagentToolResult,
} from "@clive.shirley/accord-core/harness/index.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/harness/types.js";
import { recoverReturnedInFlight } from "@clive.shirley/accord-core/orchestration/recover-task-packet.js";
import {
  markTaskAgentSpawned,
  recordTaskAgentReturn,
} from "@clive.shirley/accord-core/orchestration/task-agent-audit.js";
import {
  extractTaskIdFromTaskText,
  loadPricing,
} from "@clive.shirley/accord-core/telemetry/usage.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

const WI = "PER-1";
let project: string;
const originalCwd = process.cwd();

function state(devConfig: DevHarnessConfig | null = null): HarnessMutableState {
  return { devConfig, costCache: new Map(), sessionCost: 0, activeWorkItem: null };
}

function setTaskIds(ids: number[]): void {
  const wiPath = join(project, ".tasks", `${WI}.json`);
  const wi = JSON.parse(readFileSync(wiPath, "utf8")) as { task_ids: number[] };
  wi.task_ids = ids;
  writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`, "utf8");
}

/** JSON-payload brief, shaped like `formatImplementSpawnTaskBrief` output before the fix. */
function jsonOnlyBrief(taskId: number, nonce: string): string {
  return [
    "## phase-test",
    "",
    `**work_item_id:** ${WI}`,
    "```json",
    JSON.stringify({ work_item_id: WI, task_id: taskId, owner_nonce: nonce }, null, 2),
    "```",
  ].join("\n");
}

function sidecar(taskId: number, name: string): string {
  return join(project, ".tasks", `${WI}-task-${String(taskId)}`, name);
}

async function processText(agent: string, task: string, text: string): Promise<string> {
  return processSubagentToolResult({
    details: {
      results: [
        {
          agent,
          task,
          exitCode: 0,
          messages: [{ role: "assistant", content: [{ type: "text", text }] }],
        },
      ],
    },
    state: state(),
    pricing: loadPricing(),
  });
}

const fenced = (payload: unknown): string =>
  `\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "accord-persist-"));
  process.chdir(project);
  devBootstrap(WI, "persistence", "implement", "express");
  setTaskIds([1]);
  writeTaskFixture(
    { workItemId: WI, taskId: 1, ownerNonce: "abcdef", phase: "phase-test" },
    project,
  );
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(project, { recursive: true, force: true });
});

describe("brief identity parsing", () => {
  test("extractTaskIdFromTaskText reads the JSON payload task_id", () => {
    expect(extractTaskIdFromTaskText(jsonOnlyBrief(3, "abcdef"))).toBe(3);
    expect(extractTaskIdFromTaskText("- task_id: 4")).toBe(4);
  });

  test("formatImplementSpawnTaskBrief emits task_id and owner_nonce header lines", () => {
    const brief = formatImplementSpawnTaskBrief({
      agent: "phase-test",
      pattern: "implement",
      phase: "implementing",
      title: "t",
      slice: {
        work_item_id: WI,
        task_id: 2,
        owner_nonce: "123abc",
        test_files: [],
        stub_files: [],
      } as never,
    });
    expect(brief).toContain("**task_id:** 2");
    expect(brief).toContain("**owner_nonce:** 123abc");
    expect(extractTaskIdFromTaskText(brief)).toBe(2);
  });

  test("prepareWorkflowStateBeforeSpawn marks the brief's task (not task 1) and keeps its nonce", () => {
    setTaskIds([1, 2]);
    writeTaskFixture(
      { workItemId: WI, taskId: 2, ownerNonce: "fedcba", phase: "phase-test" },
      project,
    );

    const prep = prepareWorkflowStateBeforeSpawn({
      agent: "phase-test",
      task: jsonOnlyBrief(2, "fedcba"),
      devConfig: null,
    });

    expect(prep).toEqual({ ok: true });
    const task2 = readTaskFixture(WI, 2, project);
    expect(task2.control.in_flight?.stage).toBe("spawned");
    expect(task2.control.owner_nonce).toBe("fedcba");
    expect(readTaskFixture(WI, 1, project).control.in_flight).toBeNull();
  });
});

describe("spawn marker for every host", () => {
  test("prepareWorkflowStateForSubagentInput pins in_flight for a single `subagent` payload", () => {
    const prep = prepareWorkflowStateForSubagentInput(
      { agent: "phase-test", task: jsonOnlyBrief(1, "abcdef") },
      null,
    );
    expect(prep).toEqual({ ok: true });
    const task = readTaskFixture(WI, 1, project);
    expect(task.control.in_flight).toMatchObject({ agent: "phase-test", stage: "spawned" });
    expect(task.control.status).toBe("in_progress");
  });

  test("prepareWorkflowStateForSubagentInput walks parallel `tasks[]` entries", () => {
    prepareWorkflowStateForSubagentInput(
      { tasks: [{ agent: "phase-test", task: jsonOnlyBrief(1, "abcdef") }] },
      null,
    );
    expect(readTaskFixture(WI, 1, project).control.in_flight?.stage).toBe("spawned");
  });
});

describe("return persistence", () => {
  test("invalid packet: raw sidecar kept (validated=false), run logged, in_flight released", async () => {
    markTaskAgentSpawned(WI, "phase-test", 1);
    // No `usage` and no host usage to backfill from → schema-invalid.
    const packet = { status: "done", test_files: ["src/a.test.ts"], red_confirmed: true };

    const out = await processText("phase-test", jsonOnlyBrief(1, "abcdef"), fenced(packet));

    expect(out).toContain("Return packet validation failed");
    expect(out).toContain("invalid_packet");
    const saved = JSON.parse(readFileSync(sidecar(1, "T1-phase-test.json"), "utf8")) as {
      packet: unknown;
      validated: boolean;
      validation_errors: string[];
    };
    expect(saved.packet).toEqual(packet);
    expect(saved.validated).toBe(false);
    expect(saved.validation_errors.length).toBeGreaterThan(0);

    const task = readTaskFixture(WI, 1, project);
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.in_flight).toBeNull();
    expect(task.control.status).toBe("pending");
    expect(task.log.at(-1)).toMatchObject({ ref: "T1/phase-test", result: "invalid_packet" });

    // Respawn gets a fresh ref instead of overwriting the rejected run's sidecar.
    expect(markTaskAgentSpawned(WI, "phase-test", 1)).not.toBe("T1/phase-test");
  });

  test("malformed event is dropped; the rest of the packet is applied", async () => {
    markTaskAgentSpawned(WI, "phase-test", 1);
    const packet = {
      status: "done",
      test_files: ["src/a.test.ts"],
      red_confirmed: true,
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      events: [{ type: "deviation", description: "no at", reason: "r" }],
    };

    const out = await processText("phase-test", jsonOnlyBrief(1, "abcdef"), fenced(packet));

    expect(out).not.toContain("Return packet validation failed");
    expect(out).toContain("Dropped 1 malformed");
    const task = readTaskFixture(WI, 1, project);
    expect(task.control.phase).toBe("review-test");
    const entry = task.log.find((e) => e.ref === "T1/phase-test");
    expect(entry?.warnings?.join(" ")).toContain("malformed event");
    const saved = JSON.parse(readFileSync(sidecar(1, "T1-phase-test.json"), "utf8")) as {
      validated: boolean;
      dropped_events: unknown[];
    };
    expect(saved.validated).toBe(true);
    expect(saved.dropped_events).toHaveLength(1);
  });

  test("validateReturnQuarantiningEvents keeps valid events", async () => {
    const packet: Record<string, unknown> = {
      status: "done",
      test_files: ["a"],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      events: [
        { type: "deviation", at: "2026-01-01T00:00:00Z", description: "d", reason: "r" },
        { type: "deviation", description: "missing at" },
      ],
    };
    const result = await validateReturnQuarantiningEvents("phase-test", packet);
    expect(result.valid).toBe(true);
    expect(result.droppedEvents).toHaveLength(1);
    expect(packet.events as unknown[]).toHaveLength(1);
  });

  test("missing packet: agent output saved beside the in-flight ref, in_flight kept for respawn", async () => {
    markTaskAgentSpawned(WI, "phase-test", 1);

    const out = await processText(
      "phase-test",
      jsonOnlyBrief(1, "abcdef"),
      "Wrote tests; ran suite; 8 failed. (forgot the packet)",
    );

    expect(out).toContain("T1-phase-test.no-packet.txt");
    expect(readFileSync(sidecar(1, "T1-phase-test.no-packet.txt"), "utf8")).toContain("8 failed");
    const task = readTaskFixture(WI, 1, project);
    expect(task.control.in_flight).toMatchObject({ ref: "T1/phase-test", stage: "spawned" });
  });

  test("crash recovery does not apply a sidecar that was never validated", () => {
    markTaskAgentSpawned(WI, "phase-test", 1);
    recordTaskAgentReturn(
      WI,
      "phase-test",
      { status: "done", test_files: ["a"], red_confirmed: true },
      undefined,
      { validated: false },
    );

    expect(recoverReturnedInFlight(WI, null, 1)).toBe("");
    expect(readTaskFixture(WI, 1, project).control.phase).toBe("phase-test");
    expect(existsSync(sidecar(1, "T1-phase-test.json"))).toBe(true);
  });
});
