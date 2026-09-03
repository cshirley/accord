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

/**
 * Pi agent config directory. Mirrors `DEFAULT_PI_AGENT_DIR` from
 * `core/asset-install.ts` so global config lookups are resolved by the
 * user's home directory rather than by the on-disk install layout of
 * this extension. Override via `ACCORD_PI_AGENT_DIR` for tests.
 */
export const PI_AGENT_DIR =
  process.env.ACCORD_PI_AGENT_DIR ?? path.join(homedir(), ".config", "pi", "agent");

export const GLOBAL_CONFIG_PATH = path.join(PI_AGENT_DIR, "accord.json");
