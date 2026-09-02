/**
 * Resolve `--harness` flag to a concrete {@link AgentHarness} implementation.
 */

import { createRequire } from "node:module";
import type { CliContext } from "../context.js";
import { cliNotify } from "../notify.js";
import { createExecHarness } from "./exec.js";
import type { AgentHarness, AgentHarnessFactoryOptions, AgentHarnessId } from "./types.js";

export type { AgentHarness, AgentHarnessId } from "./types.js";

const require = createRequire(import.meta.url);

export const DEFAULT_HARNESS_ID: AgentHarnessId = "pi";

export function parseHarnessId(raw: string | undefined): AgentHarnessId {
  const value = (raw ?? DEFAULT_HARNESS_ID).trim().toLowerCase();
  if (value === "pi" || value === "exec") {
    return value;
  }
  throw new Error(`Unknown harness "${raw}". Supported: pi, exec.`);
}

function loadPiHeadlessHarnessFactory(): (options: AgentHarnessFactoryOptions) => AgentHarness {
  const mod = require("@clive.shirley/pi-accord-harness/adapters/pi/headless-harness.js") as {
    createPiHeadlessHarness: (options: AgentHarnessFactoryOptions) => AgentHarness;
  };
  return mod.createPiHeadlessHarness;
}

export function createHarness(
  id: AgentHarnessId,
  ctx: CliContext,
  options?: { spawnNotifyLabel?: string; autoConfirm?: boolean },
): AgentHarness {
  const factoryOptions: AgentHarnessFactoryOptions = {
    cwd: ctx.cwd,
    autoConfirm: options?.autoConfirm,
    spawnNotifyLabel: options?.spawnNotifyLabel,
    state: ctx.state,
    notify: (level, text) => cliNotify(level, text),
  };

  switch (id) {
    case "pi":
      return loadPiHeadlessHarnessFactory()(factoryOptions);
    case "exec":
      return createExecHarness(factoryOptions);
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
