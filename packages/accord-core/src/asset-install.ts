/**
 * Pi asset installer — pure file-system logic for symlinking the
 * bundled host-neutral assets (`accord-assets`) and Pi-only skills
 * (`pi-accord/assets/skills`) into a Pi config directory. Idempotent:
 * correct symlinks are left untouched, locally modified destinations are
 * preserved unless `force: true`.
 *
 * This module is host-neutral and has no dependency on Pi APIs. The
 * CLI wrapper lives in `packages/pi-accord/scripts/install-assets.ts`;
 * the runtime auto-install bootstrap lives in `harness/asset-bootstrap.ts`.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { type SeedGlobalConfigStatus, seedGlobalConfigFile } from "./config/global.js";
import {
  ASSETS_DIR,
  ASSETS_MANIFEST_PATH,
  PI_MANIFEST_PATH,
  PI_PKG_DIR,
  PI_SKILLS_DIR,
} from "./config/paths.js";

type AssetsManifest = {
  package: string;
  assets: {
    agents: string[];
    providers?: {
      trackers?: string[];
      enrichments?: string[];
    };
  };
};

type PiManifest = {
  package: string;
  assets: {
    skills: string[];
  };
};

type LinkKind = "file" | "dir";

export interface InstallRoots {
  assetsRoot: string;
  skillsRoot: string;
}

export interface InstallOptions extends Partial<InstallRoots> {
  /** Pi config directory. Defaults to ~/.config/pi/agent. */
  target?: string;
  /** When true, replace locally modified destinations. */
  force?: boolean;
  /** When true, compute the plan without writing anything. */
  dryRun?: boolean;
  /**
   * @deprecated Use {@link InstallRoots.assetsRoot}. When set alone, skills
   * default to sibling `pi-accord` under the monorepo.
   */
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
   * Outcome of the global accord.json seed step. "created"
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
  skills_root: string;
  manifest_sha256: string;
  assets: {
    skills: string[];
    agents: string[];
    providers?: AssetsManifest["assets"]["providers"];
  };
}

export const DEFAULT_PI_AGENT_DIR = join(homedir(), ".config", "pi", "agent");

export function defaultInstallRoots(): InstallRoots {
  return {
    assetsRoot: ASSETS_DIR,
    skillsRoot: PI_PKG_DIR,
  };
}

function resolveInstallRoots(opts: InstallOptions): InstallRoots {
  const defaults = defaultInstallRoots();
  const assetsRoot = opts.assetsRoot ?? opts.packageRoot ?? defaults.assetsRoot;
  const skillsRoot = opts.skillsRoot ?? defaults.skillsRoot;
  return { assetsRoot, skillsRoot };
}

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
  try {
    return existsSync(dst) && realpathSync(dst) === realpathSync(src);
  } catch {
    return false;
  }
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

function linkTarget(src: string): string {
  return resolve(src);
}

function isStaleManagedSymlink(src: string, dst: string): boolean {
  if (!pathExists(dst)) return false;
  const info = lstatSync(dst);
  if (!info.isSymbolicLink()) return false;
  return !isCorrectSymlink(src, dst);
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
    if (isStaleManagedSymlink(src, dst)) {
      // Wrong target from a prior install — not a local edit.
    } else if (!sameContents(src, dst, kind) && !opts.force) {
      conflicts.push(dst);
      return;
    }
  }

  linked.push(dst);
  if (opts.dryRun) return;

  if (pathExists(dst)) {
    rmSync(dst, { recursive: true, force: true });
  }
  mkdirSync(dirname(dst), { recursive: true });
  symlinkSync(linkTarget(src), dst, kind);
}

function readAssetsManifest(assetsRoot: string): AssetsManifest {
  const manifestPath = join(assetsRoot, "manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as AssetsManifest;
}

function readPiManifest(skillsRoot: string): PiManifest {
  const manifestPath = join(skillsRoot, "assets", "manifest.pi.json");
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PiManifest;
}

function combinedManifestSha256(assetsRoot: string, skillsRoot: string): string {
  const assetsManifest = readFileSync(join(assetsRoot, "manifest.json"));
  const piManifest = readFileSync(join(skillsRoot, "assets", "manifest.pi.json"));
  return sha256(Buffer.concat([assetsManifest, piManifest]));
}

export function installPiAssets(opts: InstallOptions = {}): InstallResult {
  const { assetsRoot, skillsRoot } = resolveInstallRoots(opts);
  const target = opts.target ?? DEFAULT_PI_AGENT_DIR;
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  const assetsManifest = readAssetsManifest(assetsRoot);
  const piManifest = readPiManifest(skillsRoot);
  const assetsPackagePath = join(assetsRoot, "package.json");
  const pkg = JSON.parse(readFileSync(assetsPackagePath, "utf8")) as { version?: string };

  const conflicts: string[] = [];
  const linked: string[] = [];

  for (const skill of piManifest.assets.skills) {
    linkAsset(
      join(skillsRoot, "assets", "skills", skill),
      join(target, "skills", skill),
      "dir",
      { force, dryRun },
      conflicts,
      linked,
    );
  }

  linkAsset(
    join(assetsRoot, "agents", "accord"),
    join(target, "agents", "accord"),
    "dir",
    { force, dryRun },
    conflicts,
    linked,
  );

  linkAsset(
    join(assetsRoot, "agents", "default.md"),
    join(target, "agents", "default.md"),
    "file",
    { force, dryRun },
    conflicts,
    linked,
  );

  linkAsset(
    join(assetsRoot, "providers"),
    join(target, "providers"),
    "dir",
    { force, dryRun },
    conflicts,
    linked,
  );

  const metadata: AccordAssetsMetadata = {
    package: assetsManifest.package,
    version: pkg.version ?? "unknown",
    installed_at: new Date().toISOString(),
    install_mode: "symlink",
    asset_root: assetsRoot,
    skills_root: join(skillsRoot, "assets", "skills"),
    manifest_sha256: combinedManifestSha256(assetsRoot, skillsRoot),
    assets: {
      skills: piManifest.assets.skills,
      agents: assetsManifest.assets.agents,
      providers: assetsManifest.assets.providers,
    },
  };

  const metadataPath = join(target, ".accord-assets.json");
  const globalConfigPath = join(target, "accord.json");
  let globalConfigSeed: SeedGlobalConfigStatus = "exists";
  if (!dryRun && conflicts.length === 0) {
    mkdirSync(target, { recursive: true });
    writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
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

export function readInstalledMetadata(
  target: string = DEFAULT_PI_AGENT_DIR,
): AccordAssetsMetadata | null {
  const path = join(target, ".accord-assets.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AccordAssetsMetadata;
  } catch {
    return null;
  }
}

export function currentAssetSignature(roots: InstallOptions | InstallRoots = {}): {
  version: string;
  manifest_sha256: string;
} {
  const { assetsRoot, skillsRoot } = resolveInstallRoots(roots);
  const packagePath = join(assetsRoot, "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: string };
  return {
    version: pkg.version ?? "unknown",
    manifest_sha256: combinedManifestSha256(assetsRoot, skillsRoot),
  };
}

/** @internal test helper — skills bundle path */
export { ASSETS_MANIFEST_PATH, PI_MANIFEST_PATH, PI_SKILLS_DIR };
