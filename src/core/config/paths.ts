import * as path from "node:path";

export const EXT_DIR = path.resolve(new URL(".", import.meta.url).pathname, "../../..");
export const LANG_PROFILES_DIR = path.join(EXT_DIR, "assets", "lang-profiles");
export const GLOBAL_CONFIG_PATH = path.resolve(EXT_DIR, "../../accord-config.json");
