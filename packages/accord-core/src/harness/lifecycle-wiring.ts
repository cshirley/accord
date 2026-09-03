/**
 * Wire core harness callables into {@link HarnessLifecycleHost} hook sites.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { runSubagentToolPreflight } from "../subagent/preflight-runner.js";
import { processSubagentToolResult } from "../subagent/result/process.js";
import type { PricingConfig } from "../telemetry/usage.js";
import type {
  HarnessLifecycleHost,
  HarnessSubagentSpawnRequest,
} from "../types/harness-lifecycle.js";
import type { HarnessMutableState } from "../types/host.js";
import {
  formatArtifactValidationFailureMessage,
  validateHarnessArtifactWriteIfApplicable,
} from "./artifact-write.js";
import { applyHarnessCostSeed, seedHarnessSessionCostState } from "./session-start.js";
import { prepareWorkflowStateBeforeSpawn } from "./workflow-state-spawn.js";

export type WireHarnessLifecycleOptions = {
  host: HarnessLifecycleHost;
  state: HarnessMutableState;
  devConfig: DevHarnessConfig | null;
  pricing: PricingConfig;
  availableToolNames?: Set<string>;
};

export type SessionStartHookOptions = {
  cwd: string;
  host: HarnessLifecycleHost;
  state: HarnessMutableState;
  devConfig: DevHarnessConfig | null;
};

/** Session bootstrap — cost cache seed + optional host callback. */
export function runSessionStartHook(options: SessionStartHookOptions): void {
  const seed = seedHarnessSessionCostState();
  applyHarnessCostSeed(options.state, seed);
  options.state.devConfig = options.devConfig;
  void options.host.onSessionStart?.({
    cwd: options.cwd,
    devConfig: options.devConfig,
    state: options.state,
  });
}

/**
 * Validate a harness-tracked JSON write (artifact on-write hook).
 * Returns a user-facing error message when validation fails.
 */
export async function runArtifactWriteHook(
  filePath: string | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await validateHarnessArtifactWriteIfApplicable(filePath);
  if (result.skip) return { ok: true };
  if (result.valid) return { ok: true };
  return {
    ok: false,
    message: formatArtifactValidationFailureMessage(filePath ?? "(unknown path)", result.errors),
  };
}

/**
 * Subagent preflight hook — gather/verify gates before spawn.
 */
export async function runSubagentPrepareHook(
  spawn: HarnessSubagentSpawnRequest,
  options: Pick<WireHarnessLifecycleOptions, "devConfig" | "host" | "availableToolNames">,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const custom = await options.host.onSubagentPrepare?.(spawn);
  if (custom?.block) {
    return { ok: false, reason: custom.reason ?? "Subagent spawn blocked by host." };
  }

  const availableToolNames = options.availableToolNames ?? new Set<string>();
  const preflight = await runSubagentToolPreflight(spawn.input, {
    devConfig: options.devConfig,
    availableToolNames,
    host: {
      notify: (level, msg) => options.host.notify(level === "warning" ? "warning" : "info", msg),
      confirm: options.host.confirm ?? (async () => true),
    },
  });
  if (preflight.blockReason) {
    return { ok: false, reason: preflight.blockReason };
  }

  const workflowPrep = prepareWorkflowStateBeforeSpawn({
    agent: spawn.agent,
    task: spawn.task,
    devConfig: options.devConfig,
  });
  if (!workflowPrep.ok) {
    return { ok: false, reason: workflowPrep.reason };
  }

  return { ok: true };
}

/**
 * Subagent result hook — usage, return packets, post-code verification.
 */
export async function runSubagentResultHook(
  details: unknown,
  options: WireHarnessLifecycleOptions,
): Promise<string> {
  await options.host.onSubagentResult?.({ details, state: options.state });
  return processSubagentToolResult({
    details,
    state: options.state,
    pricing: options.pricing,
  });
}

export { createNoopHarnessLifecycleHost } from "../types/harness-lifecycle.js";
