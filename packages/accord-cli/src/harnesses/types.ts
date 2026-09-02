/**
 * Agent harness port — one backend per AI runtime (Pi, exec, Claude Code, …).
 * Core orchestration depends on {@link OrchestrationRuntimeHost}; this alias
 * documents the CLI-facing name for the same contract.
 */

import type {
  OrchestrationJudgmentRequest,
  OrchestrationNotifyLevel,
  OrchestrationRuntimeHost,
} from "@clive.shirley/accord-core/orchestration/host.js";
import type { SubagentSpawnResult } from "@clive.shirley/accord-core/orchestration/types.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";

export type AgentHarnessId = "pi" | "exec";

export type AgentHarness = OrchestrationRuntimeHost & {
  readonly id: AgentHarnessId;
  readonly cwd: string;
};

export type AgentHarnessFactoryOptions = {
  cwd: string;
  state: HarnessMutableState;
  /** When true, gather preflight auto-confirms missing providers (non-interactive). */
  autoConfirm?: boolean;
  /** Tool names exposed to gather preflight (empty = skip MCP tool checks). */
  availableToolNames?: Set<string>;
  spawnNotifyLabel?: string;
  notify?: (level: OrchestrationNotifyLevel, text: string) => void;
};

export type { OrchestrationJudgmentRequest, OrchestrationRuntimeHost, SubagentSpawnResult };
