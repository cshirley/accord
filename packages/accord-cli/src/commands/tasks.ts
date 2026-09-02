import { devTasks } from "@clive.shirley/accord-core/queries/dashboard.js";

export function runTasksCommand(options: { json?: boolean }): number {
  const dashboard = devTasks();

  if (options.json) {
    console.log(JSON.stringify(dashboard, null, 2));
    return 0;
  }

  for (const item of dashboard.rows) {
    const cost = item.display_cost_usd > 0 ? ` $${item.display_cost_usd.toFixed(4)}` : "";
    console.log(`${item.id}\t${item.phase}\t${item.title ?? ""}${cost}`);
  }
  if (dashboard.attention_summary) {
    console.error(dashboard.attention_summary);
  }
  return 0;
}
