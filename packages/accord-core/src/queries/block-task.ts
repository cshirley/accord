/**
 * `/dev block` / `accord block` — manually force a task's `status` to `blocked` when the
 * automated test↔review retry-cap loop (`packages/accord-core/src/orchestration/policy.ts`)
 * hasn't tripped yet but a human needs to step in without hand-editing task JSON.
 * `resolveReadOnlyResumeAgent` refuses to resume a task with `status === "blocked"` (by
 * design — a human should look at the task file `summary` before continuing), so this is the
 * manual override that pairs with `/dev unblock` (`unblock-task.ts`).
 */

import { parseKnownDevSubcommandArgs } from "../commands/dispatch.js";
import { allocateRef, appendLog } from "../tasks/model.js";
import { loadTaskV2, writeTaskV2 } from "../tasks/store.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, taskLockPath, withJsonFileLock } from "../work-items/io.js";

export interface BlockedTaskSummary {
  task_id: number;
  was_status: string;
  reason: string;
}

export interface BlockResult {
  work_item_id: string;
  blocked: BlockedTaskSummary;
  formatted: string;
}

/**
 * Locked (on the shared `taskLockPath` key, same one `advancePrimaryTask` uses) so this
 * read-modify-write cycle can't interleave with a concurrent post-result write on the same
 * work item and silently lose either side's mutation.
 */
function blockOne(workItemId: string, taskId: number, reason: string): Result<BlockedTaskSummary> {
  return withJsonFileLock(taskLockPath(workItemId), () => {
    const task = loadTaskV2(workItemId, String(taskId));
    if (!task) {
      return err(`Task ${String(taskId)} not found on ${workItemId}.`);
    }
    if (task.control.status === "blocked") {
      return err(`Task ${String(taskId)} on ${workItemId} is already blocked.`);
    }
    if (task.control.status === "done") {
      return err(`Task ${String(taskId)} on ${workItemId} is already done — nothing to block.`);
    }

    const wasStatus = task.control.status;
    const at = new Date().toISOString();
    const ref = allocateRef(task, "block");
    appendLog(task, { ref, at, result: "blocked", note: reason, actor: "human" });
    task.control.status = "blocked";
    task.control.blocked = { kind: "manual", reason, ref };
    writeTaskV2(task, at);

    return ok({ task_id: taskId, was_status: wasStatus, reason });
  });
}

function formatBlockResult(workItemId: string, summary: BlockedTaskSummary): string {
  return [
    `${workItemId}: task ${String(summary.task_id)} ${summary.was_status} \u2192 blocked.`,
    "",
    `Reason: ${summary.reason}`,
    "",
    "This only flips status \u2014 retry counters are left as-is for the audit trail, and the harness will refuse to auto-resume this task.",
    `Run \`/dev unblock ${workItemId} ${String(summary.task_id)}\` (or \`accord unblock ${workItemId} ${String(summary.task_id)}\`) once you're ready to resume.`,
  ].join("\n");
}

/**
 * Forces one task to `blocked`. Unlike `/dev unblock` (which can default to "every blocked
 * task"), blocking always requires an explicit `taskId` and a non-empty `reason` — it's a
 * deliberate human override of a task the harness still considers in-progress, not a bulk
 * convenience action.
 */
export function blockTask(workItemId: string, taskId: number, reason: string): Result<BlockResult> {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return err(`Work item not found: ${workItemId}`);
  }
  if (!reason.trim()) {
    return err(
      "block requires a reason (e.g. `/dev block <ID> <task_id> stuck in adversarial review loop`).",
    );
  }

  const result = blockOne(workItemId, taskId, reason.trim());
  if (!result.ok) {
    return result;
  }

  return ok({
    work_item_id: workItemId,
    blocked: result.value,
    formatted: formatBlockResult(workItemId, result.value),
  });
}

/**
 * `/dev block <work-item-id> <task_id> <reason...>` entry point — same parsing convention as
 * `/dev unblock` / `/dev deviations` (`parseKnownDevSubcommandArgs`).
 */
export function devBlock(rawArgs: string): Result<BlockResult> {
  const parsed = parseKnownDevSubcommandArgs("block", rawArgs);
  const workItemId = parsed.leadingWorkItemId;
  if (!workItemId) {
    return err("Usage: `/dev block <work-item-id> <task_id> <reason...>`");
  }
  const taskRaw = parsed.positional[1];
  const taskId = taskRaw !== undefined ? Number.parseInt(taskRaw, 10) : Number.NaN;
  if (!Number.isFinite(taskId)) {
    return err(
      `Usage: \`/dev block ${workItemId} <task_id> <reason...>\` \u2014 task_id must be a number.`,
    );
  }
  // Reason = every token after the work-item-id and task-id tokens (both always first two
  // tokens by convention here — mirrors the other `parseKnownDevSubcommandArgs` consumers).
  const reason = parsed.tokens.slice(2).join(" ");
  return blockTask(workItemId, taskId, reason);
}
