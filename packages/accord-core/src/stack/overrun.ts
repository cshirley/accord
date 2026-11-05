import { join } from "node:path";
import { parseAccordTrailer } from "../commit/commit-grammar.js";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { measureActualLines } from "../evidence/lines.js";
import { git } from "../git/helpers.js";
import { writeTaskSidecar } from "../tasks/store.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { mutateJson, now, readJson } from "../work-items/io.js";
import { workItemJsonPath } from "../work-items/tasks-dir.js";
import type { WorkItem } from "../work-items/types.js";

export const OVERRUN_SIZE_SIDECAR = "size.json";
const HISTORY_LIMIT = 500;

export interface OverrunOptions {
  cwd: string;
  config?: DevHarnessConfig | null;
  /** Diff base (e.g. the commit before the task's first phase commit). */
  base: string;
  /** Diff head (e.g. the GREEN commit). */
  head: string;
  testPattern?: string;
}

export interface OverrunResult {
  overrun: boolean;
  est_lines: number;
  act_prod_lines: number;
  act_test_lines: number;
  act_lines: number;
  decision_id?: string;
}

function overrunDecisionId(taskId: number): string {
  return `overrun-task-${String(taskId)}`;
}

function raiseDecision(
  workItemId: string,
  taskId: number,
  result: OverrunResult,
  factor: number,
): string {
  const id = overrunDecisionId(taskId);
  mutateJson<WorkItem>(workItemJsonPath(workItemId), (wi) => {
    if (!wi) return undefined;
    wi.decisions ??= [];
    if (wi.decisions.some((decision) => decision.id === id)) return undefined;
    const at = now();
    wi.decisions.push({
      id,
      source: "overrun",
      status: "pending",
      question: `Task ${String(taskId)} changed ${String(result.act_lines)} lines (${String(result.act_prod_lines)} production, ${String(result.act_test_lines)} test) against est_lines ${String(result.est_lines)} (limit ${String(factor)}x). Re-plan through contract-amend, or accept with a reason?`,
      context: `Re-plan: /dev amend-spec ${workItemId} <reason> --replan. Accept: answer with accept and a reason.`,
      phase: "implementing",
      asked_at: at,
    });
    wi.updated = at;
    return wi;
  });
  return id;
}

/**
 * Measure the task's net diff after GREEN and compare with the plan's est_lines. Records the size
 * for trace.json; above overrun_factor x est_lines raises one pending decision and emits
 * stack.overrun.detected.
 */
export async function checkOverrun(
  workItemId: string,
  taskId: number,
  options: OverrunOptions,
): Promise<OverrunResult> {
  const result: OverrunResult = {
    overrun: false,
    est_lines: 0,
    act_prod_lines: 0,
    act_test_lines: 0,
    act_lines: 0,
  };
  const plan = readJson<{ tasks?: Array<{ id?: number; est_lines?: number }> }>(
    join(options.cwd, devArtifactDirRel(workItemId), "plan.json"),
  );
  const est = plan?.tasks?.find((task) => task.id === taskId)?.est_lines;
  if (typeof est !== "number") return result;
  result.est_lines = est;

  const measured = await measureActualLines(options.cwd, options.base, options.head, {
    testPattern: options.testPattern ?? options.config?.test?.file_pattern,
  });
  result.act_prod_lines = measured.act_prod_lines;
  result.act_test_lines = measured.act_test_lines;
  result.act_lines = measured.act_prod_lines + measured.act_test_lines;

  writeTaskSidecar(
    workItemId,
    taskId,
    OVERRUN_SIZE_SIDECAR,
    `${JSON.stringify({
      est_lines: est,
      act_prod_lines: result.act_prod_lines,
      act_test_lines: result.act_test_lines,
    })}\n`,
    options.cwd,
  );

  const factor = resolveStackConfig(options.config).sizing.overrun_factor;
  if (result.act_lines <= factor * est) return result;
  result.overrun = true;
  result.decision_id = raiseDecision(workItemId, taskId, result, factor);
  emitStackEvent("stack.overrun.detected", {
    work_item_id: workItemId,
    task: taskId,
    est_lines: est,
    act_lines: result.act_lines,
  });
  return result;
}

/** Diff range of a task's phase commits: parent of its oldest typed commit .. HEAD. */
export async function resolveTaskDiffRange(
  workItemId: string,
  taskId: number,
  cwd: string,
): Promise<{ base: string; head: string } | null> {
  const raw = await git(["log", "-n", String(HISTORY_LIMIT), "--format=%H%x1f%B%x1e"], cwd).catch(
    () => "",
  );
  let oldest: string | null = null;
  for (const record of raw.split("\x1e")) {
    const [sha, body] = record.replace(/^\n/, "").split("\x1f");
    if (!sha) continue;
    try {
      const trailer = parseAccordTrailer(body ?? "");
      if (trailer && trailer.id === workItemId && trailer.task === taskId) oldest = sha.trim();
    } catch {
      // not an ACCORD commit
    }
  }
  if (!oldest) return null;
  const base = (
    await git(["rev-parse", "--verify", "-q", `${oldest}^`], cwd).catch(() => "")
  ).trim();
  if (!base) return null;
  const head = (await git(["rev-parse", "HEAD"], cwd)).trim();
  return { base, head };
}
