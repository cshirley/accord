/**
 * CLI wrapper for installing the bundled Pi assets. The real logic
 * lives in src/core/asset-install.ts so the runtime auto-install
 * bootstrap can call it directly.
 */

import { DEFAULT_PI_AGENT_DIR, installPiAssets } from "../src/core/asset-install.js";

type Args = {
  target: string;
  force: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { target: DEFAULT_PI_AGENT_DIR, force: false, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") {
      const value = argv[i + 1];
      if (!value) throw new Error("--target requires a path");
      args.target = value;
      i += 1;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: bun packages/pi-accord/scripts/install-assets.ts [--target PATH] [--force] [--dry-run]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = installPiAssets(args);

if (result.conflicts.length > 0) {
  console.error(
    "Refusing to replace locally modified Pi assets with links. Re-run with --force to replace:",
  );
  for (const file of result.conflicts) console.error(`  ${file}`);
  process.exit(1);
}

const action = args.dryRun ? "would link" : "linked";
console.log(`ACCORD Pi assets ${action}: ${result.linked.length} item(s)`);
if (args.dryRun) console.log(`metadata: ${result.metadataPath}`);
