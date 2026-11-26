/**
 * Install a `accord` executable shim into `~/.local/bin` for dev checkouts.
 */

import { execSync } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_LOCAL_BIN_DIR = join(homedir(), ".local", "bin");

export type InstallAccordShimOptions = {
  /** Monorepo root containing `packages/accord-cli`. */
  repoRoot: string;
  /** Target bin directory (default `~/.local/bin`). */
  binDir?: string;
  /** Overwrite an existing shim when content differs. */
  force?: boolean;
  /** Print actions without writing. */
  dryRun?: boolean;
  /** Resolved `bun` binary (default: `command -v bun` or `bun`). */
  bunPath?: string;
  /** Shim name (default `accord`). */
  name?: string;
  /** Entry file relative to repoRoot (default `packages/accord-cli/src/main.ts`). */
  entry?: string;
};

/** Harness-neutral companion CLIs installed alongside `accord`. */
export const COMPANION_BINS: ReadonlyArray<{ name: string; entry: string }> = [
  { name: "accord-guardrail", entry: "packages/accord-cli/src/guardrail-main.ts" },
  { name: "accord-notify", entry: "packages/accord-cli/src/notify-main.ts" },
  { name: "accord-morning", entry: "packages/accord-cli/src/morning-main.ts" },
  { name: "accord-sync", entry: "packages/accord-cli/src/sync-main.ts" },
  { name: "accord-tools", entry: "packages/accord-tools/src/main.ts" },
  { name: "gdoc-md", entry: "packages/accord-cli/src/gdoc-main.ts" },
];

export type InstallAccordShimResult = {
  path: string;
  written: boolean;
  skipped: boolean;
  message: string;
};

export function resolveAccordCliMain(repoRoot: string): string {
  return resolve(repoRoot, "packages/accord-cli/src/main.ts");
}

export function resolveAccordShimPath(
  binDir: string = DEFAULT_LOCAL_BIN_DIR,
  name = "accord",
): string {
  return join(binDir, name);
}

export function buildAccordShimContent(options: {
  repoRoot: string;
  bunPath?: string;
  entry?: string;
}): string {
  const repoRoot = resolve(options.repoRoot);
  const mainTs = options.entry ? resolve(repoRoot, options.entry) : resolveAccordCliMain(repoRoot);
  const bun = options.bunPath?.trim() || "bun";
  return `#!/usr/bin/env bash
# ACCORD CLI shim — installed by @clive.shirley/accord (install-dev / install:shim)
# Repo: ${repoRoot}
set -euo pipefail
exec ${shellQuote(bun)} ${shellQuote(mainTs)} "$@"
`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function resolveBunPath(): string {
  try {
    return execSync("command -v bun", { encoding: "utf8", shell: "/bin/bash" }).trim();
  } catch {
    return "bun";
  }
}

export function localBinOnPath(binDir: string = DEFAULT_LOCAL_BIN_DIR): boolean {
  const pathEntries = (process.env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .map((entry) => resolve(entry));
  return pathEntries.includes(resolve(binDir));
}

export async function installAccordShim(
  options: InstallAccordShimOptions,
): Promise<InstallAccordShimResult> {
  const repoRoot = resolve(options.repoRoot);
  const mainTs = options.entry ? resolve(repoRoot, options.entry) : resolveAccordCliMain(repoRoot);
  await access(mainTs, constants.R_OK);

  const binDir = resolve(options.binDir ?? DEFAULT_LOCAL_BIN_DIR);
  const shimPath = resolveAccordShimPath(binDir, options.name);
  const label = options.name ?? "accord";
  const bunPath = options.bunPath ?? resolveBunPath();
  const content = buildAccordShimContent({ repoRoot, bunPath, entry: options.entry });

  if (!options.dryRun) {
    await mkdir(binDir, { recursive: true });

    let existing: string | undefined;
    try {
      existing = await readFile(shimPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    if (existing !== undefined) {
      if (existing === content) {
        return {
          path: shimPath,
          written: false,
          skipped: true,
          message: `Shim already up to date at ${shimPath}`,
        };
      }
      if (!options.force) {
        throw new Error(
          `Refusing to overwrite existing shim at ${shimPath}. Pass --force to replace.`,
        );
      }
    }

    await writeFile(shimPath, content, { encoding: "utf8", mode: 0o755 });
    await chmod(shimPath, 0o755);
  }

  const pathHint = localBinOnPath(binDir)
    ? ""
    : ` Add ${binDir} to PATH (e.g. export PATH="${binDir}:$PATH").`;

  return {
    path: shimPath,
    written: !options.dryRun,
    skipped: false,
    message: options.dryRun
      ? `Would install ${label} shim at ${shimPath}`
      : `Installed ${label} shim at ${shimPath}.${pathHint}`,
  };
}
