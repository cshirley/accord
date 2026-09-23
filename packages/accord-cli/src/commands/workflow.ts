import type { CliContext } from "../context.js";
import type { AgentHarness } from "../harnesses/types.js";
import { runSubcommandCommand, type SubcommandCommandResult } from "./subcommand.js";

export const WORKFLOW_SUBCOMMANDS = ["align", "spec", "plan", "check"] as const;
export type WorkflowSubcommand = (typeof WORKFLOW_SUBCOMMANDS)[number];

export function isWorkflowSubcommand(value: string): value is WorkflowSubcommand {
  return (WORKFLOW_SUBCOMMANDS as readonly string[]).includes(value);
}

export async function runWorkflowCommand(
  ctx: CliContext,
  harness: AgentHarness,
  subcommand: WorkflowSubcommand,
  workItemId: string,
  rawArgs: string,
): Promise<SubcommandCommandResult> {
  return runSubcommandCommand(ctx, harness, subcommand, workItemId, rawArgs);
}
