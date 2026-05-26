/**
 * Shared preflight for `/dev resume` and `/dev finish` core-orchestrator paths.
 *
 * Both commands check the same gates before executing the orchestration:
 *
 *   1. Core orchestrator enabled (default) — set `ACCORD_CORE_ORCHESTRATOR=0` to disable programmatic spawns.
 *   2. Plan mode is not active — otherwise warn and consume the command.
 *   3. The work item ID is parseable from the arg string — otherwise show usage.
 *   4. Build a runtime host wired to the Pi adapter.
 *
 * The caller then runs the command-specific orchestration with the returned
 * `workItemId` + `host`. Returning a discriminated union keeps the call sites
 * a small switch statement.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OrchestrationRuntimeHost } from "../../../core/orchestration/host.js";
import {
  isCoreOrchestratorEnabled,
  parseLeadingWorkItemId,
} from "../../../core/orchestration/index.js";
import type { HookState } from "../hook-state.js";
import { isPlanModeActive, planModeSubagentBlockReason } from "../plan-mode.js";
import { createResumeOrchestrationRuntimeHost } from "./runtime-host.js";

export type OrchestratorPreflightResult =
  | { kind: "handled" }
  | { kind: "forward" }
  | { kind: "ready"; workItemId: string; host: OrchestrationRuntimeHost };

export interface OrchestratorPreflightOptions {
  /** Command name used in the usage warning (e.g. `"resume"`, `"finish"`). */
  command: "resume" | "finish";
  /** Notification label propagated through `spawn` (`"Resume"` or `"Finish"`). */
  spawnNotifyLabel: string;
}

export function runOrchestratorPreflight(
  args: string,
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  options: OrchestratorPreflightOptions,
): OrchestratorPreflightResult {
  if (!isCoreOrchestratorEnabled()) return { kind: "forward" };

  if (isPlanModeActive(ctx)) {
    ctx.ui.notify(planModeSubagentBlockReason(), "warning");
    return { kind: "handled" };
  }

  const workItemId = parseLeadingWorkItemId(args);
  if (!workItemId) {
    ctx.ui.notify(`Usage: \`/dev ${options.command} <work-item-id>\``, "warning");
    return { kind: "handled" };
  }

  const availableToolNames = new Set(pi.getAllTools().map((tool) => tool.name));
  const host = createResumeOrchestrationRuntimeHost(pi, ctx, state, {
    availableToolNames,
    spawnNotifyLabel: options.spawnNotifyLabel,
  });

  return { kind: "ready", workItemId, host };
}
