/**
 * Harness backend resolution — named backends, tiers, legacy exec/pi ids.
 */

import type {
  AgentTierConfig,
  DevHarnessConfig,
  DevHarnessGlobalConfig,
  DevHarnessHarnessConfig,
  ExecHarnessConfig,
  ModelTierName,
} from "./types.js";

export type HarnessSelection = {
  /** Runtime harness implementation: `pi` subprocess or `exec` template. */
  harnessId: "pi" | "exec";
  /** Named backend id from `harness.backends` (e.g. claude, cursor). */
  backendId?: string;
};

const LEGACY_HARNESS_IDS = new Set(["pi", "exec"]);

export function isLegacyHarnessId(raw: string): boolean {
  return LEGACY_HARNESS_IDS.has(raw.trim().toLowerCase());
}

export function listHarnessBackendIds(harness?: DevHarnessHarnessConfig): string[] {
  return harness?.backends?.map((backend) => backend.id) ?? [];
}

/**
 * Parse `--harness` / `harness.default` value.
 * Accepts legacy `pi`|`exec` or a named backend id from `harness.backends`.
 */
export function parseHarnessSelection(
  raw: string,
  harness?: DevHarnessHarnessConfig,
): HarnessSelection {
  const value = raw.trim().toLowerCase();
  if (value === "pi") {
    return { harnessId: "pi" };
  }
  if (value === "exec") {
    return { harnessId: "exec", backendId: resolveDefaultBackendId(harness) };
  }

  const backend = harness?.backends?.find((entry) => entry.id === value);
  if (!backend) {
    const known = listHarnessBackendIds(harness);
    const hint = known.length > 0 ? ` Known backends: ${known.join(", ")}.` : "";
    throw new Error(`Unknown harness "${raw}".${hint}`);
  }
  return { harnessId: backend.kind, backendId: backend.id };
}

export function resolveDefaultBackendId(harness?: DevHarnessHarnessConfig): string | undefined {
  const rawDefault = harness?.default?.trim().toLowerCase();
  if (!rawDefault) return harness?.backends?.[0]?.id;
  if (rawDefault === "pi" || rawDefault === "exec") {
    return harness?.backends?.find((backend) => backend.kind === rawDefault)?.id;
  }
  return rawDefault;
}

export function resolveHarnessSelection(
  raw: string | undefined,
  devConfig?: DevHarnessConfig | null,
  globalConfig?: DevHarnessGlobalConfig | null,
): HarnessSelection {
  const merged = mergeHarnessConfig(globalConfig?.harness, devConfig?.harness);
  if (raw?.trim()) {
    return parseHarnessSelection(raw, merged);
  }
  const defaultRaw = merged?.default ?? (merged?.exec?.command?.length ? "exec" : undefined);
  if (!defaultRaw) {
    throw new Error("No harness default configured.");
  }
  return parseHarnessSelection(defaultRaw, merged);
}

/**
 * Merge global (~/.config/accord) harness config with optional project AGENTS.md overrides.
 *
 * Executable backends (`default`, `backends`, `exec`) are trusted from global config only.
 * Project repos may override tier routing/models but cannot define or select exec commands.
 */
export function mergeHarnessConfig(
  global: DevHarnessHarnessConfig | undefined,
  project: DevHarnessHarnessConfig | undefined,
): DevHarnessHarnessConfig | undefined {
  if (!global && !project) return undefined;
  const g = global ?? {};
  const tiers = mergeHarnessTiers(g.tiers, project?.tiers);
  const backends = g.backends?.length ? [...g.backends] : undefined;
  const exec = g.exec;
  const defaultHarness = g.default;
  if (!exec && !defaultHarness && !backends?.length && !tiers) {
    return undefined;
  }
  return {
    ...(defaultHarness ? { default: defaultHarness } : {}),
    ...(backends?.length ? { backends } : {}),
    ...(tiers ? { tiers } : {}),
    ...(exec ? { exec } : {}),
  };
}

function mergeHarnessTiers(
  global: DevHarnessHarnessConfig["tiers"],
  project: DevHarnessHarnessConfig["tiers"],
): DevHarnessHarnessConfig["tiers"] {
  if (!global && !project) return undefined;
  return { ...global, ...project };
}

export function resolveBackendExecConfig(
  harness: DevHarnessHarnessConfig | undefined,
  backendId?: string,
): ExecHarnessConfig | undefined {
  if (!harness) return undefined;
  const targetId = backendId ?? resolveDefaultBackendId(harness);
  if (targetId) {
    const backend = harness.backends?.find((entry) => entry.id === targetId);
    if (backend?.kind === "exec" && backend.command?.length) {
      return {
        command: backend.command,
        response_json: backend.response_json ?? "stdout",
        env: backend.env,
      };
    }
    if (backend?.kind === "pi") {
      return undefined;
    }
  }
  return harness.exec;
}

export function harnessHasExecRoute(harness?: DevHarnessHarnessConfig): boolean {
  if (!harness) return false;
  if (harness.exec?.command?.length) return true;
  return Boolean(harness.backends?.some((backend) => backend.kind === "exec" && backend.command?.length));
}

export function resolveAgentTierConfig(
  harness: DevHarnessHarnessConfig | undefined,
  options: { tier?: ModelTierName; agentName?: string },
): AgentTierConfig | undefined {
  if (!harness?.tiers) return undefined;
  if (options.agentName?.startsWith("review-") && harness.tiers.review) {
    return harness.tiers.review;
  }
  const tier = options.tier ?? "workhorse";
  return harness.tiers[tier];
}
