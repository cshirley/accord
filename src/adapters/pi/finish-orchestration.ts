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
import type { HookState } from "./hook-state.js";
import { runOrchestratorPreflight } from "./orchestrator-preflight.js";

const NOTIFY_SLICE = 3500;

function notifyTruncated(
  ctx: ExtensionCommandContext,
  body: string,
  level: "info" | "warning",
): void {
  ctx.ui.notify(
    body.length > NOTIFY_SLICE ? `${body.slice(0, NOTIFY_SLICE)}\n…(truncated)` : body,
    level,
  );
}

/**
 * @returns `handled` when the core path consumed the command; `forward` to use `/skill:accord`.
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

  const resolution = resolveFinishOrchestration(workItemId, state.devConfig);
  if (resolution.outcome === "forward_skill") {
    return "forward";
  }

  notifyTruncated(ctx, devReviewQueue().formatted, "info");
  notifyTruncated(ctx, devTasks().formatted, "info");

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

  return "handled";
}
