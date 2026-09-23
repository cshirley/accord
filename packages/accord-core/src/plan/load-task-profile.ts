/**
 * Resolve a plan task's pipeline profile from the work item's plan.json on disk.
 */

import { loadWorkItem, readJson } from "../work-items/io.js";
import {
  type PlanTaskPipelineProfile,
  type PlanTaskStep,
  planTaskPipelineProfile,
  verifyStepDescriptions,
} from "./task-pipeline-profile.js";

interface PlanTaskRecord {
  id?: number;
  steps?: PlanTaskStep[];
}

interface PlanArtifactTasks {
  tasks?: PlanTaskRecord[];
}

export interface ResolvedPlanTaskProfile {
  profile: PlanTaskPipelineProfile;
  verifySteps: string[];
}

export function resolvePlanTaskProfile(
  workItemId: string,
  taskId: number,
): ResolvedPlanTaskProfile | null {
  const wi = loadWorkItem(workItemId);
  if (!wi?.plan) {
    return null;
  }
  const plan = readJson<PlanArtifactTasks>(wi.plan);
  const task = plan?.tasks?.find((t) => t.id === taskId);
  if (!task) {
    return null;
  }
  const steps = task.steps;
  return {
    profile: planTaskPipelineProfile(steps),
    verifySteps: verifyStepDescriptions(steps),
  };
}
