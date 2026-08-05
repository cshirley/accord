/**
 * Core orchestration entry for `/dev` subcommands (align, spec, plan, gaps, …).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  isCoreOrchestratorEnabled,
  planDevResumeOrchestration,
  resolveDevSubcommandOrchestration,
  runDevSubcommandOrchestrationWithReplans,
  runResumeOrchestrationWithReplans,
} from "../../core/orchestration/index.js";
import { devResumeState } from "../../core/queries/resume-state.js";
import type { HookState } from "./hook-state.js";
import {
  activateForDevSubcommand,
  activateForDispatchAgent,
} from "./dynamic-tools.js";
import { runOrchestratorPreflight } from "./subagent/command-preflight.js";

export const ORCHESTRATOR_DISABLED_MESSAGE =
  "ACCORD core orchestrator is disabled (ACCORD_CORE_ORCHESTRATOR=0). The bundled accord skill was removed — unset the variable or set ACCORD_CORE_ORCHESTRATOR=1 (default).";

function notifyOrchestrationPreview(
  ctx: ExtensionCommandContext,
  workItemId: string,
  subcommand: string,
  plan: ReturnType<typeof planDevResumeOrchestration>,
): void {
  const rs = devResumeState(workItemId);
  if (rs.ok) {
    const v = rs.value;
    const checkpoint = v.has_checkpoint ? ` · checkpoint ${v.checkpoint_phase}` : "";
    ctx.ui.notify(
      `${subcommand} ${workItemId} — ${v.title}\nphase: ${v.phase}${checkpoint} · ${v.pattern}${v.variant ? `/${v.variant}` : ""}`,
      "info",
    );
  } else {
    ctx.ui.notify(rs.error, "warning");
  }

  if (plan.outcome === "spawn") {
    ctx.ui.notify(
      `${subcommand}: spawning ${plan.agent}… (runs in a separate process; may take several minutes)`,
      "info",
    );
  }
}

/**
 * @returns `handled` when consumed; `orchestrator_disabled` when the env flag blocks core routing.
 */
export async function tryDevSubcommandViaCoreOrchestrator(
  subcommand: string,
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
): Promise<"handled" | "orchestrator_disabled"> {
  if (!isCoreOrchestratorEnabled()) {
    return "orchestrator_disabled";
  }

  const preflight = runOrchestratorPreflight(args, pi, ctx, state, {
    command: subcommand,
    spawnNotifyLabel: subcommand,
  });
  if (preflight.kind !== "ready") {
    return preflight.kind === "forward" ? "orchestrator_disabled" : "handled";
  }

  const { workItemId, host } = preflight;
  activateForDevSubcommand(pi, state, subcommand);

  const initialPlan =
    subcommand === "resume"
      ? planDevResumeOrchestration(workItemId, state.devConfig)
      : resolveDevSubcommandOrchestration(subcommand, workItemId, args, state.devConfig);

  if (initialPlan.outcome === "spawn") {
    activateForDispatchAgent(pi, state, initialPlan.agent);
  }

  notifyOrchestrationPreview(ctx, workItemId, subcommand, initialPlan);

  const result =
    subcommand === "resume"
      ? await runResumeOrchestrationWithReplans(workItemId, state.devConfig, host)
      : await runDevSubcommandOrchestrationWithReplans(
          subcommand,
          workItemId,
          args,
          state.devConfig,
          host,
        );

  if (result.stalledReason === "repeat_spawn") {
    ctx.ui.notify(
      "Orchestration stopped: the next step would repeat the same subagent without progress. Check work item phase and artifacts on disk, then run `/dev resume <ID>` or `dev_transition`.",
      "warning",
    );
  }

  return "handled";
}

/**
 * After classify preflight, continue via resume orchestration when a work item id is known.
 */
export async function tryClassifyFollowUpViaCoreOrchestrator(
  text: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
): Promise<"handled" | "orchestrator_disabled" | "needs_main_session"> {
  if (!isCoreOrchestratorEnabled()) {
    return "orchestrator_disabled";
  }

  const ticketMatch = /^([A-Z]+(?:-[A-Z]+)*-\d+)\b/.exec(text.trim());
  const workItemId = ticketMatch?.[1] ?? null;
  if (!workItemId) {
    return "needs_main_session";
  }

  const outcome = await tryDevSubcommandViaCoreOrchestrator("resume", workItemId, pi, ctx, state);
  return outcome === "orchestrator_disabled" ? "orchestrator_disabled" : "handled";
}
