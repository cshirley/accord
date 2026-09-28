/**
 * `/dev unblock` / `accord unblock` \u2014 clear a task's review-loop retry-cap block
 * after the engineer has addressed the findings, without hand-editing task JSON.
 *
 * `applyReviewTestPostResult` / `applyReviewCodePostResult` set `task.status = "blocked"`
 * and freeze `review_loop` retry counters at the cap once `review-test`/`review-code`
 * keeps reporting findings at or above the configured severity gate
 * (`packages/accord-core/src/orchestration/policy.ts`). There is no automatic path back
 * from `blocked` \u2014 `resolveReadOnlyResumeAgent` refuses to resume it \u2014 by design: a
 * human should look at `last_review_feedback` first. This module is that "I looked, I
 * fixed it, resume" action.
 */

import { parseKnownDevSubcommandArgs } from "../commands/dispatch.js";
import { loadDevHarnessConfig } from "../config/index.js";
import { maxUnblocksPerTaskFromDevConfig } from "../orchestration/policy.js";
import { err, ok, type Result } from "../types/result.js";
import {
  loadTaskFile,
  loadWorkItem,
  taskLockPath,
  withJsonFileLock,
  writeJson,
} from "../work-items/io.js";
import { taskJsonPath } from "../work-items/tasks-dir.js";
import type { TaskFile } from "../work-items/types.js";

export interface UnblockedTaskSummary {
  task_id: number;
  was_status: string;
  retries_reset: { test_review_retries_used?: number; code_review_retries_used?: number };
  last_review_verdict?: string;
  last_review_finding_count?: number;
  /** Unblocks consumed for this task, ever, after this one (never reset). */
  unblock_count: number;
  /** Lifetime retry-cycle counts, carried through unchanged \u2014 never reset by unblock. */
  lifetime_cycles: { test?: number; code?: number };
}

export interface UnblockResult {
  work_item_id: string;
  unblocked: UnblockedTaskSummary[];
  formatted: string;
}

interface ReviewLoopShape {
  test_review_retries_used?: number;
  code_review_retries_used?: number;
  lifetime_test_review_cycles?: number;
  lifetime_code_review_cycles?: number;
  unblock_count?: number;
}

function reviewLoopCounters(task: TaskFile): ReviewLoopShape | undefined {
  const loop = task.review_loop;
  if (!loop || typeof loop !== "object") return undefined;
  return loop as ReviewLoopShape;
}

function lastReviewFeedback(
  task: TaskFile,
): { agent?: string; verdict?: string; findings?: unknown[] } | undefined {
  const feedback = task.last_review_feedback;
  if (!feedback || typeof feedback !== "object") return undefined;
  return feedback as { agent?: string; verdict?: string; findings?: unknown[] };
}

/**
 * Resets one blocked task's *resettable* retry counters/status. Returns `null` if it wasn't
 * blocked, or `{ capReached: true, ... }` if this task has already used up its lifetime unblock
 * budget (`orchestration.review_loop.max_unblocks_per_task`) \u2014 refusing rather than silently
 * granting another reset is the guard against "repeatedly `/dev unblock` without fixing anything"
 * defeating the review-loop retry cap entirely.
 */
function unblockOne(
  workItemId: string,
  taskId: number,
): UnblockedTaskSummary | { capReached: true; unblockCount: number; maxUnblocks: number } | null {
  // Locked (on the shared `taskLockPath` key, same one `advancePrimaryTask` uses) so this
  // read-modify-write cycle can't interleave with a concurrent post-result write on the same
  // work item and silently lose either side's mutation.
  return withJsonFileLock(taskLockPath(workItemId), () => {
    const task = loadTaskFile(workItemId, String(taskId));
    if (task?.status !== "blocked") {
      return null;
    }

    const wasStatus = task.status;
    const priorCounters = reviewLoopCounters(task);
    const feedback = lastReviewFeedback(task);

    const priorUnblockCount =
      typeof priorCounters?.unblock_count === "number" ? priorCounters.unblock_count : 0;
    const maxUnblocks = maxUnblocksPerTaskFromDevConfig(loadDevHarnessConfig());
    if (priorUnblockCount >= maxUnblocks) {
      return { capReached: true, unblockCount: priorUnblockCount, maxUnblocks };
    }

    task.status = "pending";
    const resetCounters: UnblockedTaskSummary["retries_reset"] = {};
    // Lifetime cycle counts are carried through untouched \u2014 they are the hard ceiling that
    // survives unblocking (see `decideAfterReviewTest` / `decideAfterReviewCode`).
    const lifetimeCycles = {
      test: priorCounters?.lifetime_test_review_cycles,
      code: priorCounters?.lifetime_code_review_cycles,
    };
    if (priorCounters) {
      if (typeof priorCounters.test_review_retries_used === "number") {
        resetCounters.test_review_retries_used = priorCounters.test_review_retries_used;
      }
      if (typeof priorCounters.code_review_retries_used === "number") {
        resetCounters.code_review_retries_used = priorCounters.code_review_retries_used;
      }
    }
    const unblockCount = priorUnblockCount + 1;
    task.review_loop = {
      test_review_retries_used: 0,
      code_review_retries_used: 0,
      lifetime_test_review_cycles: lifetimeCycles.test ?? 0,
      lifetime_code_review_cycles: lifetimeCycles.code ?? 0,
      unblock_count: unblockCount,
    };
    if (task.quick_fix_loop && typeof task.quick_fix_loop === "object") {
      task.quick_fix_loop = { test_review_cycles_used: 0 };
    }

    writeJson(taskJsonPath(workItemId, taskId), task);

    return {
      task_id: taskId,
      was_status: wasStatus,
      retries_reset: resetCounters,
      last_review_verdict: feedback?.verdict,
      last_review_finding_count: Array.isArray(feedback?.findings)
        ? feedback.findings.length
        : undefined,
      unblock_count: unblockCount,
      lifetime_cycles: lifetimeCycles,
    };
  });
}

function formatUnblockResult(workItemId: string, unblocked: UnblockedTaskSummary[]): string {
  if (unblocked.length === 0) {
    return `${workItemId}: no blocked task(s) to unblock.`;
  }
  const lines = [`${workItemId}: unblocked ${String(unblocked.length)} task(s).`, ""];
  for (const summary of unblocked) {
    const retryBits = Object.entries(summary.retries_reset)
      .map(([key, value]) => `${key}=${String(value)}\u21920`)
      .join(", ");
    const verdictBits = [
      summary.last_review_verdict ? `last verdict: ${summary.last_review_verdict}` : "",
      summary.last_review_finding_count !== undefined
        ? `${String(summary.last_review_finding_count)} finding(s)`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(
      `  task ${String(summary.task_id)}: ${summary.was_status} \u2192 pending${retryBits ? ` (${retryBits})` : ""}${verdictBits ? ` \u2014 ${verdictBits}` : ""}`,
    );
  }
  lines.push(
    "",
    "This only resets the retry budget \u2014 make sure the findings on the task file's `last_review_feedback` are actually addressed first.",
    `Run \`/dev resume ${workItemId}\` (or \`accord resume ${workItemId}\`) to continue.`,
  );
  return lines.join("\n");
}

/**
 * Unblocks a specific task (`taskId` given) or every currently-blocked task on the work
 * item (`taskId` omitted). Errors only on a hard problem (work item missing, or an
 * explicitly-named task that doesn't exist / isn't blocked) \u2014 the "unblock all" path
 * silently skips tasks that aren't blocked.
 */
export function unblockTask(workItemId: string, taskId?: number): Result<UnblockResult> {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return err(`Work item not found: ${workItemId}`);
  }

  if (taskId !== undefined) {
    const summary = unblockOne(workItemId, taskId);
    if (summary && "capReached" in summary) {
      return err(unblockCapReachedMessage(workItemId, taskId, summary));
    }
    if (!summary) {
      const task = loadTaskFile(workItemId, String(taskId));
      if (!task) return err(`Task ${String(taskId)} not found on ${workItemId}.`);
      return err(
        `Task ${String(taskId)} on ${workItemId} is not blocked (status: ${task.status}).`,
      );
    }
    return ok({
      work_item_id: workItemId,
      unblocked: [summary],
      formatted: formatUnblockResult(workItemId, [summary]),
    });
  }

  const candidateIds = (wi.task_ids ?? []).map((id) => Number(id));
  const unblocked: UnblockedTaskSummary[] = [];
  const capMessages: string[] = [];
  for (const id of candidateIds) {
    const summary = unblockOne(workItemId, id);
    if (!summary) continue;
    if ("capReached" in summary) {
      capMessages.push(unblockCapReachedMessage(workItemId, id, summary));
      continue;
    }
    unblocked.push(summary);
  }

  const formatted = [formatUnblockResult(workItemId, unblocked), ...capMessages]
    .filter(Boolean)
    .join("\n\n");

  return ok({
    work_item_id: workItemId,
    unblocked,
    formatted,
  });
}

function unblockCapReachedMessage(
  workItemId: string,
  taskId: number,
  cap: { unblockCount: number; maxUnblocks: number },
): string {
  return (
    `Task ${String(taskId)} on ${workItemId} has already used its lifetime unblock budget ` +
    `(${String(cap.unblockCount)}/${String(cap.maxUnblocks)}; orchestration.review_loop.max_unblocks_per_task). ` +
    "Resetting the retry counters again will not fix the underlying review-test/review-code " +
    "findings \u2014 read `last_review_feedback` on the task file and either fix the flagged " +
    "gaps for real, or deliberately raise `orchestration.review_loop.max_unblocks_per_task` " +
    "(and consider `max_lifetime_retries`) in the dev harness config if this task genuinely " +
    "needs more cycles."
  );
}

/**
 * `/dev unblock <work-item-id> [task_id]` entry point \u2014 same parsing convention as
 * `/dev deviations` (`parseKnownDevSubcommandArgs`).
 */
export function devUnblock(rawArgs: string): Result<UnblockResult> {
  const parsed = parseKnownDevSubcommandArgs("unblock", rawArgs);
  const workItemId = parsed.leadingWorkItemId;
  if (!workItemId) {
    return err("Usage: `/dev unblock <work-item-id> [task_id]`");
  }
  const taskRaw = parsed.positional[1];
  const taskId = taskRaw !== undefined ? Number.parseInt(taskRaw, 10) : undefined;
  if (taskRaw !== undefined && !Number.isFinite(taskId)) {
    return err(`Usage: \`/dev unblock ${workItemId} [task_id]\` \u2014 task_id must be a number.`);
  }
  return unblockTask(workItemId, taskId);
}
