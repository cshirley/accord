/**
 * Before phase-gather subagent: dependency preflight + optional user confirm.
 */

import {
  checkProviderDeps,
  type DepCheckResult,
  formatPreflightReport,
  loadAllProviders,
} from "../../../integrations/provider-deps.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { loadGlobalConfig, mergeContextSources } from "../../config/index.js";
import type { HarnessHost } from "../../types/host.js";
import { firstSubagentAgentName, getPrimarySubagentEntry } from "../entries.js";

export async function runGatherPreflightOnSubagentCall(
  input: Record<string, unknown>,
  devConfig: DevHarnessConfig | null,
  availableToolNames: Set<string>,
  host: HarnessHost,
): Promise<{ blockReason?: string }> {
  if (firstSubagentAgentName(input) !== "phase-gather") return {};

  const globalCfg = loadGlobalConfig();
  const providers = loadAllProviders([
    ...(globalCfg?.providers ?? []),
    ...(devConfig?.providers ?? []),
  ]);

  const trackerType: string = devConfig?.tracker?.type || "jira";
  const trackerDef = providers.trackers.get(trackerType);
  const trackerResult = trackerDef ? checkProviderDeps(trackerDef, availableToolNames) : null;

  const mergedSources = mergeContextSources(globalCfg?.context_sources, devConfig?.context_sources);
  const enrichmentResults: DepCheckResult[] = [];
  for (const src of mergedSources) {
    const def = providers.enrichments.get(src.type);
    if (def) {
      enrichmentResults.push(checkProviderDeps(def, availableToolNames));
    }
  }

  const report = formatPreflightReport(trackerResult, enrichmentResults);
  const unavailableCount = [trackerResult, ...enrichmentResults].filter(
    (r) => r && !r.available,
  ).length;

  if (unavailableCount > 0) {
    host.notify?.(
      "warning",
      `Gather preflight: ${unavailableCount} source(s) unavailable — will use fallbacks or skip`,
    );
    const proceed =
      (await host.confirm?.(
        "Unavailable sources detected",
        `${unavailableCount} configured source(s) cannot be reached.\n\nProceed with gather? (unavailable sources will be skipped)`,
      )) ?? true;
    if (!proceed) {
      return { blockReason: "Gather cancelled by user due to unavailable sources." };
    }
  } else {
    host.notify?.("info", "Gather preflight: all configured sources available");
  }

  const entry = getPrimarySubagentEntry(input);
  if (entry && typeof entry.task === "string") {
    entry.task += report;
  }

  return {};
}
