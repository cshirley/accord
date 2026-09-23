/**
 * Resolve `--harness` flag to a concrete {@link AgentHarness} implementation.
 */

import { loadGlobalConfig } from "@clive.shirley/accord-core/config/global.js";
import { resolveDefaultHarnessSelection } from "@clive.shirley/accord-core/config/harness-default.js";
import {
  mergeHarnessConfig,
  parseHarnessSelection,
  resolveAgentTierConfig,
  resolveBackendExecConfig,
  type HarnessSelection,
} from "@clive.shirley/accord-core/config/harness-resolve.js";
import { discoverAvailableToolNames } from "@clive.shirley/accord-core/integrations/mcp-tool-discovery.js";
import type { PreparedSingleSubagentInput } from "@clive.shirley/accord-core/subagent/run-request.js";
import type { CliContext } from "../context.js";
import { loadAgentFromSpawnFile } from "./exec-agent-shared.js";
import { cliNotify } from "../notify.js";
import { createCliLifecycleHost } from "./cli-lifecycle-host.js";
import { runExecSpawn } from "./exec.js";
import { runPiExecSpawn } from "./pi-exec.js";
import { runSpawnPipeline } from "./spawn-pipeline.js";
import type { AgentHarness, AgentHarnessFactoryOptions, AgentHarnessId } from "./types.js";

export type { AgentHarness, AgentHarnessId } from "./types.js";

export type HarnessSelectionResult = HarnessSelection;

/** @deprecated Use resolveDefaultHarnessSelection. */
export const DEFAULT_HARNESS_ID: AgentHarnessId = "pi";

export function parseHarnessSelectionFromCli(
  raw: string | undefined,
  ctx?: CliContext,
): HarnessSelectionResult {
  const globalConfig = loadGlobalConfig();
  const merged = mergeHarnessConfig(globalConfig?.harness, ctx?.devConfig?.harness);
  if (raw?.trim()) {
    return parseHarnessSelection(raw, merged);
  }
  return resolveDefaultHarnessSelection(ctx?.devConfig, globalConfig);
}

/** @deprecated Use {@link parseHarnessSelectionFromCli}. */
export function parseHarnessId(raw: string | undefined, ctx?: CliContext): AgentHarnessId {
  return parseHarnessSelectionFromCli(raw, ctx).harnessId;
}

function resolveSpawnHarnessSelection(
  prepared: PreparedSingleSubagentInput,
  harnessConfig: AgentHarnessFactoryOptions["harnessConfig"],
  session: HarnessSelectionResult,
  explicitSessionHarness: boolean,
): HarnessSelectionResult {
  if (explicitSessionHarness) {
    return session;
  }
  const agent = loadAgentFromSpawnFile(prepared.agentFile);
  const tier = resolveAgentTierConfig(harnessConfig, {
    tier: agent?.tier,
    agentName: agent?.name ?? prepared.agent,
  });
  if (tier?.harness) {
    return parseHarnessSelection(tier.harness, harnessConfig);
  }
  return session;
}

export function createHarness(
  selection: HarnessSelectionResult,
  ctx: CliContext,
  options?: {
    spawnNotifyLabel?: string;
    autoConfirm?: boolean;
    availableToolNames?: Set<string>;
    /** When true, per-agent tier harness routing cannot override the session selection. */
    explicitSessionHarness?: boolean;
  },
): AgentHarness {
  const notify = (level: Parameters<typeof cliNotify>[0], text: string) => cliNotify(level, text);
  const globalConfig = loadGlobalConfig();
  const mergedHarness = mergeHarnessConfig(globalConfig?.harness, ctx.devConfig?.harness);
  const factoryOptions: AgentHarnessFactoryOptions = {
    cwd: ctx.cwd,
    autoConfirm: options?.autoConfirm,
    spawnNotifyLabel: options?.spawnNotifyLabel,
    state: ctx.state,
    harnessConfig: mergedHarness,
    sessionSelection: selection,
    execBackendId: selection.backendId,
    availableToolNames: options?.availableToolNames ?? discoverAvailableToolNames(ctx.cwd),
    lifecycleHost:
      ctx.state.lifecycleHost ??
      createCliLifecycleHost({ notify, autoConfirm: options?.autoConfirm }),
    notify,
  };

  return {
    id: selection.harnessId,
    cwd: factoryOptions.cwd,

    notify(level, text) {
      notify(level, text);
    },

    async spawnSubagent(request) {
      return runSpawnPipeline(
        request,
        {
          cwd: factoryOptions.cwd,
          state: factoryOptions.state,
          lifecycleHost: factoryOptions.lifecycleHost,
          availableToolNames: factoryOptions.availableToolNames,
          autoConfirm: factoryOptions.autoConfirm,
          spawnNotifyLabel: factoryOptions.spawnNotifyLabel,
          notify,
        },
        async (prepared) => {
          const spawnSelection = resolveSpawnHarnessSelection(
            prepared,
            mergedHarness,
            selection,
            options?.explicitSessionHarness ?? false,
          );
          if (spawnSelection.harnessId === "pi") {
            return runPiExecSpawn(prepared, factoryOptions.cwd);
          }
          const execConfig = resolveBackendExecConfig(
            mergedHarness,
            spawnSelection.backendId ?? selection.backendId,
          );
          if (!execConfig?.command?.length) {
            return {
              agent: prepared.agent,
              task: prepared.task,
              exitCode: 1,
              stderr:
                "No exec harness command configured for this spawn. Run `accord config init --write`.",
            };
          }
          return runExecSpawn(prepared, factoryOptions.cwd, execConfig);
        },
      );
    },
  };
}
