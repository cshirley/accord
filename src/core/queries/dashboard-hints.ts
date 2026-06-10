/**
 * Read-only resume / artifact / cost hints for the tasks dashboard.
 * Avoids hydration, bootstrap, and orchestration side effects.
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import { getAgentMeta } from "../agents/registry.js";
import {
  isWorkItemPattern,
  resolveResumeAgentId,
} from "../orchestration/phase-coarse-routing.js";
import { resolveActivePrimaryTaskId } from "../orchestration/post-result/primary-task.js";
import { isResumablePipelineTaskPhase } from "../types/phases.js";
import {
  artifactLooksComplete,
  artifactPathForWorkItem,
  preferredDevArtifactRelPath,
  type ArtifactKind,
} from "../work-items/artifact-discovery.js";
import { loadTaskFile } from "../work-items/io.js";
import type { WorkItem } from "../work-items/types.js";
import { buildWorkflowCostReport } from "./workflow-cost.js";

export function missingArtifactsForWorkItem(wi: WorkItem): string[] {
  const missing: string[] = [];
  const expect = (kind: ArtifactKind) => {
    const configured = kind === "brief" ? wi.brief : kind === "spec" ? wi.spec : wi.plan;
    const rel = configured?.trim()
      ? artifactPathForWorkItem(wi.id, kind, configured)
      : preferredDevArtifactRelPath(wi.id, kind);
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    if (!artifactLooksComplete(kind, abs, wi.id)) {
      missing.push(kind);
    }
  };

  switch (wi.phase) {
    case "aligning":
      expect("brief");
      break;
    case "speccing":
      expect("spec");
      break;
    case "planning":
      expect("spec");
      expect("plan");
      break;
    case "implementing":
    case "fixing":
      expect("plan");
      if (wi.pattern === "implement") expect("spec");
      break;
    case "verifying":
      expect("spec");
      expect("plan");
      if (wi.verify?.trim()) {
        const verifyPath = path.isAbsolute(wi.verify)
          ? wi.verify
          : path.join(process.cwd(), wi.verify);
        if (!existsSync(verifyPath)) missing.push("verify");
      } else {
        missing.push("verify");
      }
      break;
    default:
      break;
  }

  return missing;
}

export function isFinishReady(workItemId: string, wi: WorkItem): boolean {
  if (wi.completed_at) return false;
  if (wi.pattern !== "implement" || wi.phase !== "implementing") return false;
  const ids = wi.task_ids ?? [];
  if (ids.length === 0) return false;
  return ids.every((taskId) => {
    const task = loadTaskFile(workItemId, String(taskId));
    return task?.status === "done" || task?.status === "blocked";
  });
}

/** Resume agent id without rehydrate, bootstrap, or plan reconciliation. */
export function resolveReadOnlyResumeAgent(workItemId: string, wi: WorkItem): string | null {
  if (wi.completed_at) return null;

  if (isWorkItemPattern(wi.pattern)) {
    const coarse = resolveResumeAgentId(wi.phase, wi.pattern);
    if (coarse) return coarse;
  }

  const coarseGate =
    wi.pattern === "implement"
      ? "implementing"
      : wi.pattern === "quick_fix"
        ? "fixing"
        : null;
  if (!coarseGate || wi.phase !== coarseGate) {
    return null;
  }

  const primaryTaskId = resolveActivePrimaryTaskId(wi);
  if (primaryTaskId === null) {
    return null;
  }
  const task = loadTaskFile(workItemId, String(primaryTaskId));
  if (!task || task.status === "blocked" || task.status === "done") {
    return null;
  }

  let phase = task.phase;
  if (phase === "phase-code" && task.pre_impl_gates !== "complete") {
    phase = "review-test";
  }
  if (typeof phase === "string" && isResumablePipelineTaskPhase(phase) && getAgentMeta(phase)) {
    return phase;
  }
  return null;
}

export function resolveDashboardActionHint(
  workItemId: string,
  wi: WorkItem,
  attention: { pending_decisions: number; pending_deviations: number },
): string | null {
  if (wi.completed_at) return null;

  if (attention.pending_decisions > 0 || attention.pending_deviations > 0) {
    return "→ review";
  }
  if (isFinishReady(workItemId, wi)) {
    return "→ finish";
  }
  const agent = resolveReadOnlyResumeAgent(workItemId, wi);
  if (agent) {
    return `→ resume (${agent})`;
  }
  return null;
}

export function resolveUsageCostUsd(workItemId: string): number | null {
  const report = buildWorkflowCostReport(workItemId);
  if (!report || report.rows.length === 0) return null;
  return report.total_cost_usd;
}
