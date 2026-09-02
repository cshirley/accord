/**
 * Programmatic entry for `@clive.shirley/accord-cli` (Pi extension client, tests, MCP).
 */

export {
  type FinishCommandResult,
  isWorkflowSubcommand,
  type PlanCommand,
  type ResumeCommandResult,
  runFinishCommand,
  runInitCommand,
  runPlanCommand,
  runResumeCommand,
  runReviewCommand,
  runSubcommandCommand,
  runTasksCommand,
  runWorkflowCommand,
  type SubcommandCommandResult,
  WORKFLOW_SUBCOMMANDS,
  type WorkflowSubcommand,
} from "./commands/index.js";
export { type CliContext, createCliContext, createCliContextFromHarnessState } from "./context.js";
export { asRuntimeHost } from "./harnesses/as-runtime-host.js";
export {
  type AgentHarness,
  type AgentHarnessId,
  createHarness,
  DEFAULT_HARNESS_ID,
  parseHarnessId,
} from "./harnesses/registry.js";
export type { AgentHarnessFactoryOptions } from "./harnesses/types.js";
