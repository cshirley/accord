import { devDeviations } from "@clive.shirley/accord-core/queries/deviations.js";
import type { CliContext } from "../context.js";
import type { AgentHarness } from "../harnesses/types.js";
import { runSubcommandCommand } from "./subcommand.js";

export async function runDeviationsCommand(
  ctx: CliContext,
  harness: AgentHarness,
  workItemId: string,
  rawArgs: string,
  options: { json?: boolean },
): Promise<number> {
  const fullArgs = [workItemId, rawArgs].filter(Boolean).join(" ");
  const result = devDeviations(fullArgs);
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value.formatted);
  }

  if (!result.value.spawn_review) {
    return 0;
  }

  const spawn = await runSubcommandCommand(ctx, harness, "deviations", workItemId, rawArgs);
  return spawn.exitCode;
}
