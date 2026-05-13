/**
 * Host port for orchestration — implemented by Pi / MCP / tests.
 *
 * Phase 5: optional bounded LLM judgment lives on `OrchestrationRuntimeHost` in `runner.ts`
 * (`runJudgment`); Pi implements it, MCP/tests may omit. Core validates judgment JSON before merge.
 */

export type OrchestrationNotifyLevel = "info" | "warning" | "error";

export interface OrchestrationHost {
  readonly cwd: string;
  readonly signal: AbortSignal | undefined;
  notify(level: OrchestrationNotifyLevel, text: string): void;
  confirm(title: string, body: string): Promise<boolean>;
  /** Tool names registered in the current session (gather preflight). */
  availableToolNames(): Set<string>;
}
