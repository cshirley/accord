/**
 * init-detect — deterministic project stack detection for /dev init.
 *
 * Bundles all scanning, inference, and config placement resolution into a
 * single function so the LLM only handles user interaction (confirmation,
 * corrections, context source scoping, placement choice).
 */

import * as fs from "node:fs";

import {
  buildDevHarnessConfig,
  type ContextSourceConfig,
  type DevHarnessConfig,
  extractDevHarnessJson,
  loadGlobalConfig,
  resolveConfigLocation,
} from "./index.js";

// ── Types ──────────────────────────────────────────────────

export interface ConfigPlacement {
  type: "root_exists" | "root_no_config" | "root_no_agents" | "at_root";
  git_root?: string;
  root_agents_md?: string;
  /** Parsed config from root AGENTS.md — only present when type=root_exists */
  existing_root_config?: DevHarnessConfig;
}

export interface InitDetectResult {
  /** The fully detected config proposal. null when no project files found. */
  proposed_config: DevHarnessConfig | null;
  /** Where the config should live and what already exists. */
  placement: ConfigPlacement;
  /** Global context sources from ~/.config/pi/agent/accord.json */
  global_context_sources: ContextSourceConfig[];
  /** Human-readable notes explaining what was detected and why. */
  detection_notes: string[];
  /** Pre-formatted summary for presenting to the user in Step 6 confirmation. */
  formatted_summary: string;
}

// ── Detection entry point ──────────────────────────────────

export function devInitDetect(cwd?: string): InitDetectResult {
  const dir = cwd ?? process.cwd();
  const notes: string[] = [];

  // 1. Detect stack and build proposed config
  const buildResult = buildDevHarnessConfig(dir);

  if (!buildResult) {
    notes.push(`No recognised project files in ${dir}.`);
    return {
      proposed_config: null,
      placement: resolveConfigPlacement(dir),
      global_context_sources: loadGlobalContextSources(),
      detection_notes: notes,
      formatted_summary: `No recognised project files in ${dir}. Create a project first, or specify the language manually.`,
    };
  }

  const proposed = buildResult.config;

  // 2. Merge detection notes from the builder
  notes.push(...buildResult.notes);

  // 3. Resolve config placement
  const placement = resolveConfigPlacement(dir);
  addPlacementNotes(placement, notes);

  // 4. Load global context sources for the LLM to present
  const globalSources = loadGlobalContextSources();

  // 5. Build formatted summary
  const summary = formatSummary(dir, proposed, placement, globalSources);

  return {
    proposed_config: proposed,
    placement,
    global_context_sources: globalSources,
    detection_notes: notes,
    formatted_summary: summary,
  };
}

// ── Placement resolution ───────────────────────────────────

function resolveConfigPlacement(dir: string): ConfigPlacement {
  const result = resolveConfigLocation(dir);

  const placement: ConfigPlacement = {
    type: result.type,
    git_root: result.gitRoot,
    root_agents_md: result.rootAgentsMd,
  };

  // If root already has config, parse it for diffing
  if (result.type === "root_exists" && result.rootAgentsMd) {
    try {
      const content = fs.readFileSync(result.rootAgentsMd, "utf8");
      const jsonStr = extractDevHarnessJson(content);
      if (jsonStr) {
        placement.existing_root_config = JSON.parse(jsonStr);
      }
    } catch {
      /* ignore parse errors */
    }
  }

  return placement;
}

// ── Placement notes ────────────────────────────────────────

function addPlacementNotes(placement: ConfigPlacement, notes: string[]): void {
  switch (placement.type) {
    case "at_root":
      notes.push("Config placement: at git root (standard)");
      break;
    case "root_exists":
      notes.push(
        "Config placement: sub-directory of git root — root AGENTS.md already has ACCORD config",
      );
      break;
    case "root_no_config":
      notes.push(
        "Config placement: sub-directory of git root — root AGENTS.md exists but has no ACCORD compatibility section",
      );
      break;
    case "root_no_agents":
      notes.push("Config placement: sub-directory of git root — no root AGENTS.md found");
      break;
  }
}

// ── Global context sources ─────────────────────────────────

function loadGlobalContextSources(): ContextSourceConfig[] {
  const globalCfg = loadGlobalConfig();
  return globalCfg?.context_sources?.filter((s) => s.enabled !== false) ?? [];
}

// ── Formatted summary ──────────────────────────────────────

function formatSummary(
  dir: string,
  config: DevHarnessConfig,
  placement: ConfigPlacement,
  globalSources: ContextSourceConfig[],
): string {
  const lines: string[] = [];

  lines.push(`Detected: ${config.language} project (${config.detect_file ?? "auto"}) in ${dir}`);
  lines.push("");
  lines.push(`  test:       ${config.test.command}`);
  lines.push(`  type_check: ${config.type_check ?? "(none)"}`);
  lines.push(`  lint:       ${config.lint ?? "(none)"}`);
  lines.push(`  format:     ${config.format ?? "(none)"}`);

  if (config.tracker) {
    const prefix = config.tracker.project_prefix
      ? ` (prefix: ${config.tracker.project_prefix})`
      : "";
    lines.push(`  tracker:    ${config.tracker.type}${prefix}`);
  } else {
    lines.push("  tracker:    (not detected — will ask)");
  }

  if (config.monorepo?.tool) {
    lines.push(`  monorepo:   ${config.monorepo.tool} (root: ${config.monorepo.root ?? "."})`);
  } else {
    lines.push("  monorepo:   none");
  }

  // Context sources
  const sourceNames = globalSources.map((s) => s.type).join(", ");
  if (config.context_sources?.length) {
    const projectScoped = config.context_sources.map((s) => {
      const parts: string[] = [s.type];
      if (s.channels?.length) parts.push(`(${s.channels.join(", ")})`);
      if (s.space) parts.push(`(${s.space})`);
      return parts.join(" ");
    });
    lines.push(`  sources:    ${projectScoped.join(", ")}`);
  } else if (sourceNames) {
    lines.push(`  sources:    global: ${sourceNames} (no project scoping yet)`);
  } else {
    lines.push("  sources:    none configured");
  }

  lines.push("");
  lines.push("  verification_commands:");
  config.verification_commands.forEach((cmd, i) => {
    lines.push(`    ${i + 1}. ${cmd}`);
  });

  // Placement info
  lines.push("");
  switch (placement.type) {
    case "at_root":
      lines.push("Config will be written to AGENTS.md in current directory.");
      break;
    case "root_exists":
      lines.push("Root AGENTS.md already has ACCORD config.");
      lines.push("  [L]ink to it — use root config, write ref directive locally");
      lines.push("  [O]verride — write a local config for this directory only");
      lines.push("  [R]e-detect — replace root config with this detection + link locally");
      break;
    case "root_no_config":
      lines.push("Root AGENTS.md exists but has no ACCORD compatibility section.");
      lines.push("  Write config to root and link from here? [y/n]");
      break;
    case "root_no_agents":
      lines.push("No root AGENTS.md found.");
      lines.push("  Create AGENTS.md with config at repo root? [y/n]");
      break;
  }

  // If root_exists, show diff hint
  if (placement.type === "root_exists" && placement.existing_root_config) {
    const diffs = diffConfigs(placement.existing_root_config, config);
    if (diffs.length > 0) {
      lines.push("");
      lines.push("Differences from existing root config:");
      for (const d of diffs) {
        lines.push(`  ${d}`);
      }
    } else {
      lines.push("");
      lines.push("Detected config matches existing root config.");
    }
  }

  return lines.join("\n");
}

// ── Config diff ────────────────────────────────────────────

function diffConfigs(existing: DevHarnessConfig, proposed: DevHarnessConfig): string[] {
  const diffs: string[] = [];

  if (existing.language !== proposed.language) {
    diffs.push(`language: ${existing.language} → ${proposed.language}`);
  }
  if (existing.test.command !== proposed.test.command) {
    diffs.push(`test.command: ${existing.test.command} → ${proposed.test.command}`);
  }
  if (existing.type_check !== proposed.type_check) {
    diffs.push(
      `type_check: ${existing.type_check ?? "(none)"} → ${proposed.type_check ?? "(none)"}`,
    );
  }
  if (existing.lint !== proposed.lint) {
    diffs.push(`lint: ${existing.lint ?? "(none)"} → ${proposed.lint ?? "(none)"}`);
  }
  if (existing.format !== proposed.format) {
    diffs.push(`format: ${existing.format ?? "(none)"} → ${proposed.format ?? "(none)"}`);
  }
  if (existing.monorepo?.tool !== proposed.monorepo?.tool) {
    diffs.push(
      `monorepo.tool: ${existing.monorepo?.tool ?? "(none)"} → ${proposed.monorepo?.tool ?? "(none)"}`,
    );
  }
  if (existing.tracker?.type !== proposed.tracker?.type) {
    diffs.push(
      `tracker.type: ${existing.tracker?.type ?? "(none)"} → ${proposed.tracker?.type ?? "(none)"}`,
    );
  }

  const existingVc = (existing.verification_commands ?? []).join(", ");
  const proposedVc = (proposed.verification_commands ?? []).join(", ");
  if (existingVc !== proposedVc) {
    diffs.push(`verification_commands differ`);
  }

  return diffs;
}
