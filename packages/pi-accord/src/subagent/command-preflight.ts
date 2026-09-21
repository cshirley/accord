/**
 * Shared preflight for `/dev resume` and `/dev finish` core-orchestrator paths.
 */

import {
  isCoreOrchestratorEnabled,
  parseLeadingWorkItemId,
} from "@clive.shirley/accord-core/orchestration/index.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { HookState } from "../hook-state.js";
import { isPlanModeActive, planModeSubagentBlockReason } from "../plan-mode.js";

export type OrchestratorPreflightResult =
  | { kind: "handled" }
  | { kind: "forward" }
  | { kind: "ready"; workItemId: string };

export interface OrchestratorPreflightOptions {
  /** Command name used in the usage warning (e.g. `"resume"`, `"gaps --tickets"`). */
  command: string;
}

export function runOrchestratorPreflight(
  args: string,
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  _state: HookState,
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

  return { kind: "ready", workItemId };
}
