/**
 * Interactive accord shell — readline REPL with tab completion.
 */

import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { devTasks } from "@clive.shirley/accord-core/queries/dashboard.js";
import { parseCli } from "../cli.js";
import { executeParsed } from "../dispatch.js";
import { accent, dim, heading, muted } from "./colors.js";
import { createAccordCompleter } from "./completer.js";

export type InteractiveShellOptions = {
  cwd?: string;
};

function listWorkItemIds(): string[] {
  try {
    return devTasks().rows.map((row) => row.id);
  } catch {
    return [];
  }
}

function renderBanner(): void {
  console.log("");
  console.log(heading("ACCORD") + dim(" interactive shell"));
  console.log(muted("  Tab to complete · help for commands · exit to quit"));
  console.log("");
}

export async function runInteractiveShell(options: InteractiveShellOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  renderBanner();

  const rl = createInterface({
    input,
    output,
    terminal: true,
    completer: createAccordCompleter({ workItemIds: listWorkItemIds }),
  });

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question(`${accent("accord")}${dim(" › ")}`);
      } catch {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "exit" || trimmed === "quit") break;

      const argv = trimmed.split(/\s+/);
      const parsed = parseCli([...argv, "--cwd", cwd]);

      if (parsed.kind === "help") {
        const { printHelp } = await import("../cli.js");
        printHelp();
        continue;
      }

      if (parsed.kind === "interactive") {
        console.log(muted("Already in interactive mode."));
        continue;
      }

      console.log(muted(`Running: accord ${argv.join(" ")}\u2026`));
      const started = Date.now();
      const code = await executeParsed(parsed);
      const elapsedMs = Date.now() - started;
      const elapsed = elapsedMs >= 1000 ? ` in ${(elapsedMs / 1000).toFixed(1)}s` : "";
      if (code !== 0 && parsed.kind !== "error") {
        console.log(dim(`(exit ${String(code)}${elapsed})`));
      } else if (elapsedMs >= 1000) {
        console.log(dim(`(done${elapsed})`));
      }
    }
  } finally {
    rl.close();
  }

  console.log("");
  console.log(muted("Goodbye."));
  return 0;
}
