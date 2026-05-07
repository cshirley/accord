import * as fs from "node:fs";
import * as path from "node:path";
import { GLOBAL_CONFIG_PATH } from "./paths.js";
import type { ContextSourceConfig, DevHarnessGlobalConfig } from "./types.js";

/**
 * Load the global accord-config.json from ~/.config/pi/agent/.
 * Returns null if not found or invalid.
 *
 * The seeded file (see `seedGlobalConfigFile`) contains JSONC-style
 * comments to document optional fields. We strip `//` line comments
 * and `/* ... *\/` block comments before handing the content to
 * `JSON.parse` so users can comment things out naturally without the
 * loader failing.
 */
export function loadGlobalConfig(): DevHarnessGlobalConfig | null {
  if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, "utf8");
    return JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
}

/**
 * Strip JSONC `//` line comments and `/* ... *\/` block comments
 * without disturbing strings. Trailing commas are *not* handled — the
 * seeded template avoids them, and users editing the file can keep the
 * structure JSON-valid by following the same convention.
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  while (i < input.length) {
    const c = input[i];

    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === stringChar) {
        inString = false;
        stringChar = "";
      }
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      i += 1;
      continue;
    }

    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

/**
 * Default JSONC content seeded into a fresh `accord-config.json`. All
 * configuration is commented out so the runtime sees an empty object
 * (the safe default) until the user opts in. The block-comment header
 * documents the file's purpose; line comments inside the object give
 * paste-ready snippets for each supported field.
 */
export function defaultGlobalConfigTemplate(): string {
  return `// ACCORD global configuration. Applies across every project that
// uses /dev. Loaded from ~/.config/pi/agent/accord-config.json at
// extension start. Edit freely — // and /* ... */ comments are
// preserved on disk and stripped by the loader at runtime.
//
// Schema: schemas/accord-config-schema.json (in the pi-accord repo).
// All keys are optional; with everything commented out ACCORD uses
// its built-in defaults (auto-install on, no extra context sources,
// no user-defined providers).
{
  // ── Asset bootstrap ──────────────────────────────────────────────
  // Controls whether the extension auto-links bundled skills/agents/
  // providers into ~/.config/pi/agent on session_start. Disable this
  // if you maintain hand-edited copies under that tree. The
  // ACCORD_AUTO_INSTALL_ASSETS env var overrides this when set.
  //
  // "asset_bootstrap": {
  //   "auto_install": true
  // },

  // ── Context sources ──────────────────────────────────────────────
  // Global enrichment sources surfaced to phase-gather. Project-level
  // accord-config.json entries (under the ## Dev Harness JSON block)
  // are merged on top of these — matched by "type", project fields
  // override globals, and { "enabled": false } disables a source for
  // a single project. Bundled enrichments: slack, google-docs,
  // confluence, github-pr, github-discussions, figma.
  //
  // "context_sources": [
  //   { "type": "slack", "channels": ["#eng"], "default_lookback_days": 14 },
  //   { "type": "google-docs", "folder_id": "REPLACE_WITH_FOLDER_ID" },
  //   { "type": "confluence", "space": "ENG", "labels": ["spec"] }
  // ],

  // ── User-defined providers ───────────────────────────────────────
  // Add a tracker or enrichment that isn't bundled, or override a
  // bundled one by name. Each entry must point at a markdown fetch
  // playbook (absolute path, or ~/-prefixed). See
  // schemas/provider-schema.json for the full per-entry shape.
  //
  // "providers": [
  //   {
  //     "name": "internal-tracker",
  //     "kind": "tracker",
  //     "label": "Internal Tracker",
  //     "mcpTools": ["internal_search", "internal_get_issue"],
  //     "cliFallback": null,
  //     "envFallback": "INTERNAL_TRACKER_TOKEN",
  //     "promptFile": "~/.config/pi/agent/playbooks/internal-tracker.md"
  //   }
  // ]
}
`;
}

export interface SeedGlobalConfigOptions {
  /** Pi config directory (defaults to the dir containing GLOBAL_CONFIG_PATH). */
  target?: string;
  /** Override the file content (mainly for tests). */
  content?: string;
}

export type SeedGlobalConfigStatus = "created" | "exists" | "error";

export interface SeedGlobalConfigResult {
  status: SeedGlobalConfigStatus;
  path: string;
  error?: string;
}

/**
 * Write a stub accord-config.json with commented-out examples if one
 * does not already exist at the target. Idempotent: never overwrites
 * a user-edited file. Failures are reported via the result, not
 * thrown — callers (the asset installer, the bootstrap) treat a seed
 * failure as non-fatal.
 */
export function seedGlobalConfigFile(opts: SeedGlobalConfigOptions = {}): SeedGlobalConfigResult {
  const filePath = opts.target
    ? path.join(opts.target, "accord-config.json")
    : GLOBAL_CONFIG_PATH;

  if (fs.existsSync(filePath)) {
    return { status: "exists", path: filePath };
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, opts.content ?? defaultGlobalConfigTemplate());
    return { status: "created", path: filePath };
  } catch (e) {
    return {
      status: "error",
      path: filePath,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Merge global and project-level context_sources.
 *
 * Merge rules:
 * - Match by `type`
 * - Project fields override global fields (shallow merge per source)
 * - Project can add sources not in global
 * - Project can disable a global source: { type: "slack", enabled: false }
 * - No project context_sources -> use globals as-is
 */
export function mergeContextSources(
  global: ContextSourceConfig[] | undefined,
  project: ContextSourceConfig[] | undefined,
): ContextSourceConfig[] {
  if (!global?.length && !project?.length) return [];
  if (!project?.length) return (global ?? []).filter(s => s.enabled !== false);
  if (!global?.length) return project.filter(s => s.enabled !== false);

  const merged = new Map<string, ContextSourceConfig>();

  for (const src of global) {
    merged.set(src.type, { ...src });
  }

  for (const src of project) {
    const existing = merged.get(src.type);
    if (existing) {
      merged.set(src.type, { ...existing, ...src });
    } else {
      merged.set(src.type, { ...src });
    }
  }

  return [...merged.values()].filter(s => s.enabled !== false);
}
