import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

/** `@clive.shirley/accord-core` package root (`schemas/`, etc.). */
export const CORE_DIR = path.resolve(CONFIG_DIR, "../..");

/**
 * Pi harness package root (`assets/`: agents, lang-profiles, providers).
 * Defaults to sibling `pi-accord` in the monorepo. Override with `ACCORD_HARNESS_PKG_DIR`.
 */
export const HARNESS_PKG_DIR = path.resolve(
  process.env.ACCORD_HARNESS_PKG_DIR?.trim() || path.join(CORE_DIR, "../pi-accord"),
);

/** @deprecated Prefer {@link HARNESS_PKG_DIR} (assets) or {@link CORE_DIR} (schemas). */
export const EXT_DIR = HARNESS_PKG_DIR;

export const LANG_PROFILES_DIR = path.join(HARNESS_PKG_DIR, "assets", "lang-profiles");

/**
 * Pi agent config directory. Mirrors `DEFAULT_PI_AGENT_DIR` from
 * `core/asset-install.ts` so global config lookups are resolved by the
 * user's home directory rather than by the on-disk install layout of
 * this extension. Override via `ACCORD_PI_AGENT_DIR` for tests.
 */
export const PI_AGENT_DIR =
  process.env.ACCORD_PI_AGENT_DIR ?? path.join(homedir(), ".config", "pi", "agent");

export const GLOBAL_CONFIG_PATH = path.join(PI_AGENT_DIR, "accord.json");
