#!/usr/bin/env bun
/**
 * Standalone ACCORD orchestrator CLI entry.
 */

import { parseCli } from "./cli.js";
import { executeParsed } from "./dispatch.js";
import { setColorEnabled } from "./ui/colors.js";
import { runInteractiveShell } from "./ui/shell.js";

async function main(): Promise<number> {
  const parsed = parseCli(process.argv.slice(2));

  if (parsed.kind !== "error" && "options" in parsed && parsed.options.noColor) {
    setColorEnabled(false);
  }

  if (parsed.kind === "interactive") {
    return runInteractiveShell({ cwd: parsed.options.cwd });
  }

  return executeParsed(parsed);
}

const code = await main();
process.exit(code);
