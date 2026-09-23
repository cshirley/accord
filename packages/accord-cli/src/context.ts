/**
 * CLI session context — dev harness config + mutable harness state.
 */

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { runSessionStartHook } from "@clive.shirley/accord-core/harness/lifecycle-wiring.js";
import type { HarnessLifecycleHost } from "@clive.shirley/accord-core/types/harness-lifecycle.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";
import { createCliLifecycleHost } from "./harnesses/cli-lifecycle-host.js";
import { cliNotify } from "./notify.js";

export type CliHarnessMutableState = HarnessMutableState & {
  lifecycleHost?: HarnessLifecycleHost;
};

export type CliContext = {
  cwd: string;
  devConfig: DevHarnessConfig | null;
  state: CliHarnessMutableState;
};

export function createCliContext(cwd: string, options?: { autoConfirm?: boolean }): CliContext {
  const devConfig = loadDevHarnessConfig(cwd);
  const lifecycleHost = createCliLifecycleHost({
    notify: (level, text) => cliNotify(level, text),
    autoConfirm: options?.autoConfirm,
  });
  const state: CliHarnessMutableState = {
    devConfig,
    costCache: new Map(),
    sessionCost: 0,
    activeWorkItem: null,
    lifecycleHost,
  };
  runSessionStartHook({ cwd, devConfig, state, host: lifecycleHost });
  return { cwd, devConfig, state };
}

export function createCliContextFromHarnessState(
  cwd: string,
  state: CliHarnessMutableState,
  options?: { autoConfirm?: boolean },
): CliContext {
  const devConfig = state.devConfig ?? loadDevHarnessConfig(cwd);
  if (!state.lifecycleHost) {
    state.lifecycleHost = createCliLifecycleHost({
      notify: (level, text) => cliNotify(level, text),
      autoConfirm: options?.autoConfirm,
    });
    runSessionStartHook({ cwd, devConfig, state, host: state.lifecycleHost });
  }
  return {
    cwd,
    devConfig,
    state,
  };
}
