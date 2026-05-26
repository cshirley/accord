/**
 * Pipeline artifact gates — block downstream phase agents until upstream artifacts exist.
 *
 * implement/standard and implement/orchestrated require:
 *   phase-spec  ← complete brief.md
 *   phase-plan  ← complete spec.json
 */

import {
  artifactFileName,
  artifactLooksComplete,
  resolveArtifactPath,
  resolveDevArtifactPathForId,
} from "../../work-items/artifact-discovery.js";
import { loadWorkItem } from "../../work-items/io.js";
import type { WorkItem } from "../../work-items/types.js";
import { extractWorkItemId } from "../../telemetry/usage.js";
import { firstSubagentAgentName, getPrimarySubagentEntry } from "../entries.js";

export type ArtifactGateResult = { ok: true; path: string } | { ok: false; reason: string };

/** implement/standard and implement/orchestrated run the align → spec → plan pipeline. */
export function workItemUsesAlignFirstPipeline(wi: WorkItem | null | undefined): boolean {
  if (!wi || wi.pattern !== "implement") return false;
  const variant = wi.variant ?? "standard";
  return variant === "standard" || variant === "orchestrated";
}

function resolveBriefPath(workItemId: string, wi: WorkItem): string {
  if (wi.brief?.trim()) {
    return resolveArtifactPath(wi, "brief", artifactFileName("brief"));
  }
  return resolveDevArtifactPathForId(workItemId, "brief");
}

function resolveSpecPath(workItemId: string, wi: WorkItem): string {
  if (wi.spec?.trim()) {
    return resolveArtifactPath(wi, "spec", artifactFileName("spec"));
  }
  return resolveDevArtifactPathForId(workItemId, "spec");
}

/** Gate before speccing / phase-spec for implement pipelines that start with align. */
export function checkBriefPresentForSpeccing(
  workItemId: string,
  wi?: WorkItem | null,
): ArtifactGateResult {
  const workItem = wi ?? loadWorkItem(workItemId);
  if (!workItem) {
    return {
      ok: false,
      reason: `Work item not found: ${workItemId}. Run \`/dev ${workItemId}\` or \`/dev align ${workItemId}\` to bootstrap.`,
    };
  }
  if (!workItemUsesAlignFirstPipeline(workItem)) {
    return { ok: true, path: "" };
  }

  const briefPath = resolveBriefPath(workItemId, workItem);
  if (!artifactLooksComplete("brief", briefPath, workItemId)) {
    return {
      ok: false,
      reason: [
        `Brief required before spec. No complete brief at \`${briefPath}\`.`,
        `Run \`/dev align ${workItemId}\` (or \`/dev resume ${workItemId}\` during alignment) until phase-align returns status "done" and writes docs/dev/${workItemId}/brief.md.`,
      ].join(" "),
    };
  }
  return { ok: true, path: briefPath };
}

/** Gate before planning / phase-plan. */
export function checkSpecPresentForPlanning(
  workItemId: string,
  wi?: WorkItem | null,
): ArtifactGateResult {
  const workItem = wi ?? loadWorkItem(workItemId);
  if (!workItem) {
    return {
      ok: false,
      reason: `Work item not found: ${workItemId}.`,
    };
  }
  if (!workItemUsesAlignFirstPipeline(workItem)) {
    return { ok: true, path: "" };
  }

  const specPath = resolveSpecPath(workItemId, workItem);
  if (!artifactLooksComplete("spec", specPath, workItemId)) {
    return {
      ok: false,
      reason: [
        `Spec required before plan. No complete spec at \`${specPath}\`.`,
        `Run \`/dev spec ${workItemId}\` (or resume spec) until phase-spec returns status "done".`,
      ].join(" "),
    };
  }
  return { ok: true, path: specPath };
}

function workItemIdFromSubagentInput(input: Record<string, unknown>): string | null {
  const entry = getPrimarySubagentEntry(input);
  const task =
    typeof entry?.task === "string" ? entry.task : typeof input.task === "string" ? input.task : "";
  return extractWorkItemId(task, { mustExist: true });
}

export async function runPipelineArtifactPreflightOnSubagentCall(
  input: Record<string, unknown>,
): Promise<{ blockReason?: string }> {
  const agent = firstSubagentAgentName(input);
  const workItemId = workItemIdFromSubagentInput(input);
  if (!workItemId) return {};

  if (agent === "phase-spec") {
    const check = checkBriefPresentForSpeccing(workItemId);
    if (!check.ok) return { blockReason: check.reason };
  }

  if (agent === "phase-plan") {
    const check = checkSpecPresentForPlanning(workItemId);
    if (!check.ok) return { blockReason: check.reason };
  }

  return {};
}
