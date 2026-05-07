import { homedir } from "node:os";
import * as path from "node:path";

export const EXT_DIR = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
export const LANG_PROFILES_DIR = path.join(EXT_DIR, "assets", "lang-profiles");

/**
 * Pi agent config directory. Mirrors `DEFAULT_PI_AGENT_DIR` from
 * `core/asset-install.ts` so global config lookups are resolved by the
 * user's home directory rather than by the on-disk install layout of
 * this extension. Override via `ACCORD_PI_AGENT_DIR` for tests.
 */
export const PI_AGENT_DIR =
  process.env.ACCORD_PI_AGENT_DIR ?? path.join(homedir(), ".config", "pi", "agent");

export const GLOBAL_CONFIG_PATH = path.join(PI_AGENT_DIR, "accord-config.json");
