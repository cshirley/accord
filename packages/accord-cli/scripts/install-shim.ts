#!/usr/bin/env bun
/**
 * Install `~/.local/bin/accord` shim pointing at this checkout.
 *
 * Usage:
 *   bun packages/accord-cli/scripts/install-shim.ts [--force] [--dry-run]
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installAccordShim } from "../src/install-shim.js";

type Args = {
  force: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false, dryRun: false };
  for (const token of argv) {
    if (token === "--force") args.force = true;
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: bun packages/accord-cli/scripts/install-shim.ts [--force] [--dry-run]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

try {
  const result = await installAccordShim({
    repoRoot,
    force: args.force,
    dryRun: args.dryRun,
  });
  console.log(result.message);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
