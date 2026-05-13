/**
 * `/dev resume` via core orchestration + programmatic subagent (ACCORD_CORE_ORCHESTRATOR=1).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { runResumeOrchestrationWithReplans } from "../../core/orchestration/index.js";
import type { HookState } from "./hook-state.js";
import { runOrchestratorPreflight } from "./orchestrator-preflight.js";

/**
 * @returns `handled` when the core path consumed the command; `forward` to use `/skill:accord`.
 */
export async function tryResumeViaCoreOrchestrator(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
): Promise<"handled" | "forward"> {
  const preflight = runOrchestratorPreflight(args, pi, ctx, state, {
    command: "resume",
    spawnNotifyLabel: "Resume",
  });
  if (preflight.kind !== "ready") return preflight.kind;

  const { workItemId, host } = preflight;
  const result = await runResumeOrchestrationWithReplans(workItemId, state.devConfig, host);

  if (result.stalledReason === "repeat_spawn") {
    ctx.ui.notify(
      "Resume stopped: the next step would repeat the same subagent without progress. Fix task state or use `/skill:accord`.",
      "warning",
    );
  }

  if (result.lastRun.stopReason === "delegate_to_skill") {
    const initialForward =
      result.firstResolution.outcome === "forward_skill" && result.iterations === 0;
    return initialForward ? "forward" : "handled";
  }

  return "handled";
}
