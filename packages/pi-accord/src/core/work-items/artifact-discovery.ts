/**
 * Discover and validate committed `docs/dev/<ID>/` artifacts.
 * Shared by coarse-phase reconcile and cross-machine rehydrate.
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { devNonce } from "../briefing/nonce.js";
import {
  planTaskPipelineProfile,
  type PlanTaskStep,
} from "../plan/task-pipeline-profile.js";
import { findGitRoot } from "../config/git.js";
import { loadWorkItem, readJson, workItemJsonPath, taskJsonPath, writeJson } from "./io.js";
import type { TaskFile, WorkItem } from "./types.js";

export type ArtifactKind = "brief" | "spec" | "plan";

const ARTIFACT_FILE_NAMES: Record<ArtifactKind, string> = {
  brief: "brief.md",
  spec: "spec.json",
  plan: "plan.json",
};

/**
 * Directory that owns `docs/dev/<id>/` for the current harness session.
 * When cwd is nested inside a git repo (e.g. `apps/partner-portal`), artifacts
 * stay under that package — not at the monorepo root.
 */
export function devArtifactScopeRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd);
}

/** Relative path from {@link devArtifactScopeRoot} to the work item artifact folder. */
export function devArtifactDirRel(workItemId: string): string {
  return path.join("docs", "dev", workItemId);
}

/** Absolute path to `docs/dev/<id>/` for the current scope (nested cwd or repo root). */
export function devArtifactDir(workItemId: string, cwd?: string): string {
  return path.join(devArtifactScopeRoot(cwd), devArtifactDirRel(workItemId));
}

/** Relative artifact path stored on work items and passed to phase agents. */
export function preferredDevArtifactRelPath(workItemId: string, kind: ArtifactKind): string {
  return path.join(devArtifactDirRel(workItemId), artifactFileName(kind));
}

/**
 * Relative path for `.tasks/` work item fields (`brief`, `spec`, `plan`).
 * Prefer the scoped layout under cwd; normalize configured/resolved paths when needed.
 */
export function artifactPathForWorkItem(
  workItemId: string,
  kind: ArtifactKind,
  resolvedOrConfiguredPath?: string | null,
): string {
  const preferred = preferredDevArtifactRelPath(workItemId, kind);
  if (!resolvedOrConfiguredPath?.trim()) return preferred;
  const trimmed = resolvedOrConfiguredPath.trim();
  if (artifactLooksComplete(kind, trimmed, workItemId)) {
    const scoped = path.join(devArtifactDir(workItemId), artifactFileName(kind));
    if (path.resolve(trimmed) === path.resolve(scoped)) {
      return preferred;
    }
  }
  return normalizeArtifactPathForWorkItem(trimmed);
}

/** Store portable paths on work items (relative to cwd, not absolute). */
export function normalizeArtifactPathForWorkItem(
  filePath: string,
  cwd: string = process.cwd(),
): string {
  const trimmed = filePath.trim();
  if (!trimmed) return trimmed;
  if (!path.isAbsolute(trimmed)) return trimmed;
  const resolved = path.resolve(trimmed);
  const base = path.resolve(cwd);
  if (resolved === base || resolved.startsWith(base + path.sep)) {
    return path.relative(base, resolved);
  }
  return trimmed;
}

export function artifactFileName(kind: ArtifactKind): string {
  return ARTIFACT_FILE_NAMES[kind];
}

function configuredArtifactPath(wi: WorkItem, kind: ArtifactKind): string | null {
  const configured =
    kind === "brief" ? wi.brief : kind === "spec" ? wi.spec : kind === "plan" ? wi.plan : null;
  return configured?.trim() ? configured : null;
}

function uniqueCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

/**
 * Walk up to {@link MAX_MONOREPO_WALK_UP_DEPTH} parents looking for `docs/dev/<id>/<file>`.
 * Stops early at a repo sentinel (`.git`) so we don't escape the project root.
 * Covers shallow workspaces and deeply nested package layouts without the
 * previous hard-coded depth list.
 */
const MAX_MONOREPO_WALK_UP_DEPTH = 8;
const REPO_ROOT_SENTINELS = [".git"];

/** Parent walk-up is only used when cwd is the git root (repo-wide docs/dev). */
function artifactScopeAllowsParentDiscovery(cwd: string = process.cwd()): boolean {
  const resolved = path.resolve(cwd);
  const gitRoot = findGitRoot(resolved);
  if (!gitRoot) return false;
  return path.resolve(gitRoot) === resolved;
}

function monorepoDevArtifactCandidates(workItemId: string, fileName: string): string[] {
  if (!artifactScopeAllowsParentDiscovery()) return [];

  const out: string[] = [];
  let current = path.resolve("..");
  let lastDir: string | null = null;
  for (let depth = 0; depth < MAX_MONOREPO_WALK_UP_DEPTH; depth++) {
    if (current === lastDir) break;
    out.push(path.join(current, "docs", "dev", workItemId, fileName));
    if (REPO_ROOT_SENTINELS.some((sentinel) => existsSync(path.join(current, sentinel)))) {
      break;
    }
    lastDir = current;
    current = path.dirname(current);
  }
  return out;
}

/** Resolve an artifact path when a work item exists (WI paths, then docs/dev, then monorepo). */
export function resolveArtifactPath(wi: WorkItem, kind: ArtifactKind, fileName: string): string {
  const candidates: string[] = [];
  const configured = configuredArtifactPath(wi, kind);
  if (configured) candidates.push(configured);
  candidates.push(path.join(devArtifactDir(wi.id), fileName));
  candidates.push(preferredDevArtifactRelPath(wi.id, kind));
  if (wi.spec?.trim()) {
    candidates.push(path.join(path.dirname(wi.spec), fileName));
  }
  if (wi.brief?.trim() && kind !== "brief") {
    candidates.push(path.join(path.dirname(wi.brief), fileName));
  }
  candidates.push(...monorepoDevArtifactCandidates(wi.id, fileName));

  for (const candidate of uniqueCandidates(candidates)) {
    if (existsSync(candidate)) return candidate;
  }
  return configured ?? preferredDevArtifactRelPath(wi.id, kind);
}

/** Resolve an artifact path by work item id only (no `.tasks/` row required). */
export function resolveDevArtifactPathForId(
  workItemId: string,
  kind: ArtifactKind,
  fileName: string = artifactFileName(kind),
): string {
  const candidates = [
    path.join(devArtifactDir(workItemId), fileName),
    preferredDevArtifactRelPath(workItemId, kind),
    ...monorepoDevArtifactCandidates(workItemId, fileName),
  ];
  for (const candidate of uniqueCandidates(candidates)) {
    if (existsSync(candidate)) return candidate;
  }
  return preferredDevArtifactRelPath(workItemId, kind);
}

interface PlanArtifact {
  schema_version?: string;
  work_item_id?: string;
  tasks?: Array<{ id: number; steps?: PlanTaskStep[] }>;
}

interface SpecArtifact {
  schema_version?: string;
  work_item_id?: string;
  title?: string;
}

export function isCompletePlanArtifact(filePath: string, workItemId: string): boolean {
  if (!existsSync(filePath)) return false;
  const plan = readJson<PlanArtifact>(filePath);
  if (!plan) return false;
  if (plan.schema_version !== "1.0") return false;
  if (plan.work_item_id && plan.work_item_id !== workItemId) return false;
  return Array.isArray(plan.tasks) && plan.tasks.length > 0;
}

export function isCompleteMarkdownArtifact(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    return readFileSync(filePath, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

export function isCompleteJsonArtifact(filePath: string, workItemId: string): boolean {
  if (!existsSync(filePath)) return false;
  const data = readJson<Record<string, unknown>>(filePath);
  if (!data) return false;
  if (data.schema_version !== "1.0") return false;
  if (typeof data.work_item_id === "string" && data.work_item_id !== workItemId) return false;
  return true;
}

export function artifactLooksComplete(
  kind: ArtifactKind,
  filePath: string,
  workItemId: string,
): boolean {
  if (kind === "brief") return isCompleteMarkdownArtifact(filePath);
  if (kind === "plan") return isCompletePlanArtifact(filePath, workItemId);
  return isCompleteJsonArtifact(filePath, workItemId);
}

export function readSpecTitle(specPath: string): string | null {
  const spec = readJson<SpecArtifact>(specPath);
  const title = spec?.title?.trim();
  return title && title.length > 0 ? title : null;
}

export function readTitleFromBrief(briefPath: string): string | null {
  if (!existsSync(briefPath)) return null;
  try {
    const text = readFileSync(briefPath, "utf8");
    const match = /^#\s+(.+)$/m.exec(text);
    const title = match?.[1]?.trim();
    return title && title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

export function bootstrapImplementTasksFromPlan(workItemId: string, planPath: string): number {
  const plan = readJson<PlanArtifact>(planPath);
  if (!plan?.tasks?.length) return 0;

  const wi = loadWorkItem(workItemId);
  if (!wi) return 0;

  let created = 0;
  const taskIds = new Set<number>(wi.task_ids ?? []);

  for (const task of plan.tasks) {
    const taskId = task.id;
    if (typeof taskId !== "number" || !Number.isFinite(taskId) || taskId < 1) continue;
    taskIds.add(taskId);

    const taskPath = taskJsonPath(workItemId, taskId);
    const existing = readJson<TaskFile>(taskPath);
    if (existing) continue;

    const profile = planTaskPipelineProfile(task.steps);
    writeJson(taskPath, {
      schema_version: "1.0",
      work_item_id: workItemId,
      task_id: taskId,
      owner_nonce: devNonce(),
      phase: profile.initialPhase,
      status: "pending",
      pre_impl_gates: profile.preImplGates,
      test_files: [],
      events: [],
    } satisfies TaskFile);
    created += 1;
  }

  wi.task_ids = [...taskIds].sort((a, b) => a - b);
  writeJson(workItemJsonPath(workItemId), wi);
  return created;
}

/**
 * Fix existing task files that were bootstrapped before verify-only support
 * (stuck at phase-test with pre_impl_gates pending).
 */
export function reconcileVerifyOnlyTasksFromPlan(workItemId: string, planPath: string): number {
  const plan = readJson<PlanArtifact>(planPath);
  if (!plan?.tasks?.length) return 0;

  let updated = 0;
  for (const task of plan.tasks) {
    const taskId = task.id;
    if (typeof taskId !== "number" || !Number.isFinite(taskId) || taskId < 1) continue;
    const profile = planTaskPipelineProfile(task.steps);
    if (!profile.verifyOnly) continue;

    const taskPath = taskJsonPath(workItemId, taskId);
    const existing = readJson<TaskFile>(taskPath);
    if (!existing || existing.status === "done" || existing.status === "blocked") continue;

    const phase = typeof existing.phase === "string" ? existing.phase : "";
    const needsPhase =
      phase === "phase-test" ||
      phase === "review-test" ||
      phase === "phase-code" ||
      phase === "review-security" ||
      phase === "review-code";
    const needsGates = existing.pre_impl_gates !== "complete";

    if (!needsPhase && !needsGates) continue;

    existing.phase = "phase-verify-task";
    existing.pre_impl_gates = "complete";
    if (existing.status !== "in_progress") {
      existing.status = "pending";
    }
    writeJson(taskPath, existing);
    updated += 1;
  }
  return updated;
}

