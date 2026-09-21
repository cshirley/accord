/**
 * Pi extension harness — full TUI runtime host as an {@link AgentHarness}.
 */

import type { AgentHarness } from "@clive.shirley/accord-cli/harnesses/types.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { HookState } from "./hook-state.js";
import { createResumeOrchestrationRuntimeHost } from "./subagent/runtime-host.js";

export function createPiExtensionHarness(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  options: { spawnNotifyLabel?: string },
): AgentHarness {
  const availableToolNames = new Set(pi.getAllTools().map((tool) => tool.name));
  const host = createResumeOrchestrationRuntimeHost(pi, ctx, state, {
    availableToolNames,
    spawnNotifyLabel: options.spawnNotifyLabel,
  });

  return {
    id: "pi",
    cwd: ctx.cwd,
    notify: host.notify,
    spawnSubagent: host.spawnSubagent,
    runJudgment: host.runJudgment,
  };
}
