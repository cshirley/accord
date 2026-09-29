import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  finalizeTaskAgentReturn,
  markTaskAgentSpawned,
  recordTaskAgentReturn,
} from "@clive.shirley/accord-core/orchestration/task-agent-audit.js";
import {
  extractAnalysisFromAssistantText,
  extractAnalysisFromSubagentResult,
} from "@clive.shirley/accord-core/subagent/index.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import { readTaskFixture, writeTaskFixture } from "./helpers/task-fixture.js";

const WI = "AUD-1";

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-audit-"));
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
  writeFileSync(
    join(".tasks", `${WI}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      id: WI,
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: null,
      plan: null,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    })}\n`,
    "utf8",
  );
  writeTaskFixture({ workItemId: WI, taskId: 1, phase: "review-test", preImplGates: "complete" });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

const read = (): TaskFileV2 => readTaskFixture(WI, 1);

describe("task agent audit", () => {
  test("extractAnalysisFromAssistantText strips fenced JSON", () => {
    const text = [
      "## Check 1",
      "Adversarial impl found for AC-2.",
      "",
      "```json",
      '{"verdict":"issues","findings":[]}',
      "```",
    ].join("\n");
    expect(extractAnalysisFromAssistantText(text)).toContain("Adversarial impl");
    expect(extractAnalysisFromAssistantText(text)).not.toContain("verdict");
  });

  test("extractAnalysisFromSubagentResult reads last assistant message", () => {
    const analysis = extractAnalysisFromSubagentResult({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: 'Narrative.\n\n```json\n{"verdict":"clean","findings":[]}\n```' },
          ],
        },
      ],
    });
    expect(analysis).toBe("Narrative.");
  });

  test("markTaskAgentSpawned pins a ref and respawn after a crash reuses it", () => {
    const ref = markTaskAgentSpawned(WI, "review-test", 1);
    expect(ref).toBe("T1/review-test");
    let task = read();
    expect(task.control.in_flight?.ref).toBe("T1/review-test");
    expect(task.control.in_flight?.agent).toBe("review-test");
    expect(task.control.in_flight?.stage).toBe("spawned");
    expect(task.control.status).toBe("in_progress");

    // Respawn (e.g. after a harness crash before the return landed) reuses the same ref —
    // it must not open a second round or allocate `T1/review-test.2`.
    const respawnRef = markTaskAgentSpawned(WI, "review-test", 1);
    expect(respawnRef).toBe("T1/review-test");
    task = read();
    expect(task.control.in_flight?.stage).toBe("spawned");
    expect(task.log).toHaveLength(0);
  });

  test("recordTaskAgentReturn stages `returned` and writes the sidecar packet file", () => {
    markTaskAgentSpawned(WI, "review-test", 1);
    const packet = { verdict: "issues", findings: [{ severity: "critical", issue: "gap" }] };
    const ref = recordTaskAgentReturn(WI, "review-test", packet, "Full adversarial analysis.");
    expect(ref).toBe("T1/review-test");

    const task = read();
    expect(task.control.in_flight?.stage).toBe("returned");

    const sidecar = JSON.parse(
      readFileSync(join(".tasks", `${WI}-task-1`, "T1-review-test.json"), "utf8"),
    ) as { agent: string; ref: string; packet: unknown; analysis?: string };
    expect(sidecar.agent).toBe("review-test");
    expect(sidecar.ref).toBe("T1/review-test");
    expect(sidecar.packet).toEqual(packet);
    expect(sidecar.analysis).toBe("Full adversarial analysis.");
  });

  test("finalizeTaskAgentReturn logs an unapplied (stuck) return and clears in_flight", () => {
    markTaskAgentSpawned(WI, "review-test", 1);
    const packet = { status: "stuck", question: "Which AC does this cover?" };
    recordTaskAgentReturn(WI, "review-test", packet);

    // No post-result handler applied this return (e.g. a stuck packet) — finalize must log it
    // generically and release in_flight so resume is not wedged.
    finalizeTaskAgentReturn(WI, "review-test", packet, "Agent got stuck.");

    const task = read();
    expect(task.control.in_flight).toBeNull();
    expect(task.control.status).toBe("pending");
    expect(task.log).toHaveLength(1);
    expect(task.log[0]?.ref).toBe("T1/review-test");
    expect(task.log[0]?.result).toBe("stuck");
    expect(task.log[0]?.note).toContain("Which AC does this cover?");
  });

  test("finalizeTaskAgentReturn is a no-op once the post-result handler already logged the return", () => {
    markTaskAgentSpawned(WI, "review-test", 1);
    const packet = { verdict: "clean", findings: [] };
    recordTaskAgentReturn(WI, "review-test", packet);

    // Simulate the post-result handler having already recorded + cleared in_flight.
    let task = read();
    task.log.push({
      ref: "T1/review-test",
      at: "2026-01-01T00:00:01.000Z",
      result: "clean",
      note: "n/a",
    });
    task.control.in_flight = null;
    writeFileSync(join(".tasks", `${WI}-task-1.json`), `${JSON.stringify(task)}\n`);

    finalizeTaskAgentReturn(WI, "review-test", packet);
    task = read();
    expect(task.log).toHaveLength(1);
    expect(task.control.in_flight).toBeNull();
  });
});
