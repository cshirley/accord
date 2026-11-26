/**
 * Native terminal notification (OSC 9: iTerm2/Ghostty). Handles tmux passthrough
 * via DCS escape + direct client tty write. Silent on failure.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export function terminalNotify(message: string): boolean {
  if (process.env.TMUX) {
    try {
      const tmux = (fmt: string) =>
        execFileSync("tmux", ["display-message", "-p", fmt], { encoding: "utf-8" }).trim();
      const session = tmux("#S");
      const tty = tmux("#{client_tty}");
      writeFileSync(tty, `\x1bPtmux;\x1b\x1b]9;[${session}] ${message}\x07\x1b\\`);
      return true;
    } catch {
      return false;
    }
  }
  process.stdout.write(`\x1b]9;${message}\x07`);
  return true;
}

/** True when running as a subagent child (sidebar role) — callers should not notify. */
export function isSubagentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.TMUX_AGENT_SIDEBAR_ROLE ?? "").toLowerCase() === "child";
}
