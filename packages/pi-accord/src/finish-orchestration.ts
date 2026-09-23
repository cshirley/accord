/**
 * `/dev finish` via accord-cli client (in-process Pi harness or subprocess).
 */

import { devTasks } from "@clive.shirley/accord-core/queries/dashboard.js";
import { devReviewQueue } from "@clive.shirley/accord-core/queries/review-queue.js";
import { formatWorkflowCostForFinish } from "@clive.shirley/accord-core/queries/workflow-cost.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { delegateFinishViaAccordCli } from "./cli-client.js";
import { displayTasksDashboard } from "./dev-formatted-display.js";
import { activateForDevSubcommand } from "./dynamic-tools.js";
import type { HookState } from "./hook-state.js";
import { notifyTruncated } from "./notify.js";
import { runOrchestratorPreflight } from "./subagent/command-preflight.js";

/**
 * @returns `handled` when the core path consumed the command; `forward` when orchestrator is disabled.
 */
export async function tryFinishViaCoreOrchestrator(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
): Promise<"handled" | "forward"> {
  const preflight = runOrchestratorPreflight(args, pi, ctx, state, {
    command: "finish",
  });
  if (preflight.kind !== "ready") return preflight.kind;

  const { workItemId } = preflight;
  activateForDevSubcommand(pi, state, "finish");

  notifyTruncated(ctx, devReviewQueue().formatted, "info");
  displayTasksDashboard(pi, ctx, devTasks().formatted);

  const result = await delegateFinishViaAccordCli(pi, ctx, state, workItemId, {
    spawnNotifyLabel: "Finish",
  });

  if (result.closeoutOk === false) {
    ctx.ui.notify("Finish closeout failed — see messages above.", "warning");
    return "handled";
  }

  if (result.closeoutOk) {
    ctx.ui.notify(`Finish: work item ${workItemId} finalised from verify verdict.`, "info");
  }

  const workflowCost = result.workflowCostFormatted ?? formatWorkflowCostForFinish(workItemId);
  if (workflowCost) {
    notifyTruncated(ctx, workflowCost, "info");
  }

  return "handled";
}
