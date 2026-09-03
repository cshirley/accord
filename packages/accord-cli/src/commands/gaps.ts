import { devGaps, gapsArgsWantTickets } from "@clive.shirley/accord-core/queries/gaps.js";
import type { CliContext } from "../context.js";
import type { AgentHarness } from "../harnesses/types.js";
import { runSubcommandCommand } from "./subcommand.js";

export async function runGapsCommand(
  ctx: CliContext,
  harness: AgentHarness,
  workItemId: string,
  rawArgs: string,
  options: { json?: boolean },
): Promise<number> {
  const wantTickets = gapsArgsWantTickets(rawArgs);
  const result = devGaps(workItemId, { spawnTickets: wantTickets });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value.formatted);
  }

  if (!result.value.spawn_tickets) {
    return 0;
  }

  const spawn = await runSubcommandCommand(ctx, harness, "gaps", workItemId, rawArgs);
  return spawn.exitCode;
}
