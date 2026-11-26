/**
 * Install a `accord` executable shim into `~/.local/bin` for dev checkouts.
 */

import { execSync } from "node:child_process";
import { constants, readdirSync, readFileSync } from "node:fs";
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

/** First line marker: shims carrying it are ours to overwrite without --force. */
export const SHIM_MARKER = "# ACCORD CLI shim";

export type BinEntry = { name: string; entry: string };

/**
 * Every `bin` declared by a workspace package (each `packages/<dir>/package.json`), so the shim
 * list can never drift from package.json. `accord` is first.
 */
export function discoverBins(repoRoot: string): BinEntry[] {
  const packagesDir = join(resolve(repoRoot), "packages");
  const bins: BinEntry[] = [];
  for (const dir of readdirSync(packagesDir).sort()) {
    let pkg: { bin?: Record<string, string> | string; name?: string };
    try {
      pkg = JSON.parse(readFileSync(join(packagesDir, dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const map = typeof pkg.bin === "string" ? { [pkg.name ?? dir]: pkg.bin } : (pkg.bin ?? {});
    for (const [name, file] of Object.entries(map)) {
      bins.push({ name, entry: join("packages", dir, file.replace(/^\.\//, "")) });
    }
  }
  return bins.sort((x, y) => Number(y.name === "accord") - Number(x.name === "accord"));
}

/** Install a shim for every discovered bin. */
export async function installAllShims(
  options: Omit<InstallAccordShimOptions, "name" | "entry">,
): Promise<InstallAccordShimResult[]> {
  const results: InstallAccordShimResult[] = [];
  for (const bin of discoverBins(options.repoRoot)) {
    results.push(await installAccordShim({ ...options, name: bin.name, entry: bin.entry }));
  }
  return results;
}

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
${SHIM_MARKER} — installed by @clive.shirley/accord (install-dev / install:shim)
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
      if (!options.force && !existing.includes(SHIM_MARKER)) {
        throw new Error(
          `Refusing to overwrite ${shimPath}: not an ACCORD shim. Pass --force to replace.`,
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
