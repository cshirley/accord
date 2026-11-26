#!/usr/bin/env bun
/**
 * accord-sync — make pi skills, subagents and MCP config usable from Claude Code / Codex.
 *
 *   accord-sync [--apply] [--json] [--home <dir>] [--skills <dir>]...
 *
 * Dry run by default. Symlinks skills into ~/.claude/skills (--codex: also ~/.agents/skills;
 * pi scans that dir too, so expect name-collision warnings there),
 * generates ~/.claude/agents/*.md, and writes ~/.agents/generated/mcp.{claude.json,codex.toml}.
 * Never overwrites real files; never edits ~/.claude.json or ~/.codex/config.toml.
 */

import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySync, planSync } from "@clive.shirley/accord-core/sync/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function main(argv: string[]): number {
  let home = homedir();
  const extra: string[] = [];
  let apply = false;
  let json = false;
  let codex = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--json") json = true;
    else if (a === "--codex") codex = true;
    else if (a === "--home") home = path.resolve(argv[++i] ?? home);
    else if (a === "--skills") extra.push(path.resolve(argv[++i] ?? ""));
    else {
      console.error(
        "Usage: accord-sync [--apply] [--codex] [--json] [--home dir] [--skills dir]...",
      );
      return 64;
    }
  }
  const skillSources = [
    path.join(home, ".config", "pi", "agent", "skills"),
    path.join(repoRoot, "packages", "pi-skills", "skills"),
    ...extra,
  ];
  const actions = planSync({ home, skillSources, codex });
  if (apply) applySync(actions);
  if (json) {
    console.log(JSON.stringify({ applied: apply, actions }, null, 2));
    return 0;
  }
  const label = apply ? "" : "would ";
  for (const a of actions) {
    if (a.kind === "link") console.log(`${label}link   ${a.to} -> ${a.from}`);
    else if (a.kind === "write") console.log(`${label}write  ${a.path}`);
    else if (a.kind === "warn") console.log(`warn   ${a.path}: ${a.reason}`);
    else if (a.reason !== "already linked") console.log(`skip   ${a.path}: ${a.reason}`);
  }
  if (!apply) console.log("\nDry run. Re-run with --apply to write.");
  return 0;
}

process.exit(main(process.argv.slice(2)));
