/**
 * Host ports for orchestration — implemented by Pi / MCP / tests.
 *
 * `OrchestrationHost` is the always-on port for notify / confirm / tool discovery.
 * `OrchestrationRuntimeHost` extends it for the executing paths (`/dev resume`,
 * `/dev finish`) — those add subagent spawning and an optional bounded LLM
 * judgment hook (`runJudgment`). Core validates judgment JSON against
 * `schemas/orchestration-judgment-packet.json` before merging it into the
 * outbound task text.
 */

import type { SubagentSpawnResult } from "./types.js";

export type OrchestrationNotifyLevel = "info" | "warning" | "error";

export interface OrchestrationHost {
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  notify(level: OrchestrationNotifyLevel, text: string): void;
  confirm(title: string, body: string): Promise<boolean>;
  /** Tool names registered in the current session (gather preflight). */
  availableToolNames(): Set<string>;
}

export type OrchestrationJudgmentRequest = {
  /** Registry id for logging only — host must not use this to route or spawn. */
  dispatchAgent: string;
  workItemId: string;
  baseTask: string;
};

/**
 * Subset of {@link OrchestrationHost} used by the runner — `notify` plus
 * subagent spawning and an optional bounded LLM judgment hook.
 */
export type OrchestrationRuntimeHost = Pick<OrchestrationHost, "notify"> & {
  spawnSubagent(input: { agent: string; task: string }): Promise<SubagentSpawnResult>;
  /**
   * Optional bounded LLM call returning **raw assistant text** (may include JSON).
   * Core validates against `schemas/orchestration-judgment-packet.json` before merge.
   */
  runJudgment?(request: OrchestrationJudgmentRequest): Promise<string | undefined>;
};
