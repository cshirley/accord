/** Shared setup for review-security gate tests (ASDLC-1 task 15). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { stateFromHistory } from "@clive.shirley/accord-core/tasks/model.js";
import type { Finding } from "@clive.shirley/accord-core/tasks/types.js";
import { readTaskFixture, taskFixturePath, writeTaskFixture } from "./task-fixture.js";

export function baseConfig(extra: Record<string, unknown> = {}): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: [],
    ...extra,
  } as DevHarnessConfig;
}

export function setupTempWorkItem(id: string, prefix: string): { cleanup: () => void } {
  const originalCwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.chdir(dir);
  mkdirSync(".tasks", { recursive: true });
  writeFileSync(
    join(".tasks", `${id}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      id,
      title: "gate",
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
  );
  writeTaskFixture({
    workItemId: id,
    taskId: 1,
    phase: "review-security",
    preImplGates: "complete",
  });
  return {
    cleanup: () => {
      process.chdir(originalCwd);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function setPhase(id: string, phase: string): void {
  const task = readTaskFixture(id, 1);
  task.control.phase = phase as (typeof task)["control"]["phase"];
  task.control.status = "pending";
  writeFileSync(taskFixturePath(id, 1), `${JSON.stringify(task)}\n`);
}

export function allFindings(id: string): Finding[] {
  return readTaskFixture(id, 1).requirements.flatMap((req) => req.findings);
}

/** Simulate phase-code having fixed a finding: push a `fixed` history entry, recompute state. */
export function markFixed(id: string, findingId: string): void {
  const task = readTaskFixture(id, 1);
  let hit = false;
  for (const req of task.requirements) {
    for (const finding of req.findings) {
      if (finding.id !== findingId) continue;
      finding.history.push({ by: "C1/phase-code", outcome: "fixed", note: "fixed" });
      finding.state = stateFromHistory(finding.history);
      hit = true;
    }
  }
  if (!hit) throw new Error(`markFixed: ${findingId} not found`);
  writeFileSync(taskFixturePath(id, 1), `${JSON.stringify(task)}\n`);
}
