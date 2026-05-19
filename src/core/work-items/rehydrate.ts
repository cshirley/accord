/**
 * Rehydrate `.tasks/` runtime state from committed `docs/dev/<ID>/` artifacts.
 * Used when `.tasks/` was deleted but brief/spec/plan remain on disk (e.g. another machine).
 */

import { existsSync } from "node:fs";
import * as path from "node:path";
import { createLogger } from "../logging.js";
import { reconcileCoarsePhaseUntilStable } from "../orchestration/reconcile-coarse-phase.js";
import { err, ok, type Result } from "../types/result.js";
import {
  artifactLooksComplete,
  bootstrapImplementTasksFromPlan,
  devArtifactDir,
  readSpecTitle,
  readTitleFromBrief,
  resolveDevArtifactPathForId,
} from "./artifact-discovery.js";
import { loadWorkItem, now, readJson, TASKS_DIR, writeJson } from "./io.js";
import type { WorkItem, WorkItemPattern } from "./types.js";

const log = createLogger("work-items");

export interface RehydrateWorkItemResult {
  rehydrated: boolean;
  work_item_path?: string;
  phase?: string;
  pattern?: WorkItemPattern;
  variant?: string;
  paths?: {
    brief?: string | null;
    spec?: string | null;
    plan?: string | null;
    verify?: string | null;
  };
  tasks_bootstrapped?: number;
  reconcile_steps?: number;
  message: string;
}

interface InferredImplementLadder {
  phase: string;
  title: string;
  brief: string | null;
  spec: string | null;
  plan: string | null;
  verify: string | null;
  bootstrapTasks: boolean;
}

function resolveVerifyPath(workItemId: string): string | null {
  for (const fileName of ["verify.json", "verify.md"]) {
    const candidate = path.join(devArtifactDir(workItemId), fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function inferImplementStandardLadder(workItemId: string): Result<InferredImplementLadder> {
  const briefPath = resolveDevArtifactPathForId(workItemId, "brief");
  const specPath = resolveDevArtifactPathForId(workItemId, "spec");
  const planPath = resolveDevArtifactPathForId(workItemId, "plan");

  const hasBrief = artifactLooksComplete("brief", briefPath, workItemId);
  const hasSpec = artifactLooksComplete("spec", specPath, workItemId);
  const hasPlan = artifactLooksComplete("plan", planPath, workItemId);

  if (!hasBrief && !hasSpec && !hasPlan) {
    return err(
      `No recoverable artifacts for ${workItemId}. Expected at least docs/dev/${workItemId}/brief.md or spec.json on disk.`,
    );
  }

  const title =
    (hasSpec ? readSpecTitle(specPath) : null) ??
    (hasBrief ? readTitleFromBrief(briefPath) : null) ??
    workItemId;

  const verify = resolveVerifyPath(workItemId);

  if (hasPlan) {
    let effectiveSpec: string | null = hasSpec ? specPath : null;
    if (!effectiveSpec) {
      const plan = readJson<{ spec?: string }>(planPath);
      const fromPlan = plan?.spec?.trim();
      if (fromPlan && existsSync(fromPlan) && artifactLooksComplete("spec", fromPlan, workItemId)) {
        effectiveSpec = fromPlan;
      }
    }
    return ok({
      phase: "implementing",
      title,
      brief: hasBrief ? briefPath : null,
      spec: effectiveSpec,
      plan: planPath,
      verify,
      bootstrapTasks: true,
    });
  }

  if (hasSpec) {
    return ok({
      phase: "planning",
      title,
      brief: hasBrief ? briefPath : null,
      spec: specPath,
      plan: null,
      verify,
      bootstrapTasks: false,
    });
  }

  return ok({
    phase: "speccing",
    title,
    brief: briefPath,
    spec: null,
    plan: null,
    verify,
    bootstrapTasks: false,
  });
}

/**
 * Create `.tasks/<ID>.json` (and task files when plan exists) from `docs/dev/` artifacts.
 * No-op when the work item already exists.
 */
export function rehydrateWorkItemFromArtifacts(workItemId: string): Result<RehydrateWorkItemResult> {
  const existing = loadWorkItem(workItemId);
  if (existing) {
    return ok({
      rehydrated: false,
      phase: existing.phase,
      pattern: existing.pattern,
      variant: existing.variant,
      message: `Work item ${workItemId} already exists (phase: ${existing.phase}).`,
    });
  }

  const inferred = inferImplementStandardLadder(workItemId);
  if (!inferred.ok) {
    return err(inferred.error);
  }

  const ladder = inferred.value;
  const timestamp = now();
  const wi: WorkItem = {
    schema_version: "1.0",
    id: workItemId,
    title: ladder.title,
    created: timestamp,
    updated: timestamp,
    pattern: "implement",
    variant: "standard",
    phase: ladder.phase,
    brief: ladder.brief,
    spec: ladder.spec,
    plan: ladder.plan,
    verify: ladder.verify,
    task_ids: [],
    decisions: [],
    deviations: [],
    cost_usd: 0,
    intent_mode: "pipeline",
    intent_confidence: "high",
    escalation_ceiling: "pipeline_allowed",
  };

  const wiPath = path.join(TASKS_DIR, `${workItemId}.json`);
  writeJson(wiPath, wi);

  let tasksBootstrapped = 0;
  if (ladder.bootstrapTasks && ladder.plan) {
    tasksBootstrapped = bootstrapImplementTasksFromPlan(workItemId, ladder.plan);
  }

  log.info(
    `rehydrate: created ${workItemId} at phase ${ladder.phase}` +
      (tasksBootstrapped > 0 ? `; bootstrapped ${String(tasksBootstrapped)} task file(s)` : ""),
  );

  return ok({
    rehydrated: true,
    work_item_path: wiPath,
    phase: ladder.phase,
    pattern: "implement",
    variant: "standard",
    paths: {
      brief: ladder.brief,
      spec: ladder.spec,
      plan: ladder.plan,
      verify: ladder.verify,
    },
    tasks_bootstrapped: tasksBootstrapped,
    message: `Rehydrated ${workItemId} from docs/dev/ → phase ${ladder.phase}${tasksBootstrapped > 0 ? ` (${String(tasksBootstrapped)} task file(s))` : ""}.`,
  });
}

/**
 * Ensure a work item exists (rehydrate when possible), then catch coarse phase up to artifacts.
 */
export function ensureWorkItemHydrated(workItemId: string): Result<RehydrateWorkItemResult> {
  const rehydrate = rehydrateWorkItemFromArtifacts(workItemId);
  if (!rehydrate.ok) {
    return rehydrate;
  }

  const reconcileSteps = reconcileCoarsePhaseUntilStable(workItemId);
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return err(`Work item ${workItemId} missing after rehydrate.`);
  }

  if (rehydrate.value.rehydrated) {
    return ok({
      ...rehydrate.value,
      phase: wi.phase,
      reconcile_steps: reconcileSteps,
      message:
        rehydrate.value.message +
        (reconcileSteps > 0
          ? ` Reconcile advanced ${String(reconcileSteps)} step(s) → phase ${wi.phase}.`
          : ""),
    });
  }

  return ok({
    ...rehydrate.value,
    phase: wi.phase,
    reconcile_steps: reconcileSteps,
    message:
      reconcileSteps > 0
        ? `Work item ${workItemId} reconciled ${String(reconcileSteps)} coarse step(s) → phase ${wi.phase}.`
        : rehydrate.value.message,
  });
}

/** User-facing rehydrate (explicit tool / subcommand). */
export function devRehydrateWorkItem(workItemId: string): Result<RehydrateWorkItemResult> {
  return ensureWorkItemHydrated(workItemId);
}
