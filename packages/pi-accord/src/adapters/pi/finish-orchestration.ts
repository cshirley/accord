/**
 * `/dev finish` via core orchestration + programmatic subagent (`ACCORD_CORE_ORCHESTRATOR=1`).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  resolveFinishOrchestration,
  runFinishOrchestrationFromResolution,
} from "../../core/orchestration/index.js";
import { devTasks } from "../../core/queries/dashboard.js";
import { devReviewQueue } from "../../core/queries/review-queue.js";
import { formatWorkflowCostForFinish } from "../../core/queries/workflow-cost.js";
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
    spawnNotifyLabel: "Finish",
  });
  if (preflight.kind !== "ready") return preflight.kind;

  const { workItemId, host } = preflight;
  activateForDevSubcommand(pi, state, "finish");

  const resolution = resolveFinishOrchestration(workItemId, state.devConfig);
  if (resolution.outcome === "blocked" || resolution.outcome === "complete") {
    for (const message of resolution.messages) {
      ctx.ui.notify(message.text, message.level === "warning" ? "warning" : "info");
    }
    return "handled";
  }

  notifyTruncated(ctx, devReviewQueue().formatted, "info");
  displayTasksDashboard(pi, ctx, devTasks().formatted);

  const result = await runFinishOrchestrationFromResolution(
    resolution,
    workItemId,
    state.devConfig,
    host,
  );

  if (result.closeout && !result.closeout.ok) {
    ctx.ui.notify(`Finish closeout: ${result.closeout.error}`, "warning");
    return "handled";
  }

  if (result.closeout?.ok) {
    ctx.ui.notify(`Finish: work item ${workItemId} finalised from verify verdict.`, "info");
  }

  const workflowCost = result.workflow_cost_formatted ?? formatWorkflowCostForFinish(workItemId);
  if (workflowCost) {
    notifyTruncated(ctx, workflowCost, "info");
  }

  return "handled";
}
