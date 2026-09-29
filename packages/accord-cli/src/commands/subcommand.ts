import {
  resolveDevSubcommandOrchestration,
  runDevSubcommandOrchestrationWithReplans,
} from "@clive.shirley/accord-core/orchestration/index.js";
import type { CliContext } from "../context.js";
import { asRuntimeHost } from "../harnesses/as-runtime-host.js";
import type { AgentHarness } from "../harnesses/types.js";
import { cliNotify } from "../notify.js";

export type SubcommandCommandResult = {
  exitCode: number;
  stalledReason?: "repeat_spawn" | "needs_input" | "stuck";
};

export async function runSubcommandCommand(
  ctx: CliContext,
  harness: AgentHarness,
  subcommand: string,
  workItemId: string,
  rawArgs: string,
  options?: { allowPendingDecisions?: boolean },
): Promise<SubcommandCommandResult> {
  ctx.state.activeWorkItem = workItemId;

  const initial = resolveDevSubcommandOrchestration(
    subcommand,
    workItemId,
    rawArgs,
    ctx.devConfig,
    {
      allowPendingDecisions: options?.allowPendingDecisions,
    },
  );
  if (initial.outcome === "blocked" || initial.outcome === "complete") {
    for (const message of initial.messages ?? []) {
      cliNotify(message.level === "warning" ? "warning" : "info", message.text);
    }
    return { exitCode: initial.outcome === "blocked" ? 1 : 0 };
  }

  const result = await runDevSubcommandOrchestrationWithReplans(
    subcommand,
    workItemId,
    rawArgs,
    ctx.devConfig,
    asRuntimeHost(harness),
    { allowPendingDecisions: options?.allowPendingDecisions },
  );

  if (result.stalledReason === "repeat_spawn") {
    cliNotify("warning", "Orchestration stalled: repeated spawn fingerprint.");
    return { exitCode: 1, stalledReason: "repeat_spawn" };
  }
  if (result.stalledReason === "needs_input") {
    cliNotify("warning", "Orchestration paused: agent returned needs_input.");
    return { exitCode: 2, stalledReason: "needs_input" };
  }
  if (result.stalledReason === "stuck") {
    cliNotify(
      "warning",
      `Orchestration paused: agent is stuck. See decisions[] in the work item JSON to answer, then re-run \`accord ${subcommand} ${workItemId}\`.`,
    );
    return { exitCode: 2, stalledReason: "stuck" };
  }

  const exit = result.lastRun.lastSpawn?.exitCode;
  return { exitCode: typeof exit === "number" && exit !== 0 ? exit : 0 };
}
