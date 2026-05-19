/**
 * Reconcile work-item coarse phase with artifacts already on disk.
 *
 * The core resume runner can spawn `phase-plan` (etc.) and exit 0 without the
 * subagent calling `dev_transition`. On the next plan (or replan after exit 0),
 * that would repeat the same spawn — `repeat_spawn`. When a final artifact exists
 * and there is no open checkpoint, advance the WI and bootstrap task files.
 */

import { existsSync } from "node:fs";
import { createLogger } from "../logging.js";
import { devCheckpointRead } from "../work-items/checkpoint.js";
import {
  artifactFileName,
  artifactLooksComplete,
  bootstrapImplementTasksFromPlan,
  resolveArtifactPath,
  type ArtifactKind,
} from "../work-items/artifact-discovery.js";
import { devTransition } from "../work-items/lifecycle.js";
import { loadWorkItem } from "../work-items/io.js";
import type { WorkItem } from "../work-items/types.js";

const log = createLogger("orchestration");

interface CoarseAdvanceRule {
  artifact: ArtifactKind;
  fileName: string;
  nextPhase: string;
  wiField: "brief" | "spec" | "plan";
  bootstrapTasks?: boolean;
}

/** implement/standard + implement/orchestrated coarse pipeline advances. */
const IMPLEMENT_COARSE_ADVANCE: Readonly<Record<string, CoarseAdvanceRule>> = {
  aligning: {
    artifact: "brief",
    fileName: artifactFileName("brief"),
    nextPhase: "speccing",
    wiField: "brief",
  },
  speccing: {
    artifact: "spec",
    fileName: artifactFileName("spec"),
    nextPhase: "planning",
    wiField: "spec",
  },
  planning: {
    artifact: "plan",
    fileName: artifactFileName("plan"),
    nextPhase: "implementing",
    wiField: "plan",
    bootstrapTasks: true,
  },
};

export interface ReconcileCoarsePhaseResult {
  advanced: boolean;
  fromPhase?: string;
  toPhase?: string;
  artifactPath?: string;
  tasksBootstrapped?: number;
}

function configuredArtifactPath(wi: WorkItem, kind: ArtifactKind): string | null {
  const configured =
    kind === "brief" ? wi.brief : kind === "spec" ? wi.spec : kind === "plan" ? wi.plan : null;
  return configured?.trim() ? configured : null;
}

function hasOpenCheckpoint(workItemId: string): boolean {
  const cp = devCheckpointRead(workItemId);
  if (!cp) return false;
  return Array.isArray(cp.pending) && cp.pending.length > 0;
}

/**
 * When coarse phase lags behind a complete artifact, advance the work item once.
 * Safe to call on every resume resolve; no-op when state already matches disk.
 */
export function reconcileCoarsePhaseBeforeResume(workItemId: string): ReconcileCoarsePhaseResult {
  const wi = loadWorkItem(workItemId);
  if (!wi || wi.completed_at) {
    return { advanced: false };
  }
  if (wi.pattern !== "implement") {
    return { advanced: false };
  }
  if (wi.variant === "express") {
    return { advanced: false };
  }

  const rule = IMPLEMENT_COARSE_ADVANCE[wi.phase];
  if (!rule) {
    return { advanced: false };
  }
  if (hasOpenCheckpoint(workItemId)) {
    return { advanced: false };
  }

  const artifactPath = resolveArtifactPath(wi, rule.artifact, rule.fileName);
  if (!artifactLooksComplete(rule.artifact, artifactPath, workItemId)) {
    return { advanced: false };
  }

  const configuredPath = configuredArtifactPath(wi, rule.artifact);
  if (configuredPath && configuredPath !== artifactPath && existsSync(configuredPath)) {
    return { advanced: false };
  }

  const transition = devTransition(workItemId, rule.nextPhase, { [rule.wiField]: artifactPath });
  if (!transition.ok) {
    log.warn(`reconcileCoarsePhase: transition failed for ${workItemId}: ${transition.error}`);
    return { advanced: false };
  }

  let tasksBootstrapped = 0;
  if (rule.bootstrapTasks) {
    tasksBootstrapped = bootstrapImplementTasksFromPlan(workItemId, artifactPath);
  }

  log.info(
    `reconcileCoarsePhase: ${workItemId} ${wi.phase} → ${rule.nextPhase} (${artifactPath})` +
      (tasksBootstrapped > 0 ? `; bootstrapped ${String(tasksBootstrapped)} task file(s)` : ""),
  );

  return {
    advanced: true,
    fromPhase: wi.phase,
    toPhase: rule.nextPhase,
    artifactPath,
    tasksBootstrapped,
  };
}

/** Advance repeatedly until coarse phase matches artifacts (bounded). */
export function reconcileCoarsePhaseUntilStable(workItemId: string): number {
  const maxSteps = 8;
  let steps = 0;
  for (let i = 0; i < maxSteps; i++) {
    const result = reconcileCoarsePhaseBeforeResume(workItemId);
    if (!result.advanced) {
      break;
    }
    steps += 1;
  }
  return steps;
}
