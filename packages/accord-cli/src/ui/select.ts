/**
 * Interactive numbered selection for work items and actions.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { TasksDashboardRow } from "@clive.shirley/accord-core/queries/dashboard.js";
import { accent, bold, dim, muted } from "./colors.js";
import { WORK_ITEM_ACTIONS } from "./command-catalog.js";

export type SelectOptions = {
  prompt?: string;
  allowCancel?: boolean;
};

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export function formatWorkItemChoice(row: TasksDashboardRow, index: number): string {
  const status = row.completed_at ? dim("done") : accent(row.phase);
  const title = row.title ? dim(` · ${row.title}`) : "";
  const tasks =
    row.tasks_total > 0
      ? dim(` · ${row.tasks_done}/${row.tasks_total} tasks`)
      : "";
  return `  ${dim(String(index + 1).padStart(2))}  ${bold(row.id)}  ${status}${tasks}${title}`;
}

export async function selectWorkItem(rows: TasksDashboardRow[]): Promise<TasksDashboardRow | null> {
  const active = rows.filter((row) => !row.completed_at);
  const choices = active.length > 0 ? active : rows;
  if (choices.length === 0) return null;

  console.log("");
  console.log(bold("Select a work item"));
  for (const [index, row] of choices.entries()) {
    console.log(formatWorkItemChoice(row, index));
  }
  console.log("");
  console.log(muted("Enter number or id · Esc/^C to cancel"));
  const answer = await promptLine(`${accent("›")} `);
  if (!answer) return null;

  const asNumber = Number.parseInt(answer, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= choices.length) {
    return choices[asNumber - 1] ?? null;
  }

  const match = choices.find((row) => row.id.toLowerCase() === answer.toLowerCase());
  return match ?? null;
}

export async function selectWorkItemAction(workItemId: string): Promise<string | null> {
  console.log("");
  console.log(bold(`Actions for ${workItemId}`));
  for (const [index, action] of WORK_ITEM_ACTIONS.entries()) {
    console.log(`  ${dim(String(index + 1).padStart(2))}  ${accent(action)}`);
  }
  console.log("");
  const answer = await promptLine(`${accent("›")} `);
  if (!answer) return null;

  const asNumber = Number.parseInt(answer, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= WORK_ITEM_ACTIONS.length) {
    return WORK_ITEM_ACTIONS[asNumber - 1] ?? null;
  }

  const normalized = answer.toLowerCase();
  return WORK_ITEM_ACTIONS.find((action) => action === normalized) ?? null;
}
