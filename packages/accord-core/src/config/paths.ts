import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

/** `@clive.shirley/accord-core` package root (`schemas/`, etc.). */
export const CORE_DIR = path.resolve(CONFIG_DIR, "../..");

/**
 * Host-neutral ACCORD assets (`agents/`, `providers/`, `lang-profiles/`).
 * Defaults to sibling `accord-assets` in the monorepo.
 * Override with `ACCORD_ASSETS_DIR` (or deprecated `ACCORD_HARNESS_PKG_DIR`).
 */
export const ASSETS_DIR = path.resolve(
  process.env.ACCORD_ASSETS_DIR?.trim() ||
    process.env.ACCORD_HARNESS_PKG_DIR?.trim() ||
    path.join(CORE_DIR, "../accord-assets"),
);

/** Pi harness package root (`assets/skills/`, `assets/ci/`). */
export const PI_PKG_DIR = path.resolve(
  process.env.ACCORD_PI_PKG_DIR?.trim() || path.join(CORE_DIR, "../pi-accord"),
);

/** @deprecated Prefer {@link ASSETS_DIR}. */
export const HARNESS_PKG_DIR = ASSETS_DIR;

/** @deprecated Prefer {@link ASSETS_DIR} or {@link PI_PKG_DIR}. */
export const EXT_DIR = ASSETS_DIR;

export const LANG_PROFILES_DIR = path.join(ASSETS_DIR, "lang-profiles");
export const AGENTS_DIR = path.join(ASSETS_DIR, "agents");
export const AGENTS_ACCORD_DIR = path.join(ASSETS_DIR, "agents", "accord");
export const PROVIDERS_DIR = path.join(ASSETS_DIR, "providers");
export const PROVIDERS_TRACKERS_DIR = path.join(PROVIDERS_DIR, "trackers");
export const PROVIDERS_ENRICHMENTS_DIR = path.join(PROVIDERS_DIR, "enrichments");

export const PI_SKILLS_DIR = path.join(PI_PKG_DIR, "assets", "skills");
export const PI_MANIFEST_PATH = path.join(PI_PKG_DIR, "assets", "manifest.pi.json");
export const ASSETS_MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");

/** Host-neutral global config directory (`ACCORD_CONFIG_DIR` override). */
export function resolveAccordConfigDir(): string {
  return process.env.ACCORD_CONFIG_DIR?.trim() ?? path.join(homedir(), ".config", "accord");
}

/** Pi agent config directory (`ACCORD_PI_AGENT_DIR` override). */
export function resolvePiAgentDir(): string {
  return process.env.ACCORD_PI_AGENT_DIR ?? path.join(homedir(), ".config", "pi", "agent");
}

/** Host-neutral global `accord.json` path. */
export function resolveNeutralGlobalConfigPath(): string {
  return path.join(resolveAccordConfigDir(), "accord.json");
}

/** Deprecated global `accord.json` path under Pi config layout. */
export function resolveLegacyGlobalConfigPath(): string {
  return path.join(resolvePiAgentDir(), "accord.json");
}

/**
 * @deprecated Use {@link resolveAccordConfigDir} — evaluated once at import in older callers.
 */
export const ACCORD_CONFIG_DIR = resolveAccordConfigDir();

/** @deprecated Use {@link resolveNeutralGlobalConfigPath}. */
export const GLOBAL_CONFIG_PATH = resolveNeutralGlobalConfigPath();

/**
 * Pi agent config directory. Prefer {@link resolvePiAgentDir} when env may change after import.
 */
export const PI_AGENT_DIR = resolvePiAgentDir();

/** @deprecated Use {@link resolveLegacyGlobalConfigPath}. */
export const LEGACY_GLOBAL_CONFIG_PATH = resolveLegacyGlobalConfigPath();
