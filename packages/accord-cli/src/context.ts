/**
 * CLI session context — dev harness config + mutable harness state.
 */

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";

export type CliContext = {
  cwd: string;
  devConfig: DevHarnessConfig | null;
  state: HarnessMutableState;
};

export function createCliContext(cwd: string): CliContext {
  const devConfig = loadDevHarnessConfig(cwd);
  return {
    cwd,
    devConfig,
    state: {
      devConfig,
      costCache: new Map(),
      sessionCost: 0,
      activeWorkItem: null,
    },
  };
}

export function createCliContextFromHarnessState(
  cwd: string,
  state: HarnessMutableState,
): CliContext {
  const devConfig = state.devConfig ?? loadDevHarnessConfig(cwd);
  return {
    cwd,
    devConfig,
    state,
  };
}
