import { resolveFinishOrchestration } from "@clive.shirley/accord-core/orchestration/resolve/finish.js";
import { runFinishOrchestrationFromResolution } from "@clive.shirley/accord-core/orchestration/runner.js";
import type { CliContext } from "../context.js";
import { asRuntimeHost } from "../harnesses/as-runtime-host.js";
import type { AgentHarness } from "../harnesses/types.js";
import { cliNotify } from "../notify.js";

export type FinishCommandResult = {
  exitCode: number;
  closeoutOk?: boolean;
  workflowCostFormatted?: string;
};

export async function runFinishCommand(
  ctx: CliContext,
  harness: AgentHarness,
  workItemId: string,
): Promise<FinishCommandResult> {
  ctx.state.activeWorkItem = workItemId;
  const resolution = resolveFinishOrchestration(workItemId, ctx.devConfig);
  if (resolution.outcome === "blocked" || resolution.outcome === "complete") {
    for (const message of resolution.messages ?? []) {
      cliNotify(message.level === "warning" ? "warning" : "info", message.text);
    }
    return { exitCode: resolution.outcome === "blocked" ? 1 : 0 };
  }

  const result = await runFinishOrchestrationFromResolution(
    resolution,
    workItemId,
    ctx.devConfig,
    asRuntimeHost(harness),
  );

  if (result.closeout && !result.closeout.ok) {
    cliNotify("error", result.closeout.error);
    return { exitCode: 1, closeoutOk: false };
  }
  if (result.workflow_cost_formatted) {
    cliNotify("info", result.workflow_cost_formatted);
  }

  const exit = result.lastRun.lastSpawn?.exitCode;
  return {
    exitCode: typeof exit === "number" && exit !== 0 ? exit : 0,
    closeoutOk: result.closeout?.ok,
    workflowCostFormatted: result.workflow_cost_formatted,
  };
}
