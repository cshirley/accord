/**
 * `/dev resume` via core orchestration + programmatic subagent (ACCORD_CORE_ORCHESTRATOR=1).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  planDevResumeOrchestration,
  runResumeOrchestrationWithReplans,
} from "../../core/orchestration/index.js";
import type { ResumeOrchestrationResolution } from "../../core/orchestration/types.js";
import { devResumeState } from "../../core/queries/resume-state.js";
import type { HookState } from "./hook-state.js";
import { runOrchestratorPreflight } from "./subagent/command-preflight.js";

function notifyResumePlanPreview(
  ctx: ExtensionCommandContext,
  workItemId: string,
  plan: ResumeOrchestrationResolution,
): void {
  const rs = devResumeState(workItemId);
  if (rs.ok) {
    const v = rs.value;
    const checkpoint = v.has_checkpoint ? ` · checkpoint ${v.checkpoint_phase}` : "";
    ctx.ui.notify(
      `Resume ${workItemId} — ${v.title}\nphase: ${v.phase}${checkpoint} · ${v.pattern}${v.variant ? `/${v.variant}` : ""}`,
      "info",
    );
  } else {
    ctx.ui.notify(rs.error, "warning");
  }

  if (plan.outcome === "spawn") {
    ctx.ui.notify(
      `Resume: spawning ${plan.agent}… (runs in a separate process; may take several minutes)`,
      "info",
    );
  } else if (plan.outcome === "forward_skill") {
    ctx.ui.notify(`Resume: forwarding to accord skill — ${plan.reason}`, "info");
  }
}

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
  const initialPlan = planDevResumeOrchestration(workItemId, state.devConfig);
  notifyResumePlanPreview(ctx, workItemId, initialPlan);

  const result = await runResumeOrchestrationWithReplans(workItemId, state.devConfig, host);

  if (result.stalledReason === "repeat_spawn") {
    ctx.ui.notify(
      "Resume stopped: the next step would repeat the same subagent without progress (work item phase did not advance after the last spawn). If planning artifacts exist on disk, ensure the extension is up to date; otherwise run `/skill:accord resume <ID>` or call `dev_transition`.",
      "warning",
    );
  }

  if (result.lastRun.stopReason === "delegate_to_skill") {
    const initialForward =
      result.firstResolution.outcome === "forward_skill" && result.iterations === 0;
    if (!initialForward) {
      const reason =
        result.lastRun.delegateReason ??
        (result.firstResolution.outcome === "forward_skill"
          ? result.firstResolution.reason
          : "delegate to accord skill");
      ctx.ui.notify(`Resume: ${reason}`, "warning");
    }
    return initialForward ? "forward" : "handled";
  }

  return "handled";
}
