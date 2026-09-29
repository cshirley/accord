/**
 * Seed v2 task files from the work item's spec/plan on disk.
 */

import { type PlanTaskStep, planTaskPipelineProfile } from "../plan/task-pipeline-profile.js";
import { loadWorkItem, now, readJson } from "../work-items/io.js";
import { type SpecAcceptanceCriterion, type SpecTestCase, seedTaskFile } from "./model.js";
import type { QuickFixContract, TaskFileV2, TaskPipelinePhase } from "./types.js";

interface PlanTaskRecord {
  id?: unknown;
  title?: unknown;
  covers_ac?: unknown;
  steps?: PlanTaskStep[];
}

interface SpecRecord {
  acceptance_criteria?: SpecAcceptanceCriterion[];
  verification?: { test_cases?: SpecTestCase[] };
}

export interface SeedFromDiskInput {
  workItemId: string;
  taskId: number;
  ownerNonce: string;
  /** Override the plan-derived initial phase (quick fix / phase-code bootstrap). */
  initialPhase?: TaskPipelinePhase;
  preImplGates?: "pending" | "complete";
  quickFixContract?: QuickFixContract;
  /** Plan task record when the caller already loaded it. */
  planTask?: PlanTaskRecord;
}

export function seedTaskFromDisk(input: SeedFromDiskInput): TaskFileV2 {
  const wi = loadWorkItem(input.workItemId);
  const planPath = wi?.plan ?? null;
  const specPath = wi?.spec ?? null;
  const plan = planPath ? readJson<{ tasks?: PlanTaskRecord[] }>(planPath) : null;
  const spec = specPath ? readJson<SpecRecord>(specPath) : null;
  const planTask =
    input.planTask ?? plan?.tasks?.find((task) => Number(task.id) === input.taskId) ?? undefined;
  const profile = planTaskPipelineProfile(planTask?.steps);
  const planIndex = planTask ? (plan?.tasks ?? []).indexOf(planTask) : -1;
  const coversAc = Array.isArray(planTask?.covers_ac)
    ? planTask.covers_ac.filter((id): id is string => typeof id === "string")
    : [];
  const title =
    typeof planTask?.title === "string" && planTask.title.trim()
      ? planTask.title
      : input.quickFixContract
        ? input.quickFixContract.plan.summary
        : (wi?.title ?? `Task ${String(input.taskId)}`);

  return seedTaskFile({
    workItemId: input.workItemId,
    taskId: input.taskId,
    title,
    planPath: planPath && planIndex >= 0 ? `${planPath}#/tasks/${String(planIndex)}` : planPath,
    specPath,
    coversAc,
    acceptanceCriteria: spec?.acceptance_criteria ?? [],
    testCases: spec?.verification?.test_cases ?? [],
    ownerNonce: input.ownerNonce,
    initialPhase: input.initialPhase ?? profile.initialPhase,
    preImplGates: input.preImplGates ?? profile.preImplGates,
    ...(input.quickFixContract ? { quickFixContract: input.quickFixContract } : {}),
    at: now(),
  });
}
