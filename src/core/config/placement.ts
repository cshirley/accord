import * as fs from "node:fs";
import * as path from "node:path";
import { extractDevHarnessJson } from "./agents-md.js";
import { findGitRoot } from "./git.js";

/**
 * Resolve where ACCORD config should live for /dev init.
 *
 * Simply checks whether cwd is a sub-directory of the git root.
 * No monorepo marker detection — works for any nested directory.
 *
 * Returns:
 *  - `type: "root_exists"` — root AGENTS.md already has ACCORD config.
 *     The init flow should ask whether to link or override locally.
 *  - `type: "root_no_config"` — root AGENTS.md exists but has no ACCORD compatibility section.
 *     Init should offer to write config to root.
 *  - `type: "root_no_agents"` — no root AGENTS.md at all.
 *     Init should offer to create one with the config.
 *  - `type: "at_root"` — cwd is already the git root. Standard init behaviour.
 */
export function resolveConfigLocation(
  cwd: string,
): {
  type: "root_exists" | "root_no_config" | "root_no_agents" | "at_root";
  gitRoot?: string;
  rootAgentsMd?: string;
} {
  const resolved = path.resolve(cwd);
  const gitRoot = findGitRoot(resolved);
  if (!gitRoot || path.resolve(gitRoot) === resolved) {
    return { type: "at_root" };
  }

  const rootAgentsMd = path.join(gitRoot, "AGENTS.md");
  if (!fs.existsSync(rootAgentsMd)) {
    return { type: "root_no_agents", gitRoot };
  }

  try {
    const content = fs.readFileSync(rootAgentsMd, "utf8");
    const jsonStr = extractDevHarnessJson(content);
    if (jsonStr) {
      return { type: "root_exists", gitRoot, rootAgentsMd };
    }
  } catch { /* ignore read errors */ }

  return { type: "root_no_config", gitRoot, rootAgentsMd };
}
