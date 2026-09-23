import {
  buildDevOrchestratePayload,
  type DevOrchestrateCommand,
  type DevOrchestrateExecutionResult,
  type DevOrchestrateHostHints,
  enrichDevOrchestratePayload,
} from "@clive.shirley/accord-core/orchestration/plan.js";
import type { CliContext } from "../context.js";
import { cliNotify } from "../notify.js";

export type PlanCommand = DevOrchestrateCommand;

export function buildPlanPayload(
  ctx: CliContext,
  command: PlanCommand,
  workItemId: string,
  hints: DevOrchestrateHostHints = {
    harness: "cli",
    programmatic_spawn_supported: true,
  },
  execution?: DevOrchestrateExecutionResult,
) {
  const payload = buildDevOrchestratePayload(command, workItemId, ctx.devConfig);
  return enrichDevOrchestratePayload(payload, hints, execution);
}

export function runPlanCommand(
  ctx: CliContext,
  command: PlanCommand,
  workItemId: string,
  options: { json?: boolean },
): number {
  const enriched = buildPlanPayload(ctx, command, workItemId);

  if (options.json) {
    console.log(JSON.stringify(enriched, null, 2));
    return 0;
  }

  const { resolution } = enriched;
  cliNotify("info", `command: ${command}`);
  cliNotify("info", `resolution outcome: ${resolution.outcome}`);
  if (resolution.outcome === "spawn" && "agent" in resolution) {
    cliNotify("info", `agent: ${resolution.agent}`);
  }
  for (const step of enriched.next_steps) {
    cliNotify("info", `next: ${JSON.stringify(step)}`);
  }
  return 0;
}
