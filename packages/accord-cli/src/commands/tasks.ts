import { devTasks } from "@clive.shirley/accord-core/queries/dashboard.js";
import { parseCli } from "../cli.js";
import { executeParsed } from "../dispatch.js";
import { renderTasksDashboard, renderTasksDashboardHeader } from "../ui/tasks-display.js";
import { selectWorkItem, selectWorkItemAction } from "../ui/select.js";
import { muted } from "../ui/colors.js";

export type TasksCommandOptions = {
  json?: boolean;
  select?: boolean;
  cwd?: string;
};

export async function runTasksCommand(options: TasksCommandOptions = {}): Promise<number> {
  const dashboard = devTasks();

  if (options.json) {
    console.log(JSON.stringify(dashboard, null, 2));
    return 0;
  }

  console.log("");
  console.log(renderTasksDashboardHeader(dashboard));
  console.log("");
  console.log(renderTasksDashboard(dashboard));

  if (dashboard.attention_summary) {
    console.log("");
    console.error(dashboard.attention_summary);
  }

  if (!options.select) {
    return 0;
  }

  const selected = await selectWorkItem(dashboard.rows);
  if (!selected) {
    console.log(muted("Selection cancelled."));
    return 0;
  }

  const action = await selectWorkItemAction(selected.id);
  if (!action) {
    console.log(muted("Selection cancelled."));
    return 0;
  }

  const cwd = options.cwd ?? process.cwd();
  const parsed = parseCli([action, selected.id, "--cwd", cwd]);
  if (parsed.kind === "error") {
    console.error(parsed.message);
    return 1;
  }

  console.log("");
  console.log(muted(`Running: accord ${action} ${selected.id}`));
  console.log("");
  return executeParsed(parsed);
}
