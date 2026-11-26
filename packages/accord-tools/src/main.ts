#!/usr/bin/env bun
/**
 * accord-tools — run pi-git / pi-integrations tools from any harness or CI.
 *
 *   accord-tools list [--json]
 *   accord-tools describe <name>
 *   accord-tools run <name> [--json-input '{"k":"v"}' | -]  [--cwd dir]
 *
 * Output: JSON {ok,text,details} on stdout. Exit 0 ok, 1 tool error, 64 usage.
 * Interactive-only/session-scoped tools (wt_*) are not included.
 */

import { gitToolDefs } from "@clive.shirley/pi-git/src/index.js";
import { integrationToolDefs } from "@clive.shirley/pi-integrations/src/index.js";

type AnyDef = {
  name: string;
  description: string;
  params: Record<string, unknown>;
  execute: (p: never, ctx?: never) => Promise<unknown>;
  format?: (r: never, p: never) => { text: string; details: object };
  auth?: { check: () => boolean; service: string };
};

const gitNames = new Set(gitToolDefs.map((d) => d.name));
const defs: AnyDef[] = [...gitToolDefs, ...integrationToolDefs] as unknown as AnyDef[];

function usage(): number {
  console.error(
    "Usage: accord-tools list [--json] | describe <name> | run <name> [--json-input <json>|-] [--cwd dir]",
  );
  return 64;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, name, ...rest] = argv;
  if (cmd === "list") {
    const json = argv.includes("--json");
    const rows = defs.map((d) => ({
      name: d.name,
      kind: gitNames.has(d.name) ? "git" : "integration",
      description: d.description,
    }));
    if (json) console.log(JSON.stringify(rows, null, 2));
    else
      for (const r of rows)
        console.log(`${r.name.padEnd(32)} ${r.kind.padEnd(12)} ${r.description}`);
    return 0;
  }
  const def = defs.find((d) => d.name === name);
  if (cmd === "describe" && def) {
    console.log(
      JSON.stringify({ name: def.name, description: def.description, params: def.params }, null, 2),
    );
    return 0;
  }
  if (cmd !== "run" || !name) return usage();
  if (!def) {
    console.error(`Unknown tool: ${name}. Try: accord-tools list`);
    return 64;
  }

  let input = "{}";
  let cwd = process.cwd();
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--json-input") {
      const v = rest[++i];
      input = v === "-" ? await new Response(Bun.stdin.stream()).text() : (v ?? "{}");
    } else if (rest[i] === "--cwd") cwd = rest[++i] ?? cwd;
  }
  let params: Record<string, unknown>;
  try {
    params = JSON.parse(input || "{}");
  } catch {
    console.error("--json-input is not valid JSON");
    return 64;
  }
  if (def.auth && !def.auth.check()) {
    console.log(JSON.stringify({ ok: false, text: `${def.auth.service} auth not configured` }));
    return 1;
  }

  try {
    if (gitNames.has(def.name)) {
      const r = (await def.execute(
        params as never,
        {
          cwd,
          signal: undefined,
          onUpdate: undefined,
          extension: undefined,
        } as never,
      )) as { text: string; details?: unknown; isError?: boolean };
      console.log(JSON.stringify({ ok: !r.isError, text: r.text, details: r.details }));
      return r.isError ? 1 : 0;
    }
    process.chdir(cwd);
    const result = await def.execute(params as never);
    const f = def.format?.(result as never, params as never);
    console.log(JSON.stringify({ ok: true, text: f?.text ?? "", details: f?.details ?? result }));
    return 0;
  } catch (error) {
    console.log(
      JSON.stringify({ ok: false, text: error instanceof Error ? error.message : String(error) }),
    );
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
