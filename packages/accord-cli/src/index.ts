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
export {
  buildCursorAgentPrompt,
  CURSOR_AGENT_EXEC_COMMAND,
  CURSOR_AGENT_EXEC_HARNESS,
  resolveCursorAgentModel,
} from "./harnesses/cursor-agent-exec.js";
export { formatCursorAgentCliModel } from "./harnesses/cursor-agent-model.js";
export {
  CLAUDE_CODE_EXEC_COMMAND,
  CLAUDE_CODE_EXEC_HARNESS,
  runClaudeCodeExec,
} from "./harnesses/claude-code-exec.js";
export { formatClaudeCodeCliEffort, formatClaudeCodeCliModel } from "./harnesses/claude-code-model.js";
export {
  createPiHarness,
  PI_EXEC_COMMAND,
  PI_EXEC_HARNESS,
  runPiExec,
  runPiExecSpawn,
} from "./harnesses/pi-exec.js";
export {
  formatClaudeCodeTools,
  inferAgentNamespace,
  loadAgentFromSpawnFile,
  resolveSpawnModelFromAgentFile,
} from "./harnesses/exec-agent-shared.js";
