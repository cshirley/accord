/**
 * Resolve the default agent harness selection for headless `accord` CLI.
 */

import { spawnSync } from "node:child_process";
import {
  harnessHasExecRoute,
  mergeHarnessConfig,
  parseHarnessSelection,
  type HarnessSelection,
} from "./harness-resolve.js";
import type { DevHarnessConfig, DevHarnessGlobalConfig } from "./types.js";

export type { HarnessSelection } from "./harness-resolve.js";
export type AgentHarnessId = HarnessSelection["harnessId"];

export function parseHarnessIdValue(raw: string): AgentHarnessId {
  return parseHarnessSelection(raw).harnessId;
}

export function isPiCliAvailable(): boolean {
  const binary = process.env.ACCORD_PI_BIN?.trim() || "pi";
  const result = spawnSync("which", [binary], { encoding: "utf8" });
  return Boolean(result.stdout?.trim());
}

/** @deprecated Use {@link isPiCliAvailable}. */
export const isPiSubagentPackageAvailable = isPiCliAvailable;

function mergedHarnessConfig(
  devConfig?: DevHarnessConfig | null,
  globalConfig?: DevHarnessGlobalConfig | null,
) {
  return mergeHarnessConfig(globalConfig?.harness, devConfig?.harness);
}

/**
 * Resolve default harness when CLI `--harness` flag is omitted.
 */
export function resolveDefaultHarnessSelection(
  devConfig?: DevHarnessConfig | null,
  globalConfig?: DevHarnessGlobalConfig | null,
): HarnessSelection {
  const envHarness = process.env.ACCORD_HARNESS?.trim();
  const merged = mergedHarnessConfig(devConfig, globalConfig);
  if (envHarness) {
    return parseHarnessSelection(envHarness, merged);
  }

  const fromConfig = merged?.default;
  if (fromConfig) {
    return parseHarnessSelection(fromConfig, merged);
  }

  if (harnessHasExecRoute(merged)) {
    const backendId = merged?.backends?.find((b) => b.kind === "exec")?.id;
    return { harnessId: "exec", backendId };
  }

  if (isPiCliAvailable()) {
    return { harnessId: "pi" };
  }

  throw new Error(
    "No default harness configured. Run `accord config init --write` or set harness in ~/.config/accord/accord.json.",
  );
}

/** @deprecated Use {@link resolveDefaultHarnessSelection}. */
export function resolveDefaultHarnessId(
  devConfig?: DevHarnessConfig | null,
  globalConfig?: DevHarnessGlobalConfig | null,
): AgentHarnessId {
  return resolveDefaultHarnessSelection(devConfig, globalConfig).harnessId;
}
