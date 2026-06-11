/**
 * `/dev deviations` — list and resolve plan deviations on a work item.
 */

import { parseKnownDevSubcommandArgs } from "../commands/dispatch.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem } from "../work-items/io.js";
import type { Deviation } from "../work-items/types.js";
import { acceptDeviation, revertDeviation } from "./deviation-actions.js";

export type DeviationCommandAction = "list" | "accept" | "revert" | "review";

export interface ParsedDeviationsArgs {
  workItemId?: string;
  action: DeviationCommandAction;
  taskId?: number;
}

export interface DevDeviationsResult {
  action: DeviationCommandAction;
  formatted: string;
  /** When true, extension should spawn `review-deviation`. */
  spawn_review: boolean;
  task_id?: number;
}

function isPending(dev: Deviation): boolean {
  if (dev.resolution === "accepted" || dev.resolution === "mechanical") return false;
  if (dev.status === "resolved") return false;
  return true;
}

export function parseDeviationsArgs(rawArgs: string): ParsedDeviationsArgs {
  const parsed = parseKnownDevSubcommandArgs("deviations", rawArgs);
  const actionToken = parsed.positional[1]?.toLowerCase();
  let action: DeviationCommandAction = "list";
  if (actionToken === "accept") action = "accept";
  else if (actionToken === "revert") action = "revert";
  else if (actionToken === "review") action = "review";

  const taskRaw = parsed.positional[2];
  const taskId = taskRaw !== undefined ? Number.parseInt(taskRaw, 10) : undefined;

  return {
    workItemId: parsed.leadingWorkItemId,
    action,
    taskId: Number.isFinite(taskId) ? taskId : undefined,
  };
}

function formatDeviationList(workItemId: string, deviations: Deviation[]): string {
  const pending = deviations.filter(isPending);
  const lines: string[] = [`${workItemId} — deviations\n`];

  if (deviations.length === 0) {
    lines.push("No deviations recorded on this work item.");
    return lines.join("\n");
  }

  if (pending.length === 0) {
    lines.push("All deviations are resolved.");
  } else {
    lines.push(`${pending.length} pending deviation(s):\n`);
    for (const dev of pending) {
      const resolution = dev.resolution ? ` resolution=${dev.resolution}` : "";
      lines.push(`  task-${String(dev.task_id)}${resolution}  at=${dev.at}`);
      lines.push(`    ${dev.description}`);
      if (dev.reason) lines.push(`    Why: ${dev.reason}`);
      if (dev.blocking_recommendation) {
        lines.push(`    Recommendation: ${dev.blocking_recommendation}`);
      }
      lines.push("");
    }
    lines.push("Actions:");
    lines.push(`  /dev deviations ${workItemId} accept <task_id>`);
    lines.push(`  /dev deviations ${workItemId} revert <task_id>`);
    lines.push(`  /dev deviations ${workItemId} review [task_id]  (spawn review-deviation)`);
  }

  const resolved = deviations.filter((d) => !isPending(d));
  if (resolved.length > 0) {
    lines.push(`\n${resolved.length} resolved deviation(s) (use /dev review for full queue).`);
  }

  return lines.join("\n");
}

export function devDeviations(rawArgs: string): Result<DevDeviationsResult> {
  const parsed = parseDeviationsArgs(rawArgs);
  const workItemId = parsed.workItemId;
  if (!workItemId) {
    return err("Usage: `/dev deviations <work-item-id> [accept|revert|review] [task_id]`");
  }

  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const deviations = wi.deviations ?? [];

  if (parsed.action === "accept") {
    if (parsed.taskId === undefined) {
      return err(`Usage: \`/dev deviations ${workItemId} accept <task_id>\``);
    }
    const result = acceptDeviation(workItemId, parsed.taskId);
    if (!result.ok) return err(result.error);
    return ok({
      action: "accept",
      formatted: result.value.formatted,
      spawn_review: false,
      task_id: parsed.taskId,
    });
  }

  if (parsed.action === "revert") {
    if (parsed.taskId === undefined) {
      return err(`Usage: \`/dev deviations ${workItemId} revert <task_id>\``);
    }
    const result = revertDeviation(workItemId, parsed.taskId);
    if (!result.ok) return err(result.error);
    return ok({
      action: "revert",
      formatted: result.value.formatted,
      spawn_review: false,
      task_id: parsed.taskId,
    });
  }

  if (parsed.action === "review") {
    const suffix = parsed.taskId !== undefined ? `task ${String(parsed.taskId)}` : "open deviations";
    return ok({
      action: "review",
      formatted: `${parsed.workItemId}: spawning review-deviation for ${suffix}…`,
      spawn_review: true,
      task_id: parsed.taskId,
    });
  }

  return ok({
    action: "list",
    formatted: formatDeviationList(workItemId, deviations),
    spawn_review: false,
  });
}
