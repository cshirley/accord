/**
 * Git tool framework — declarative defs + batch registration (pi-integrations pattern).
 *
 * Add a tool: create defs/<name>.ts exporting defineTool({ ... }), import in index.ts.
 * Add a slash command: commands/*.commands.ts exporting defineSlashCommand({ ... }).
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type TObject, type TSchema, Type } from "typebox";

export type ParamType = "string" | "number" | "boolean" | "string[]" | "number[]";

export interface ParamDef {
  type: ParamType;
  required?: boolean;
  default?: unknown;
  description: string;
}

export type ParamSchema = Record<string, ParamDef | ParamType>;

export interface GitToolExecuteContext {
  cwd: string;
  signal: AbortSignal | undefined;
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined;
  extension: ExtensionContext;
}

export interface FormattedToolResult {
  text: string;
  details?: unknown;
  isError?: boolean;
}

export interface ToolDef<TParams = Record<string, unknown>> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  params: ParamSchema;
  progress?: string | ((params: TParams) => string);
  execute: (params: TParams, ctx: GitToolExecuteContext) => Promise<FormattedToolResult>;
}

export function defineTool<TParams>(def: ToolDef<TParams>): ToolDef<TParams> {
  return def;
}

export interface SlashCommandDef {
  name: string;
  description: string;
  handler: (
    args: string,
    ctx: ExtensionContext & {
      ui: ExtensionContext["ui"] & {
        input: (prompt: string, defaultValue?: string) => Promise<string | undefined>;
        confirm: (title: string, message: string) => Promise<boolean>;
        notify: (message: string, type?: "info" | "warning" | "error") => void;
      };
      hasUI?: boolean;
    },
  ) => Promise<void>;
}

export function defineSlashCommand(def: SlashCommandDef): SlashCommandDef {
  return def;
}

function normaliseParam(key: string, def: ParamDef | ParamType): ParamDef {
  if (typeof def === "string") {
    return { type: def, required: true, description: key };
  }
  if (def.required === undefined) {
    def.required = def.default === undefined;
  }
  return def;
}

function paramToTypeBox(def: ParamDef): TSchema {
  const desc = { description: def.description };
  switch (def.type) {
    case "string":
      return Type.String(desc);
    case "number":
      return Type.Number({
        ...desc,
        ...(def.default !== undefined ? { default: def.default } : {}),
      });
    case "boolean":
      return Type.Boolean({
        ...desc,
        ...(def.default !== undefined ? { default: def.default } : {}),
      });
    case "string[]":
      return Type.Array(Type.String(), desc);
    case "number[]":
      return Type.Array(Type.Number(), desc);
    default:
      return Type.String(desc);
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

function registerOneTool<TParams>(pi: ExtensionAPI, def: ToolDef<TParams>): void {
  const parameters = schemaToTypeBox(def.params);

  pi.registerTool({
    name: def.name,
    label: def.label,
    description: def.description,
    ...(def.promptSnippet ? { promptSnippet: def.promptSnippet } : {}),
    parameters,
    async execute(_toolCallId, params: TParams, signal, onUpdate, extensionCtx) {
      if (def.progress) {
        const msg = typeof def.progress === "function" ? def.progress(params) : def.progress;
        onUpdate?.({ content: [{ type: "text", text: msg }], details: undefined });
      }

      const result = await def.execute(params, {
        cwd: extensionCtx.cwd,
        signal: signal as AbortSignal | undefined,
        onUpdate,
        extension: extensionCtx,
      });

      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
        ...(result.isError ? { isError: true } : {}),
      };
    },
  });
}

export function registerToolDefs(pi: ExtensionAPI, defs: readonly unknown[]): void {
  for (const def of defs) {
    registerOneTool(pi, def as ToolDef);
  }
}

export function registerSlashCommands(pi: ExtensionAPI, commands: SlashCommandDef[]): void {
  for (const cmd of commands) {
    pi.registerCommand(cmd.name, {
      description: cmd.description,
      handler: async (args, ctx) => {
        await cmd.handler(args, ctx as Parameters<SlashCommandDef["handler"]>[1]);
      },
    });
  }
}
