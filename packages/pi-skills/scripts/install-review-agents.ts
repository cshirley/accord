/**
 * Symlink review-* agents for /review skill without full ACCORD install:assets.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REVIEW_AGENTS = ["review-code", "review-security", "review-test"] as const;

type Args = {
  target: string;
  force: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    target: join(homedir(), ".config", "pi", "agent"),
    force: false,
    dryRun: false,
  };
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
        "Usage: bun packages/pi-skills/scripts/install-review-agents.ts [--target PATH] [--force] [--dry-run]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function isCorrectSymlink(src: string, dst: string): boolean {
  if (!existsSync(dst)) return false;
  try {
    return realpathSync(dst) === realpathSync(src);
  } catch {
    return false;
  }
}

function linkFile(src: string, dst: string, opts: Args): "linked" | "skipped" | "conflict" {
  if (isCorrectSymlink(src, dst)) return "skipped";

  if (existsSync(dst)) {
    const info = lstatSync(dst);
    if (!info.isSymbolicLink() && !opts.force) return "conflict";
    if (!opts.dryRun) rmSync(dst, { force: true });
  }

  if (!opts.dryRun) {
    mkdirSync(dirname(dst), { recursive: true });
    symlinkSync(resolve(src), dst);
  }
  return "linked";
}

const args = parseArgs(process.argv.slice(2));
const skillsRoot = join(import.meta.dir, "..");
const assetsAgentsDir = join(skillsRoot, "..", "accord-assets", "agents", "accord");
const destDir = join(args.target, "agents", "accord");

const conflicts: string[] = [];
const linked: string[] = [];

for (const name of REVIEW_AGENTS) {
  const src = join(assetsAgentsDir, `${name}.md`);
  if (!existsSync(src)) {
    throw new Error(`Missing review agent in accord-assets: ${src}`);
  }
  const dst = join(destDir, `${name}.md`);
  const result = linkFile(resolve(src), dst, args);
  if (result === "linked") linked.push(dst);
  if (result === "conflict") conflicts.push(dst);
}

if (conflicts.length > 0) {
  console.error("Refusing to replace locally modified agents. Re-run with --force:");
  for (const path of conflicts) console.error(`  ${path}`);
  process.exit(1);
}

const action = args.dryRun ? "would link" : "linked";
console.log(`Review agents ${action}: ${linked.length} file(s) → ${destDir}`);
for (const path of linked) {
  try {
    console.log(`  ${path} -> ${readlinkSync(path)}`);
  } catch {
    console.log(`  ${path}`);
  }
}
