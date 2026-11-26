#!/usr/bin/env bun
/**
 * accord-guardrail — harness-neutral risky-command check.
 *
 *   accord-guardrail check "<cmd>" [--json]     exit 0 allow, 1 ask, 2 deny
 *   echo "<cmd>" | accord-guardrail check -
 *   accord-guardrail hook claude                Claude Code PreToolUse hook (JSON on stdin)
 */

import {
  checkCommand,
  claudeHookOutput,
  commandFromHookPayload,
  verdictExitCode,
} from "@clive.shirley/accord-core/guardrail/index.js";

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === "hook" && rest[0] === "claude") {
    let payload: unknown;
    try {
      payload = JSON.parse(await readStdin());
    } catch {
      return 0; // never break the host on malformed input
    }
    const command = commandFromHookPayload(payload);
    if (command === null) return 0;
    const out = claudeHookOutput(checkCommand(command));
    if (out) console.log(JSON.stringify(out));
    return 0;
  }

  if (sub === "check") {
    const json = rest.includes("--json");
    const args = rest.filter((a) => a !== "--json");
    const command =
      args[0] === "-" || args.length === 0 ? (await readStdin()).trimEnd() : args.join(" ");
    const verdict = checkCommand(command);
    if (json) console.log(JSON.stringify(verdict));
    else if (verdict.action !== "allow") console.error(`${verdict.action}: ${verdict.reason}`);
    return verdictExitCode(verdict);
  }

  console.error("Usage: accord-guardrail check <cmd|-> [--json] | hook claude");
  return 64;
}

process.exit(await main(process.argv.slice(2)));
