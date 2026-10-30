import { realpathSync } from "node:fs";
import { dirname } from "node:path";

const INHERITED_GIT_VARS =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|PREFIX|CEILING_DIRECTORIES|NAMESPACE)$/;

/**
 * Environment for spawning `git` and the skill scripts in a temp repository.
 *
 * Git exports GIT_DIR, GIT_INDEX_FILE and similar variables to hooks, so a test run started from
 * a pre-commit or pre-push hook would otherwise act on the real repository. They are removed
 * here, and the global and system config are disabled so results do not depend on the host.
 */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !INHERITED_GIT_VARS.test(key)) env[key] = value;
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  return { ...env, ...extra };
}

/**
 * GIT_CEILING_DIRECTORIES value that stops repository discovery for `dir`.
 *
 * Git never treats a ceiling entry as an ancestor of itself, so the ceiling must be the PARENT of
 * the directory the test works in: discovery then stops before climbing into it.
 */
export function ceilingFor(dir: string): string {
  return realpathSync(dirname(realpathSync(dir)));
}
