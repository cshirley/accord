import { isCoreOrchestratorEnabled } from "@clive.shirley/accord-core/orchestration/env.js";
import { runResumeOrchestrationWithReplans } from "@clive.shirley/accord-core/orchestration/runner.js";
import type { CliContext } from "../context.js";
import { asRuntimeHost } from "../harnesses/as-runtime-host.js";
import type { AgentHarness } from "../harnesses/types.js";
import { cliNotify } from "../notify.js";

export type ResumeCommandResult = {
  exitCode: number;
  stalledReason?: "repeat_spawn" | "needs_input";
};

export async function runResumeCommand(
  ctx: CliContext,
  harness: AgentHarness,
  workItemId: string,
): Promise<ResumeCommandResult> {
  if (!isCoreOrchestratorEnabled()) {
    cliNotify("error", "ACCORD_CORE_ORCHESTRATOR is disabled. Unset ACCORD_CORE_ORCHESTRATOR=0.");
    return { exitCode: 1 };
  }

  ctx.state.activeWorkItem = workItemId;
  const result = await runResumeOrchestrationWithReplans(
    workItemId,
    ctx.devConfig,
    asRuntimeHost(harness),
  );

  if (result.stalledReason === "repeat_spawn") {
    cliNotify("warning", "Resume stalled: repeated spawn fingerprint.");
    return { exitCode: 1, stalledReason: "repeat_spawn" };
  }
  if (result.stalledReason === "needs_input") {
    cliNotify("warning", "Resume paused: agent returned needs_input.");
    return { exitCode: 2, stalledReason: "needs_input" };
  }

  const exit = result.lastRun.lastSpawn?.exitCode;
  return { exitCode: typeof exit === "number" && exit !== 0 ? exit : 0 };
}
