/**
 * v2 per-task file fixtures for tests.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { refreshTask, seedTaskFile } from "@clive.shirley/accord-core/tasks/model.js";
import type {
  LogEntry,
  QuickFixContract,
  Requirement,
  TaskBlock,
  TaskFileV2,
  TaskPipelinePhase,
  TaskRetries,
  TaskStatus,
} from "@clive.shirley/accord-core/tasks/types.js";

export interface TaskFixtureInput {
  workItemId: string;
  taskId: number;
  ownerNonce?: string;
  phase?: TaskPipelinePhase;
  status?: TaskStatus;
  preImplGates?: "pending" | "complete";
  round?: string;
  coversAc?: string[];
  acText?: Record<string, string>;
  testCases?: Record<string, string[]>;
  testFiles?: string[];
  stubFiles?: string[];
  retries?: Partial<Omit<TaskRetries, "unblocks">> & { unblocks?: number };
  blocked?: TaskBlock | null;
  quickFixContract?: QuickFixContract;
  requirements?: Requirement[];
  log?: LogEntry[];
}

export function taskFixture(input: TaskFixtureInput): TaskFileV2 {
  const coversAc = input.coversAc ?? ["AC-1"];
  const phase = input.phase ?? "phase-test";
  const task = seedTaskFile({
    workItemId: input.workItemId,
    taskId: input.taskId,
    title: `task ${String(input.taskId)}`,
    planPath: null,
    specPath: null,
    coversAc: input.quickFixContract ? [] : coversAc,
    acceptanceCriteria: coversAc.map((id) => ({
      id,
      requirement: "MUST",
      scenario: input.acText?.[id] ?? `${id} behaviour`,
    })),
    testCases: Object.entries(input.testCases ?? {}).flatMap(([ac, tcs]) =>
      tcs.map((tc) => ({ id: tc, covers: ac })),
    ),
    ownerNonce: input.ownerNonce ?? "abcdef",
    initialPhase: phase,
    preImplGates: input.preImplGates ?? (phase === "phase-test" ? "pending" : "complete"),
    ...(input.quickFixContract ? { quickFixContract: input.quickFixContract } : {}),
    at: "2026-01-01T00:00:00.000Z",
  });
  const { control } = task;
  if (input.status) control.status = input.status;
  if (input.round) control.round = input.round;
  if (input.testFiles) control.test_files = input.testFiles;
  if (input.stubFiles) control.stub_files = input.stubFiles;
  if (input.blocked !== undefined) control.blocked = input.blocked;
  if (input.retries) {
    const { unblocks, ...counters } = input.retries;
    Object.assign(control.retries, counters);
    if (unblocks !== undefined) control.retries.unblocks = unblocks;
  }
  if (input.requirements) task.requirements = input.requirements;
  if (input.log) task.log = input.log;
  refreshTask(task, "2026-01-01T00:00:00.000Z");
  return task;
}

export function taskFixturePath(workItemId: string, taskId: number, cwd = "."): string {
  return join(cwd, ".tasks", `${workItemId}-task-${String(taskId)}.json`);
}

export function writeTaskFixture(input: TaskFixtureInput, cwd = "."): TaskFileV2 {
  const task = taskFixture(input);
  mkdirSync(join(cwd, ".tasks"), { recursive: true });
  writeFileSync(
    taskFixturePath(input.workItemId, input.taskId, cwd),
    `${JSON.stringify(task, null, 2)}\n`,
  );
  return task;
}

export function readTaskFixture(workItemId: string, taskId = 1, cwd = "."): TaskFileV2 {
  return JSON.parse(readFileSync(taskFixturePath(workItemId, taskId, cwd), "utf8")) as TaskFileV2;
}

/** Blocked retry-cap state for `loop`. */
export function capBlock(loop: TaskBlock["loop"], reason = "retry cap reached"): TaskBlock {
  return { kind: "cap", reason, ref: "T1/decision", loop };
}
