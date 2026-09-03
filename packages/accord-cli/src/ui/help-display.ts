/**
 * Colored CLI help output.
 */

import { TOP_LEVEL_COMMANDS } from "./command-catalog.js";
import { accent, bold, dim, heading, muted } from "./colors.js";

export function renderHelp(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(heading("accord") + dim(" — standalone ACCORD orchestrator"));
  lines.push("");
  lines.push(bold("Usage"));
  lines.push(`  ${accent("accord")} ${dim("<command>")} [args] [options]`);
  lines.push(`  ${accent("accord")} ${dim("(interactive shell when no command in a TTY)")}`);
  lines.push("");
  lines.push(bold("Commands"));
  const nameWidth = Math.max(...TOP_LEVEL_COMMANDS.map((command) => command.name.length));
  for (const command of TOP_LEVEL_COMMANDS) {
    const usage = command.usage ?? command.name;
    const padded = command.name.padEnd(nameWidth);
    lines.push(`  ${accent(padded)}  ${dim(command.summary)}`);
    if (command.usage && command.usage !== command.name) {
      lines.push(`${" ".repeat(nameWidth + 4)}${muted(`usage: ${usage}`)}`);
    }
  }
  lines.push("");
  lines.push(bold("Options"));
  const options: Array<[string, string]> = [
    ["--harness <id>", "Agent backend (pi, claude, cursor, exec)"],
    ["--cwd <dir>", "Project root"],
    ["--json", "Machine-readable output"],
    ["--select", "Pick a work item interactively (tasks)"],
    ["--no-color", "Disable ANSI colors"],
    ["-y, --yes", "Auto-confirm gather preflight"],
    ["--finish", "Run acceptance closeout after drive/run"],
    ["--max-rounds <n>", "Cap resume rounds"],
    ["-h, --help", "Show help"],
  ];
  for (const [flag, description] of options) {
    lines.push(`  ${dim(flag.padEnd(20))}  ${description}`);
  }
  lines.push("");
  lines.push(muted("Shell completion: eval \"$(accord completion bash)\""));
  lines.push("");
  return lines.join("\n");
}
