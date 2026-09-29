/**
 * `/dev unblock` with an interactive per-blocker walk when no decision flags are given.
 */

import {
  devUnblock,
  type HumanDecision,
  parseUnblockArgs,
  tokenizeArgs,
  UNBLOCK_USAGE,
  type UnblockResult,
  unblockTask,
} from "@clive.shirley/accord-core/queries/unblock-task.js";
import { loadTaskV2 } from "@clive.shirley/accord-core/tasks/store.js";
import type { Result } from "@clive.shirley/accord-core/types/result.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const CHOICES: Array<{ label: string; action: HumanDecision["action"] | "skip" }> = [
  { label: "note — guidance for the fixer (still blocking)", action: "note" },
  { label: "fixed — I fixed it; reviewer rechecks", action: "fixed" },
  { label: "accept — accept wont_fix / dispute", action: "accept" },
  { label: "waive — waive this finding", action: "waive" },
  { label: "skip", action: "skip" },
];

export async function devUnblockInteractive(
  rawArgs: string,
  ctx: Pick<ExtensionCommandContext, "ui" | "hasUI">,
): Promise<Result<UnblockResult>> {
  const parsed = parseUnblockArgs(tokenizeArgs(rawArgs.trim()));
  const interactive =
    ctx.hasUI &&
    parsed.workItemId !== undefined &&
    parsed.taskId !== undefined &&
    parsed.decisions.length === 0 &&
    !parsed.force &&
    parsed.errors.length === 0;
  if (!interactive || !parsed.workItemId || parsed.taskId === undefined) {
    return devUnblock(rawArgs);
  }

  const task = loadTaskV2(parsed.workItemId, parsed.taskId);
  const blockers = task?.summary.blockers ?? [];
  const decisions: HumanDecision[] = [];
  for (const blocker of blockers) {
    const picked = await ctx.ui.select(
      `${blocker.finding} ${blocker.severity} · ${blocker.ac} — ${blocker.issue}`,
      CHOICES.map((choice) => choice.label),
    );
    const action = CHOICES.find((choice) => choice.label === picked)?.action ?? "skip";
    if (action === "skip") continue;
    const reason = await ctx.ui.input(`Reason for ${action} ${blocker.finding}`);
    if (!reason?.trim()) continue;
    decisions.push({ target: blocker.finding, action, reason: reason.trim() });
  }
  if (
    decisions.length > 0 &&
    !(await ctx.ui.confirm(
      "Apply decisions?",
      `${String(decisions.length)} decision(s) on task ${String(parsed.taskId)}`,
    ))
  ) {
    return { ok: false, error: `Cancelled.\n${UNBLOCK_USAGE}` };
  }
  return unblockTask(parsed.workItemId, parsed.taskId, { decisions });
}
