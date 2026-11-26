#!/usr/bin/env bun
/**
 * accord-tools — run pi-git / pi-integrations tools from any harness or CI.
 *
 *   accord-tools list [--json]
 *   accord-tools describe <name>
 *   accord-tools run <name> [--json-input '{"k":"v"}' | -]  [--cwd dir]
 *
 * Output: JSON {ok,text,details} on stdout. Exit 0 ok, 1 tool error, 64 usage.
 * Session-scoped wt_* tools are not included.
 */

import { neutralTools } from "./registry.js";

function usage(): number {
  console.error(
    "Usage: accord-tools list [--json] | describe <name> | run <name> [--json-input <json>|-] [--cwd dir]",
  );
  return 64;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, name, ...rest] = argv;
  const tools = neutralTools();
  if (cmd === "list") {
    const rows = tools.map((t) => ({
      name: t.name,
      kind: t.kind,
      writes: t.writes,
      description: t.description,
    }));
    if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
    else
      for (const r of rows)
        console.log(`${r.name.padEnd(32)} ${r.kind.padEnd(12)} ${r.description}`);
    return 0;
  }
  const tool = tools.find((t) => t.name === name);
  if (cmd === "describe" && tool) {
    console.log(
      JSON.stringify(
        {
          name: tool.name,
          writes: tool.writes,
          description: tool.description,
          params: tool.params,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (cmd !== "run" || !name) return usage();
  if (!tool) {
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
  process.chdir(cwd);
  const out = await tool.run(params, cwd);
  console.log(JSON.stringify(out));
  return out.ok ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
