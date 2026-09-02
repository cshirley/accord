/**
 * Host-neutral tool definition surface.
 *
 * One registry of `ToolDefinition`s feeds both the Pi and MCP adapters — the
 * adapters compile `parameters` (TypeBox) to their native schema (TypeBox
 * is passed through to Pi; Zod is generated via `compileSchemaToZodShape`)
 * and translate `ToolHandlerResult` to their native envelope.
 */

import type { Static, TSchema } from "typebox";
import type { DevHarnessConfig } from "../config/types.js";
import type {
  DevOrchestrateCommand,
  DevOrchestrateExecutionResult,
  DevOrchestrateHostHints,
} from "../orchestration/plan.js";
import type { SubagentPreflightHostHints } from "../queries/subagent-preflight-shared.js";

export interface ToolHandlerContext {
  /** Returns the live ACCORD dev harness config (or `null` when not loaded). */
  getConfig: () => DevHarnessConfig | null;
  /** Pi host: scoped models + resolved judgment model for preflight diagnostics. */
  getSubagentPreflightHints?: () => SubagentPreflightHostHints | undefined;
  /** MCP / CLI host: harness id + spawn capability for `dev_orchestrate`. */
  getOrchestrateHostHints?: () => DevOrchestrateHostHints | undefined;
  /** When set, `dev_orchestrate` with `execute: true` (or host default) runs resume/finish. */
  executeOrchestration?: (
    command: DevOrchestrateCommand,
    workItemId: string,
  ) => Promise<DevOrchestrateExecutionResult>;
}

export interface ToolHandlerResult {
  ok: boolean;
  /** Human-readable text body. Adapters prefix `⚠ ` when `ok=false`. */
  text: string;
  /** Optional structured detail; surfaced as `details` (Pi) or appended JSON (MCP). */
  details?: unknown;
}

export type ToolHandler<TParams> = (
  params: TParams,
  ctx: ToolHandlerContext,
) => Promise<ToolHandlerResult> | ToolHandlerResult;

/**
 * Use {@link defineTool} to create a value of this type — it preserves the
 * TypeBox `Static<TParams>` inference into the handler.
 */
export interface ToolDefinition<TParams extends TSchema = TSchema> {
  name: string;
  /** Short label for the Pi UI. Ignored by MCP. */
  label: string;
  /** One-line tool description. Shared by Pi and MCP. */
  description: string;
  /** LLM prompt hint surfaced by Pi via `promptSnippet`. Ignored by MCP. */
  promptSnippet: string;
  /** Optional Pi `Guidelines` bullets while the tool is active. Ignored by MCP. */
  promptGuidelines?: string[];
  /** TypeBox schema for the tool parameters (always a `Type.Object(...)`). */
  parameters: TParams;
  /** Host-neutral handler called by both adapters. */
  handler: ToolHandler<Static<TParams>>;
}

/**
 * Identity helper that types the handler from the TypeBox `parameters` schema.
 * Stored in arrays as `ToolDefinition<TSchema>` (the per-tool param type is
 * erased there but preserved inside the call).
 */
export function defineTool<TParams extends TSchema>(
  def: ToolDefinition<TParams>,
): ToolDefinition<TSchema> {
  return def as unknown as ToolDefinition<TSchema>;
}
