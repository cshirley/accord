/**
 * Rehydrate `.tasks/` runtime state from committed `docs/dev/<ID>/` artifacts.
 * Used when `.tasks/` was deleted but brief/spec/plan remain on disk (e.g. another machine).
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { createLogger } from "../logging.js";
import { reconcileCoarsePhaseUntilStable } from "../orchestration/reconcile-coarse-phase.js";
import { err, ok, type Result } from "../types/result.js";
import {
  artifactLooksComplete,
  artifactPathForWorkItem,
  bootstrapImplementTasksFromPlan,
  devArtifactDir,
  normalizeArtifactPathForWorkItem,
  readSpecTitle,
  readTitleFromBrief,
  resolveDevArtifactPathForId,
} from "./artifact-discovery.js";
import { loadWorkItem, now, readJson, workItemJsonPath, writeJson } from "./io.js";
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

/**
 * Quick-fix briefs always contain a `Quick Fix Contract` block (written by
 * `writeQuickFixStubs`). Detecting this prevents rehydrate from silently
 * recreating the work item as `implement/standard` with the wrong phase ladder.
 */
function briefLooksLikeQuickFix(briefPath: string | null): boolean {
  if (!briefPath || !existsSync(briefPath)) return false;
  try {
    const text = readFileSync(briefPath, "utf8");
    return text.includes("Quick Fix Contract") || text.includes("## Quick Fix");
  } catch {
    return false;
  }
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
    let effectiveSpec: string | null = hasSpec
      ? artifactPathForWorkItem(workItemId, "spec", specPath)
      : null;
    if (!effectiveSpec) {
      const plan = readJson<{ spec?: string }>(planPath);
      const fromPlan = plan?.spec?.trim();
      if (fromPlan && existsSync(fromPlan) && artifactLooksComplete("spec", fromPlan, workItemId)) {
        effectiveSpec = normalizeArtifactPathForWorkItem(fromPlan);
      }
    }
    return ok({
      phase: "implementing",
      title,
      brief: hasBrief ? artifactPathForWorkItem(workItemId, "brief", briefPath) : null,
      spec: effectiveSpec,
      plan: artifactPathForWorkItem(workItemId, "plan", planPath),
      verify,
      bootstrapTasks: true,
    });
  }

  if (hasSpec) {
    return ok({
      phase: "planning",
      title,
      brief: hasBrief ? artifactPathForWorkItem(workItemId, "brief", briefPath) : null,
      spec: artifactPathForWorkItem(workItemId, "spec", specPath),
      plan: null,
      verify,
      bootstrapTasks: false,
    });
  }

  return ok({
    phase: "speccing",
    title,
    brief: artifactPathForWorkItem(workItemId, "brief", briefPath),
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
export function rehydrateWorkItemFromArtifacts(
  workItemId: string,
): Result<RehydrateWorkItemResult> {
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
  if (briefLooksLikeQuickFix(ladder.brief)) {
    return err(
      `Work item ${workItemId} appears to be a quick_fix (brief contains "Quick Fix Contract"). ` +
        `Rehydrate currently only supports implement/standard. ` +
        `Re-run \`/dev\` with the original quick_fix request to recreate runtime state.`,
    );
  }
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

  const wiPath = workItemJsonPath(workItemId);
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
