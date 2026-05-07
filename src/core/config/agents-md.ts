import * as fs from "node:fs";
import * as path from "node:path";
import { loadGlobalConfig, mergeContextSources } from "./global.js";
import { findGitRoot } from "./git.js";
import type { DevHarnessConfig } from "./types.js";

/**
 * Check whether an AGENTS.md file contains a `dev_harness_ref` directive
 * pointing to a root config instead of an inline Dev Harness JSON block.
 *
 * Format in AGENTS.md:
 * ```
 * ## Dev Harness
 * <!-- dev_harness_ref: ../../AGENTS.md -->
 * ```
 */
function extractDevHarnessRef(content: string): string | null {
  const headingRe = /^## Dev Harness\s*$/m;
  const match = headingRe.exec(content);
  if (!match) return null;

  const afterHeading = content.slice(match.index + match[0].length);
  const refRe = /<!--\s*dev_harness_ref:\s*(.+?)\s*-->/;
  const refMatch = refRe.exec(afterHeading);
  if (!refMatch) return null;

  // Only match if it's within the Dev Harness section (before next heading).
  const nextHeadingRe = /^#{1,2} /m;
  const nextHeading = nextHeadingRe.exec(afterHeading);
  if (nextHeading && refMatch.index > nextHeading.index) return null;

  return refMatch[1].trim();
}

function findAgentsMd(cwd: string): string | null {
  const gitRoot = findGitRoot(cwd);
  let dir = path.resolve(cwd);
  const stopAt = gitRoot ? path.resolve(gitRoot) : null;

  while (true) {
    const candidate = path.join(dir, "AGENTS.md");
    if (fs.existsSync(candidate)) return candidate;
    if (stopAt && dir === stopAt) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function extractDevHarnessJson(content: string): string | null {
  const headingRe = /^## Dev Harness\s*$/m;
  const match = headingRe.exec(content);
  if (!match) return null;

  const afterHeading = content.slice(match.index + match[0].length);
  const nextHeadingRe = /^#{1,2} /m;
  const nextMatch = nextHeadingRe.exec(afterHeading);
  const section = nextMatch ? afterHeading.slice(0, nextMatch.index) : afterHeading;

  const fenceRe = /```json\s*\n([\s\S]*?)\n```/;
  const fenceMatch = fenceRe.exec(section);
  return fenceMatch ? fenceMatch[1] : null;
}

/**
 * Load the ACCORD configuration from the project's AGENTS.md.
 *
 * Resolution order:
 *   1. AGENTS.md in cwd -> walk up to git root.
 *   2. If found AGENTS.md contains a `dev_harness_ref` directive, follow the
 *      relative path to load the config from the referenced file instead.
 *   3. Otherwise, parse the inline Dev Harness JSON block.
 *
 * Returns parsed+validated config, or null if not found/invalid.
 */
export function loadDevHarnessConfig(cwd?: string): DevHarnessConfig | null {
  const dir = cwd ?? process.cwd();
  const agentsMdPath = findAgentsMd(dir);
  if (!agentsMdPath) return null;

  let content: string;
  try { content = fs.readFileSync(agentsMdPath, "utf8"); } catch { return null; }

  const ref = extractDevHarnessRef(content);
  if (ref) {
    const refPath = path.resolve(path.dirname(agentsMdPath), ref);
    if (!fs.existsSync(refPath)) return null;
    try {
      const refContent = fs.readFileSync(refPath, "utf8");
      return parseAndValidateConfig(refContent);
    } catch { return null; }
  }

  return parseAndValidateConfig(content);
}

function parseAndValidateConfig(content: string): DevHarnessConfig | null {
  const jsonStr = extractDevHarnessJson(content);
  if (!jsonStr) return null;

  let parsed: any;
  try { parsed = JSON.parse(jsonStr); } catch { return null; }

  if (
    parsed?.schema_version !== "1.0" ||
    typeof parsed?.language !== "string" ||
    typeof parsed?.test?.command !== "string" ||
    !Array.isArray(parsed?.verification_commands) ||
    parsed.verification_commands.length === 0
  ) {
    return null;
  }

  const globalCfg = loadGlobalConfig();
  const mergedSources = mergeContextSources(
    globalCfg?.context_sources,
    parsed.context_sources,
  );
  if (mergedSources.length > 0) {
    parsed.context_sources = mergedSources;
  } else {
    delete parsed.context_sources;
  }

  return parsed as DevHarnessConfig;
}
