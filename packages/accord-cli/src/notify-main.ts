#!/usr/bin/env bun
/**
 * accord-notify — terminal notification (OSC 9, tmux-aware).
 *
 *   accord-notify "Ready for input"
 *   accord-notify hook claude        # Claude Code Stop/Notification hook; reads JSON on stdin
 */

import { isSubagentProcess, terminalNotify } from "@clive.shirley/accord-core/notify/terminal.js";

async function main(argv: string[]): Promise<number> {
  if (isSubagentProcess()) return 0;
  if (argv[0] === "hook" && argv[1] === "claude") {
    let message = "Ready for input";
    try {
      const payload = JSON.parse(await new Response(Bun.stdin.stream()).text()) as {
        message?: unknown;
      };
      if (typeof payload.message === "string" && payload.message) message = payload.message;
    } catch {
      // keep default message
    }
    terminalNotify(message);
    return 0;
  }
  const message = argv.join(" ").trim();
  if (!message) {
    console.error('Usage: accord-notify "<message>" | hook claude');
    return 64;
  }
  return terminalNotify(message) ? 0 : 1;
}

process.exit(await main(process.argv.slice(2)));
