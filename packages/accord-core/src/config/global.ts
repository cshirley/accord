import * as fs from "node:fs";
import * as path from "node:path";
import { resolveLegacyGlobalConfigPath, resolveNeutralGlobalConfigPath } from "./paths.js";
import type {
  ContextSourceConfig,
  DevHarnessGlobalConfig,
  DevHarnessHarnessConfig,
  DevHarnessOrchestrationConfig,
} from "./types.js";

let legacyGlobalConfigWarned = false;

/**
 * Resolve global `accord.json` — prefers `~/.config/accord/accord.json`, falls back
 * to deprecated `~/.config/pi/agent/accord.json` with a one-time stderr warning.
 */
export function resolveGlobalConfigPath(): string | null {
  const neutral = resolveNeutralGlobalConfigPath();
  const legacy = resolveLegacyGlobalConfigPath();
  if (fs.existsSync(neutral)) return neutral;
  if (fs.existsSync(legacy)) {
    if (!legacyGlobalConfigWarned) {
      console.error(
        "[accord] Deprecated: reading ~/.config/pi/agent/accord.json — migrate to ~/.config/accord/accord.json",
      );
      legacyGlobalConfigWarned = true;
    }
    return legacy;
  }
  return null;
}

/**
 * Load the global accord.json from `~/.config/accord/` (legacy fallback above).
 * Returns null if not found or invalid.
 *
 * The seeded file (see `seedGlobalConfigFile`) contains JSONC-style
 * comments to document optional fields. We strip `//` line comments
 * and `/* ... *\/` block comments before handing the content to
 * `JSON.parse` so users can comment things out naturally without the
 * loader failing.
 */
export function loadGlobalConfig(): DevHarnessGlobalConfig | null {
  const configPath = resolveGlobalConfigPath();
  if (!configPath) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(stripJsonc(raw));
  } catch {
    return null;
  }
}

/**
 * Strip trailing commas before `}` or `]` outside of strings. Pairs with
 * `stripJsonComments` to form `stripJsonc`. Strings (including escapes)
 * are preserved verbatim.
 */
export function stripTrailingCommas(input: string): string {
  let out = "";
  let inString = false;
  let stringChar = "";
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      out += c;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === stringChar) {
        inString = false;
        stringChar = "";
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === "}" || input[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

/**
 * Strip JSONC comments AND trailing commas. The canonical helper for any
 * caller that needs to parse a hand-edited JSON-with-comments file.
 */
export function stripJsonc(input: string): string {
  return stripTrailingCommas(stripJsonComments(input));
}

/**
 * Strip JSONC `//` line comments and `/* ... *\/` block comments
 * without disturbing strings. Trailing commas are NOT handled here — use
 * `stripJsonc` for the combined operation.
 *
 * Also exported as the canonical JSONC stripper for any callers (e.g.
 * artifact validation) that need to be tolerant of inline comments.
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
 * Default JSONC content seeded into a fresh `accord.json`. Prefer
 * `accord config init --write` for the full harness + tier template.
 * This stub keeps all fields commented until the user opts in.
 */
export function defaultGlobalConfigTemplate(): string {
  return `// ACCORD global configuration. Applies across every project that
// uses ACCORD (/dev or accord CLI). Loaded from ~/.config/accord/accord.json
// at startup (legacy fallback: ~/.config/pi/agent/accord.json). Edit freely —
// // and /* ... */ comments are preserved on disk and stripped by the loader.
//
// Schema: schemas/accord-schema.json (in the accord monorepo).
// All keys are optional; with everything commented out ACCORD uses
// its built-in defaults (auto-install on Pi, no extra context sources,
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
  // accord.json entries (under the ## Dev Harness JSON block)
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
  /** Config directory (defaults to ACCORD_CONFIG_DIR / GLOBAL_CONFIG_PATH parent). */
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
 * Write a stub accord.json with commented-out examples if one
 * does not already exist at the target. Idempotent: never overwrites
 * a user-edited file. Failures are reported via the result, not
 * thrown — callers (the asset installer, the bootstrap) treat a seed
 * failure as non-fatal.
 */
export function seedGlobalConfigFile(opts: SeedGlobalConfigOptions = {}): SeedGlobalConfigResult {
  const filePath = opts.target
    ? path.join(opts.target, "accord.json")
    : resolveNeutralGlobalConfigPath();

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
  if (!project?.length) return (global ?? []).filter((s) => s.enabled !== false);
  if (!global?.length) return project.filter((s) => s.enabled !== false);

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

  return [...merged.values()].filter((s) => s.enabled !== false);
}

/**
 * Merge global `~/.config/accord/accord.json` orchestration defaults with a
 * project's Dev Harness `orchestration` block. Each subsection is shallow-merged;
 * project fields win when both define the same key.
 */
export function mergeOrchestrationConfig(
  global: DevHarnessOrchestrationConfig | undefined,
  project: DevHarnessOrchestrationConfig | undefined,
): DevHarnessOrchestrationConfig | undefined {
  if (!global && !project) return undefined;
  const g = global ?? {};
  const p = project ?? {};
  const merged: DevHarnessOrchestrationConfig = {
    ...(g.quick_fix_loop || p.quick_fix_loop
      ? { quick_fix_loop: { ...g.quick_fix_loop, ...p.quick_fix_loop } }
      : {}),
    ...(g.implement_loop || p.implement_loop
      ? { implement_loop: { ...g.implement_loop, ...p.implement_loop } }
      : {}),
    ...(g.review_loop || p.review_loop
      ? { review_loop: { ...g.review_loop, ...p.review_loop } }
      : {}),
    ...(g.judgment || p.judgment ? { judgment: { ...g.judgment, ...p.judgment } } : {}),
    ...(g.resume || p.resume ? { resume: { ...g.resume, ...p.resume } } : {}),
    ...(g.commit || p.commit ? { commit: { ...g.commit, ...p.commit } } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Merge global and project harness backend config. Project fields override global.
 */
export { mergeHarnessConfig } from "./harness-resolve.js";
