/**
 * Pi asset installer — pure file-system logic for symlinking the
 * bundled `assets/{skills,agents/accord,providers}/` into a Pi config
 * directory. Idempotent: correct symlinks are left untouched, locally
 * modified destinations are preserved unless `force: true`.
 *
 * This module is host-neutral and has no dependency on Pi APIs. The
 * CLI wrapper lives in `scripts/install-pi-assets.ts`; the runtime
 * auto-install bootstrap lives in `core/harness/asset-bootstrap.ts`.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { EXT_DIR } from "./config/paths.js";
import { seedGlobalConfigFile, type SeedGlobalConfigStatus } from "./config/global.js";

type Manifest = {
  package: string;
  assets: {
    skills: string[];
    agents: string[];
    providers?: {
      trackers?: string[];
      enrichments?: string[];
    };
  };
};

type LinkKind = "file" | "dir";

export interface InstallOptions {
  /** Pi config directory. Defaults to ~/.config/pi/agent. */
  target?: string;
  /** When true, replace locally modified destinations. */
  force?: boolean;
  /** When true, compute the plan without writing anything. */
  dryRun?: boolean;
  /** Override the package root (defaults to EXT_DIR). */
  packageRoot?: string;
}

export interface InstallResult {
  target: string;
  /** Destination paths that were (or would be) linked. */
  linked: string[];
  /** Destination paths blocked by local modifications (no-op without force). */
  conflicts: string[];
  metadataPath: string;
  metadata: AccordAssetsMetadata;
  /**
   * Outcome of the global accord-config.json seed step. "created"
   * means a stub with commented examples was just written;
   * "exists" means we left a user file alone; "error" means the seed
   * failed (non-fatal — the install itself still succeeded). Always
   * "exists" in dryRun and when the install was blocked by conflicts.
   */
  globalConfigSeed: SeedGlobalConfigStatus;
  /** Path the seed step considered (whether or not it wrote). */
  globalConfigPath: string;
}

export interface AccordAssetsMetadata {
  package: string;
  version: string;
  installed_at: string;
  install_mode: "symlink";
  asset_root: string;
  manifest_sha256: string;
  assets: Manifest["assets"];
}

export const DEFAULT_PI_AGENT_DIR = join(homedir(), ".config", "pi", "agent");

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function listFiles(path: string): string[] {
  const info = statSync(path);
  if (info.isFile()) return [path];

  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    const entryInfo = statSync(full);
    if (entryInfo.isDirectory()) files.push(...listFiles(full));
    else if (entryInfo.isFile()) files.push(full);
  }
  return files.sort();
}

function fileHashes(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of listFiles(dir)) {
    hashes[relative(dir, file)] = sha256(readFileSync(file));
  }
  return hashes;
}

function isCorrectSymlink(src: string, dst: string): boolean {
  if (!pathExists(dst)) return false;
  const info = lstatSync(dst);
  if (!info.isSymbolicLink()) return false;
  return resolve(dirname(dst), readlinkSync(dst)) === resolve(src);
}

function sameContents(src: string, dst: string, kind: LinkKind): boolean {
  if (!pathExists(dst)) return false;

  const dstInfo = lstatSync(dst);
  if (dstInfo.isSymbolicLink()) return isCorrectSymlink(src, dst);

  if (kind === "file") {
    return dstInfo.isFile() && sha256(readFileSync(src)) === sha256(readFileSync(dst));
  }

  if (!dstInfo.isDirectory()) return false;
  return JSON.stringify(fileHashes(src)) === JSON.stringify(fileHashes(dst));
}

function linkTarget(src: string, dst: string): string {
  return relative(dirname(dst), src) || ".";
}

function linkAsset(
  src: string,
  dst: string,
  kind: LinkKind,
  opts: { force: boolean; dryRun: boolean },
  conflicts: string[],
  linked: string[],
): void {
  if (isCorrectSymlink(src, dst)) return;

  if (pathExists(dst)) {
    const same = sameContents(src, dst, kind);
    if (!same && !opts.force) {
      conflicts.push(dst);
      return;
    }
  }

  linked.push(dst);
  if (opts.dryRun) return;

  // Only rm when something is actually there; this keeps the brief window
  // in which dst doesn't exist as short as possible (a concurrent Pi
  // startup scan could otherwise momentarily see no skill).
  if (pathExists(dst)) {
    rmSync(dst, { recursive: true, force: true });
  }
  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(linkTarget(src, dst), dst, kind);
}

export function installPiAssets(opts: InstallOptions = {}): InstallResult {
  const root = opts.packageRoot ?? EXT_DIR;
  const target = opts.target ?? DEFAULT_PI_AGENT_DIR;
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  const manifestPath = join(root, "assets", "manifest.json");
  const packagePath = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };

  const conflicts: string[] = [];
  const linked: string[] = [];

  for (const skill of manifest.assets.skills) {
    linkAsset(
      join(root, "assets", "skills", skill),
      join(target, "skills", skill),
      "dir",
      { force, dryRun },
      conflicts,
      linked,
    );
  }

  // Link the entire accord agent bundle as one directory symlink, so adding
  // or renaming an agent in this package does not require re-running the
  // installer. Subagent's recursive discovery walks subdirectories and tags
  // each agent with namespace = parent dir name, so files end up with
  // namespace="accord" automatically.
  linkAsset(
    join(root, "assets", "agents", "accord"),
    join(target, "agents", "accord"),
    "dir",
    { force, dryRun },
    conflicts,
    linked,
  );

  linkAsset(
    join(root, "assets", "providers"),
    join(target, "providers"),
    "dir",
    { force, dryRun },
    conflicts,
    linked,
  );

  const metadata: AccordAssetsMetadata = {
    package: manifest.package,
    version: pkg.version ?? "unknown",
    installed_at: new Date().toISOString(),
    install_mode: "symlink",
    asset_root: join(root, "assets"),
    manifest_sha256: sha256(readFileSync(manifestPath)),
    assets: manifest.assets,
  };

  const metadataPath = join(target, ".accord-assets.json");
  const globalConfigPath = join(target, "accord-config.json");
  let globalConfigSeed: SeedGlobalConfigStatus = "exists";
  if (!dryRun && conflicts.length === 0) {
    mkdirSync(target, { recursive: true });
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    // Seed a stub global config alongside the install metadata so
    // first-time users see the documented options. Idempotent — never
    // overwrites a hand-edited file. Seed failures are non-fatal.
    globalConfigSeed = seedGlobalConfigFile({ target }).status;
  }

  return {
    target,
    linked,
    conflicts,
    metadataPath,
    metadata,
    globalConfigSeed,
    globalConfigPath,
  };
}

/**
 * Read the metadata recorded by a previous install, if present. Used
 * by the auto-install bootstrap to decide whether assets are out of date.
 */
export function readInstalledMetadata(target: string = DEFAULT_PI_AGENT_DIR): AccordAssetsMetadata | null {
  const path = join(target, ".accord-assets.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AccordAssetsMetadata;
  } catch {
    return null;
  }
}

/**
 * Compute the manifest sha256 + version for the package without writing
 * anything. Lets the bootstrap compare current state against
 * `readInstalledMetadata()` cheaply.
 */
export function currentAssetSignature(packageRoot: string = EXT_DIR): { version: string; manifest_sha256: string } {
  const manifestPath = join(packageRoot, "assets", "manifest.json");
  const packagePath = join(packageRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return {
    version: pkg.version ?? "unknown",
    manifest_sha256: sha256(readFileSync(manifestPath)),
  };
}
