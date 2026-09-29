import {
  type HumanDecision,
  parseUnblockArgs,
  UNBLOCK_USAGE,
  unblockTask,
} from "@clive.shirley/accord-core/queries/unblock-task.js";
import { loadTaskV2 } from "@clive.shirley/accord-core/tasks/store.js";
import { bold, dim } from "../ui/colors.js";
import { promptLine } from "../ui/select.js";

const ACTION_KEYS: Record<string, HumanDecision["action"] | "skip"> = {
  n: "note",
  f: "fixed",
  a: "accept",
  w: "waive",
  s: "skip",
};

/** Walk the blockers one by one (TTY, no decision flags given). */
async function promptDecisions(workItemId: string, taskId: number): Promise<HumanDecision[]> {
  const task = loadTaskV2(workItemId, taskId);
  if (!task || task.summary.blockers.length === 0) return [];
  console.log("");
  console.log(bold(`${workItemId} task ${String(taskId)} — ${task.summary.headline}`));
  const decisions: HumanDecision[] = [];
  for (const blocker of task.summary.blockers) {
    console.log("");
    console.log(`${bold(blocker.finding)} ${blocker.severity} · ${blocker.ac} · ${blocker.state}`);
    console.log(dim(`  ${blocker.issue}`));
    const key = (await promptLine("  [n]ote  [f]ixed  [a]ccept  [w]aive  [s]kip > ")).toLowerCase();
    const action = ACTION_KEYS[key.charAt(0)] ?? "skip";
    if (action === "skip") continue;
    const reason = await promptLine("  reason > ");
    if (!reason) {
      console.log(dim("  (no reason — skipped)"));
      continue;
    }
    decisions.push({ target: blocker.finding, action, reason });
  }
  if (decisions.length === 0) return [];
  const confirm = (
    await promptLine(`Apply ${String(decisions.length)} decision(s)? [y/N] `)
  ).toLowerCase();
  return confirm.startsWith("y") ? decisions : [];
}

export async function runUnblockCommand(
  workItemId: string,
  args: string[],
  options: { json?: boolean },
): Promise<number> {
  const parsed = parseUnblockArgs([workItemId, ...args]);
  if (parsed.errors.length) {
    console.error(
      `${parsed.errors.join(" ")}\n${UNBLOCK_USAGE.replace("/dev unblock", "accord unblock")}`,
    );
    return 1;
  }
  let decisions = parsed.decisions;
  if (
    decisions.length === 0 &&
    parsed.taskId !== undefined &&
    !parsed.force &&
    !options.json &&
    process.stdin.isTTY
  ) {
    decisions = await promptDecisions(workItemId, parsed.taskId);
  }

  const result = unblockTask(workItemId, parsed.taskId, {
    decisions,
    ...(parsed.force ? { force: parsed.force } : {}),
  });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value.formatted);
  }

  return result.value.unblocked.length > 0 ? 0 : 1;
}
