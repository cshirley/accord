/**
 * Engineer actions on plan deviations (`/dev deviations accept|revert`).
 */

import * as path from "node:path";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, readJson, writeJson } from "../work-items/io.js";
import type { Deviation, WorkItem } from "../work-items/types.js";

interface PlanFile {
  guidance?: { directive: string; source: string; question?: string }[];
  [key: string]: unknown;
}

function findDeviation(wi: WorkItem, taskId: number): Deviation | undefined {
  return wi.deviations?.find((d) => d.task_id === taskId);
}

function touchWorkItem(wi: WorkItem): void {
  wi.updated = new Date().toISOString();
  writeJson(path.join(".tasks", `${wi.id}.json`), wi);
}

export function acceptDeviation(workItemId: string, taskId: number): Result<{ formatted: string }> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const deviation = findDeviation(wi, taskId);
  if (!deviation) return err(`No deviation for task ${String(taskId)} on ${workItemId}.`);

  if (deviation.resolution === "accepted") {
    return ok({
      formatted: `${workItemId}: task ${String(taskId)} deviation already accepted.`,
    });
  }

  const planPath = wi.plan?.trim();
  if (!planPath) return err(`Work item ${workItemId} has no plan path.`);

  const plan = readJson<PlanFile>(planPath);
  if (!plan) return err(`Plan not found: ${planPath}`);

  plan.guidance = plan.guidance ?? [];
  plan.guidance.push({
    directive: `Engineer accepted deviation (task ${String(taskId)}): ${deviation.description}`,
    source: "engineer-accepted-deviation",
  });
  writeJson(planPath, plan);

  deviation.resolution = "accepted";
  deviation.resolved_at = new Date().toISOString();
  touchWorkItem(wi);

  return ok({
    formatted: [
      `${workItemId}: accepted deviation for task ${String(taskId)}.`,
      `Recorded plan guidance in ${planPath}.`,
      "Resume implementation with `/dev resume` when ready.",
    ].join("\n"),
  });
}

export function revertDeviation(workItemId: string, taskId: number): Result<{ formatted: string }> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const deviation = findDeviation(wi, taskId);
  if (!deviation) return err(`No deviation for task ${String(taskId)} on ${workItemId}.`);

  deviation.resolution = "blocking";
  deviation.blocking_recommendation =
    "Engineer requested revert to plan-conformant implementation.";
  deviation.resolved_at = new Date().toISOString();
  touchWorkItem(wi);

  return ok({
    formatted: [
      `${workItemId}: marked task ${String(taskId)} deviation for revert.`,
      "Restore plan-conformant code for that task, then `/dev resume`.",
      deviation.description ? `Deviation: ${deviation.description}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}
