/**
 * Tool Framework — declarative tool definitions with automatic provider
 * chain wiring, schema generation, and registration.
 *
 * A tool definition is a plain object describing:
 *   • params  — simple schema (auto-converted to TypeBox)
 *   • execute — primary implementation returning domain data
 *   • mcp?    — optional MCP fallback returning the SAME domain type
 *   • format  — single place to convert domain data → { text, details }
 *
 * The framework handles: TypeBox generation, pi.registerTool() ceremony,
 * onUpdate progress, executeChain wiring, auth gating, error aggregation.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type TSchema, type TObject } from "typebox";
import {
  getMcpRegistry,
  mcpText,
  mcpJson,
  type McpToolResult,
} from "./mcp-registry.js";

// ---------------------------------------------------------------------------
// ToolDef — what each tool definition file exports
// ---------------------------------------------------------------------------

export type ParamType = "string" | "number" | "boolean" | "string[]" | "number[]";

export interface ParamDef {
  type: ParamType;
  required?: boolean;
  default?: unknown;
  description: string;
}

/** Shorthand: "string" expands to { type: "string", required: true } */
export type ParamSchema = Record<string, ParamDef | ParamType>;

export interface McpFallback<TParams, TResult> {
  /** MCP server name in mcp.json. */
  server: string;
  /** MCP tool name on that server. */
  tool: string;
  /** Map native params → MCP args. */
  mapParams: (params: TParams) => Record<string, unknown>;
  /** Map raw MCP JSON → same TResult as execute(). */
  mapResult: (raw: unknown) => TResult;
}

export interface ToolDef<TParams = Record<string, unknown>, TResult = unknown> {
  /** Unique tool name registered with pi. */
  name: string;
  /** Display label. */
  label: string;
  /** LLM-facing description. */
  description: string;
  /** Parameter schema — converted to TypeBox at registration time. */
  params: ParamSchema;
  /** Optional auth gate: if check() returns false, native provider is skipped. */
  auth?: { check: () => boolean; service: string };
  /** Progress message shown while executing. */
  progress?: string | ((params: TParams) => string);
  /** Primary implementation — returns domain data, NOT ToolReturn. */
  execute: (params: TParams) => Promise<TResult>;
  /** Optional MCP fallback. mapResult must return same TResult as execute(). */
  mcp?: McpFallback<TParams, TResult>;
  /** Format domain result into content text + details. Called once regardless of provider. */
  format: (result: TResult, params: TParams) => { text: string; details: object };
}

/**
 * Identity function for type inference. Use as:
 *   export default defineTool({ ... })
 */
export function defineTool<TParams, TResult>(
  def: ToolDef<TParams, TResult>,
): ToolDef<TParams, TResult> {
  return def;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export interface StatusTest {
  ok: boolean;
  message: string;
}

export interface CommandSetDef {
  /** Service name prefix (e.g. "jira" → /jira-setup, /jira-status). */
  service: string;
  setup?: {
    description: string;
    handler: (ctx: { ui: CommandUI }) => Promise<void>;
  };
  status?: {
    description: string;
    test: () => Promise<StatusTest>;
  };
  /** Additional named commands beyond setup/status. */
  extra?: Record<string, {
    description: string;
    handler: (args: string, ctx: { ui: CommandUI }) => Promise<void>;
  }>;
}

interface CommandUI {
 input: (prompt: string, defaultValue?: string) => Promise<string | undefined>;
 confirm: (title: string, message: string) => Promise<boolean>;
 notify: (message: string, type?: "info" | "warning" | "error") => void;
}

export function defineCommands(
  service: string,
  commands: Omit<CommandSetDef, "service">,
): CommandSetDef {
  return { service, ...commands };
}

// ---------------------------------------------------------------------------
// Schema conversion: ParamSchema → TypeBox
// ---------------------------------------------------------------------------

function normaliseParam(key: string, def: ParamDef | ParamType): ParamDef {
  if (typeof def === "string") {
    return { type: def, required: true, description: key };
  }
  // Default: required unless explicitly set to false or has a default
  if (def.required === undefined) {
    def.required = def.default === undefined;
  }
  return def;
}

function paramToTypeBox(def: ParamDef): TSchema {
  const desc = { description: def.description };
  switch (def.type) {
    case "string":    return Type.String(desc);
    case "number":    return Type.Number({ ...desc, ...(def.default !== undefined ? { default: def.default } : {}) });
    case "boolean":   return Type.Boolean({ ...desc, ...(def.default !== undefined ? { default: def.default } : {}) });
    case "string[]":  return Type.Array(Type.String(), desc);
    case "number[]":  return Type.Array(Type.Number(), desc);
    default:          return Type.String(desc);
  }
}

function schemaToTypeBox(schema: ParamSchema): TObject {
  const props: Record<string, TSchema> = {};
  for (const [key, raw] of Object.entries(schema)) {
    const def = normaliseParam(key, raw);
    let t = paramToTypeBox(def);
    if (!def.required) t = Type.Optional(t);
    props[key] = t;
  }
  return Type.Object(props);
}

// ---------------------------------------------------------------------------
// Provider chain types (kept internal — tool defs never import these)
// ---------------------------------------------------------------------------

interface ToolReturn {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface ProviderError {
  provider: string;
  error: Error;
}

class FallbackChainError extends Error {
  constructor(strategyName: string, public readonly errors: ProviderError[]) {
    const summary = errors.map((e) => `  • ${e.provider}: ${e.error.message}`).join("\n");
    super(`[${strategyName}] all ${errors.length} providers failed:\n${summary}`);
    this.name = "FallbackChainError";
  }
}

// ---------------------------------------------------------------------------
// Registration: ToolDef → pi.registerTool()
// ---------------------------------------------------------------------------

function buildProviderChain<TParams, TResult>(
  def: ToolDef<TParams, TResult>,
): Array<{ name: string; isAvailable?: () => boolean; execute: (p: TParams) => Promise<TResult> }> {
  const providers: Array<{
    name: string;
    isAvailable?: () => boolean;
    execute: (p: TParams) => Promise<TResult>;
  }> = [];

  // Provider 1: Native
  providers.push({
    name: "native",
    isAvailable: def.auth ? def.auth.check : undefined,
    execute: def.execute,
  });

  // Provider 2: MCP (if declared)
  if (def.mcp) {
    const mcp = def.mcp;
    providers.push({
      name: `mcp:${mcp.server}/${mcp.tool}`,
      isAvailable: () => getMcpRegistry().has(mcp.server),
      execute: async (params) => {
        const result = await getMcpRegistry().call(
          mcp.server,
          mcp.tool,
          mcp.mapParams(params),
        );
        if (result.isError) {
          throw new Error(`MCP tool error: ${mcpText(result)}`);
        }
        const text = mcpText(result);
        const raw = text ? JSON.parse(text) : result;
        return mcp.mapResult(raw);
      },
    });
  }

  return providers;
}

async function executeProviders<TParams, TResult>(
  name: string,
  providers: Array<{ name: string; isAvailable?: () => boolean; execute: (p: TParams) => Promise<TResult> }>,
  params: TParams,
): Promise<TResult> {
  const errors: ProviderError[] = [];

  for (const provider of providers) {
    if (provider.isAvailable && !provider.isAvailable()) continue;

    try {
      return await provider.execute(params);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push({ provider: provider.name, error });
      console.warn(`[${name}] ${provider.name} failed: ${error.message}`);
    }
  }

  if (errors.length === 0) throw new Error(`[${name}] no available providers`);
  if (errors.length === 1) throw errors[0].error;
  throw new FallbackChainError(name, errors);
}

function registerOneTool<TParams, TResult>(
  pi: ExtensionAPI,
  def: ToolDef<TParams, TResult>,
): void {
  const providers = buildProviderChain(def);
  const parameters = schemaToTypeBox(def.params);

  pi.registerTool({
    name: def.name,
    label: def.label,
    description: def.description,
    parameters,
    async execute(_toolCallId: string, params: TParams, _signal: unknown, onUpdate: any) {
      // Progress
      if (def.progress) {
        const msg = typeof def.progress === "function" ? def.progress(params) : def.progress;
        onUpdate?.({ content: [{ type: "text", text: msg }] });
      }

      // Execute provider chain → domain result
      const result = await executeProviders(def.name, providers, params);

      // Format once
      const formatted = def.format(result, params);
      return {
        content: [{ type: "text", text: formatted.text }],
        details: formatted.details,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Batch registration
// ---------------------------------------------------------------------------

/** Register an array of ToolDef objects with pi. */
export function registerToolDefs(pi: ExtensionAPI, defs: ToolDef<any, any>[]): void {
  for (const def of defs) {
    registerOneTool(pi, def);
  }
}

/** Register command sets with pi. */
export function registerCommands(pi: ExtensionAPI, sets: CommandSetDef[]): void {
  for (const set of sets) {
    if (set.setup) {
      const setup = set.setup;
      pi.registerCommand(`${set.service}-setup`, {
        description: setup.description,
        handler: async (_args, ctx) => {
          await setup.handler({ ui: ctx.ui });
        },
      });
    }

    if (set.status) {
      const status = set.status;
      pi.registerCommand(`${set.service}-status`, {
        description: status.description,
        handler: async (_args, ctx) => {
          try {
            const result = await status.test();
            ctx.ui.notify(result.message, result.ok ? "info" : "error");
          } catch (error) {
            ctx.ui.notify(
              `${set.service} status check failed: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
          }
        },
      });
    }

    if (set.extra) {
      for (const [name, cmd] of Object.entries(set.extra)) {
        pi.registerCommand(`${set.service}-${name}`, {
          description: cmd.description,
          handler: async (args, ctx) => {
            await cmd.handler(args, { ui: ctx.ui });
          },
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Re-exports for service/def files
// ---------------------------------------------------------------------------

export { getMcpRegistry, mcpText, mcpJson } from "./mcp-registry.js";
export type { McpToolResult } from "./mcp-registry.js";
