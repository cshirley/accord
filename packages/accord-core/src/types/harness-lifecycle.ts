/**
 * Full harness lifecycle port — maps host events to core harness callables.
 *
 * Pi maps `pi-hook-listeners.ts` → this port. MCP clients wire equivalent hooks
 * in their editor (see `packages/accord-mcp/examples/cursor-hooks/`).
 */

import type { DevHarnessConfig } from "../config/index.js";
import type { OrchestrationJudgmentRequest } from "../orchestration/host.js";
import type { HarnessMutableState } from "./host.js";

export type HarnessNotifyLevel = "info" | "warning" | "error";

export interface HarnessSessionStartContext {
  cwd: string;
  devConfig: DevHarnessConfig | null;
  state: HarnessMutableState;
}

export interface HarnessArtifactValidationResult {
  valid: boolean;
  errors: string[];
}

export interface HarnessSubagentPreflightResult {
  block: boolean;
  reason?: string;
}

export interface HarnessSubagentSpawnRequest {
  agent: string;
  task: string;
  input: Record<string, unknown>;
}

export interface HarnessSubagentResultContext {
  details: unknown;
  state: HarnessMutableState;
}

/**
 * Lifecycle callbacks a host adapter may implement. All methods are optional;
 * core provides standalone functions (`validateHarnessArtifactWriteIfApplicable`,
 * `prepareSubagentToolCall`, `processSubagentToolResult`, etc.) that hosts
 * invoke from the matching hook site.
 */
export interface HarnessLifecycleHost {
  onSessionStart?(ctx: HarnessSessionStartContext): void | Promise<void>;
  onBeforeToolCall?(tool: string, input: unknown): void | Promise<void>;
  onAfterToolCall?(tool: string, result: unknown): void | Promise<void>;
  onArtifactWrite?(
    filePath: string,
    _content: string,
  ): HarnessArtifactValidationResult | Promise<HarnessArtifactValidationResult>;
  onSubagentPrepare?(
    spawn: HarnessSubagentSpawnRequest,
  ): HarnessSubagentPreflightResult | Promise<HarnessSubagentPreflightResult>;
  onSubagentResult?(result: HarnessSubagentResultContext): void | Promise<void>;
  runJudgment?(request: OrchestrationJudgmentRequest): Promise<string | undefined>;
  notify(level: HarnessNotifyLevel, text: string): void;
  /** Gather preflight confirm; defaults to auto-approve when omitted. */
  confirm?(title: string, body: string): Promise<boolean>;
}

/** No-op lifecycle host for MCP / tests — documents minimum surface. */
export function createNoopHarnessLifecycleHost(): HarnessLifecycleHost {
  return {
    notify() {},
    confirm: async () => true,
  };
}
