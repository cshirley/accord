/**
 * Host-neutral registry over pi-git and pi-integrations tool defs.
 * Used by the accord-tools CLI and the accord-mcp opt-in extra tools.
 */

import { gitToolDefs } from "@clive.shirley/pi-git/src/index.js";
import { integrationToolDefs } from "@clive.shirley/pi-integrations/src/index.js";

export type ParamDef = {
  type: "string" | "number" | "boolean" | "string[]" | "number[]";
  required?: boolean;
  default?: unknown;
  description?: string;
};

export type NeutralTool = {
  name: string;
  kind: "git" | "integration";
  /** True for tools that mutate external state (opt-in only on MCP). */
  writes: boolean;
  description: string;
  params: Record<string, ParamDef | ParamDef["type"]>;
  run: (params: Record<string, unknown>, cwd: string) => Promise<ToolOutput>;
  authCheck?: { check: () => boolean; service: string };
};

export type ToolOutput = { ok: boolean; text: string; details?: unknown };

type AnyDef = {
  name: string;
  description: string;
  params: NeutralTool["params"];
  execute: (p: never, ctx?: never) => Promise<unknown>;
  format?: (r: never, p: never) => { text: string; details: object };
  auth?: { check: () => boolean; service: string };
};

const WRITE_TOOLS = new Set([
  "git_commit_execute",
  "gh_pr_submit",
  "pr_review_post",
  "slack_send",
  "slack-sendMessage",
]);

function isWrite(name: string): boolean {
  return WRITE_TOOLS.has(name) || /send|post|submit|execute/i.test(name);
}

function wrap(def: AnyDef, kind: NeutralTool["kind"]): NeutralTool {
  return {
    name: def.name,
    kind,
    writes: isWrite(def.name),
    description: def.description,
    params: def.params,
    authCheck: def.auth,
    async run(params, cwd) {
      if (def.auth && !def.auth.check()) {
        return { ok: false, text: `${def.auth.service} auth not configured` };
      }
      try {
        if (kind === "git") {
          const r = (await def.execute(
            params as never,
            {
              cwd,
              signal: undefined,
              onUpdate: undefined,
              extension: undefined,
            } as never,
          )) as { text: string; details?: unknown; isError?: boolean };
          return { ok: !r.isError, text: r.text, details: r.details };
        }
        const result = await def.execute(params as never);
        const f = def.format?.(result as never, params as never);
        return { ok: true, text: f?.text ?? "", details: f?.details ?? result };
      } catch (error) {
        return { ok: false, text: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export function neutralTools(): NeutralTool[] {
  return [
    ...(gitToolDefs as unknown as AnyDef[]).map((d) => wrap(d, "git")),
    ...(integrationToolDefs as unknown as AnyDef[]).map((d) => wrap(d, "integration")),
  ];
}
