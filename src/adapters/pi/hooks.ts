/**
 * Event hooks — Pi lifecycle → `core/harness` (host-neutral) + Pi UI wiring.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadDevHarnessConfig } from "../../core/config/index.js";
import { resolveLogLevel, setLogLevel } from "../../core/logging.js";
import {
  formatArtifactValidationFailureMessage,
  validateHarnessArtifactWriteIfApplicable,
  isAgentsMdPath,
  prepareSubagentToolCall,
  processSubagentToolResult,
  runGatherPreflightOnSubagentCall,
  runVerifyPreflightOnSubagentCall,
  processOrchestratorTurnEnd,
  createOrchestratorUsageDedup,
  notifyPendingDecisionsIfAny,
  seedHarnessSessionCostState,
  applyHarnessCostSeed,
} from "../../core/harness/index.js";
import {
  loadPricing,
  inferWorkItemIdFromSession,
  assembleHandoffContent,
  clearHarnessRunTag,
} from "../../core/telemetry/usage.js";
import { syncHarnessRunSessionEntry, type HookState } from "./hook-state.js";
import { isPlanModeActive, planModeSubagentBlockReason } from "./plan-mode.js";
import { updateStatusBar } from "./status-bar.js";

export { syncHarnessRunSessionEntry } from "./hook-state.js";
export type { HookState } from "./hook-state.js";

export function registerHooks(
  pi: ExtensionAPI,
  state: HookState,
): void {
  const pricing = loadPricing();
  const orchestratorDedup = createOrchestratorUsageDedup();

  // ── File validation ──────────────────────────────────

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (event.isError) return;

    const filePath = (event.input as { path?: string })?.path;
    const res = await validateHarnessArtifactWriteIfApplicable(filePath);
    if (res.skip) return;
    if (!res.valid) {
      return {
        content: [
          {
            type: "text",
            text: formatArtifactValidationFailureMessage(filePath!, res.errors),
          },
        ],
        isError: true,
      };
    }
  });

  // ── Config auto-refresh ──────────────────────────────

  pi.on("tool_result", async (event, _ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (event.isError) return;
    const filePath = (event.input as { path?: string })?.path;
    if (isAgentsMdPath(filePath)) {
      state.devConfig = loadDevHarnessConfig();
      setLogLevel(resolveLogLevel(state.devConfig?.log_level));
    }
  });

  // ── Config guard + brief injection (+ gather/verify preflight) ──

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "subagent") return;
    if (isPlanModeActive(ctx)) return { block: true, reason: planModeSubagentBlockReason() };

    const input = event.input as Record<string, unknown>;
    const availableToolNames = new Set(pi.getAllTools().map(t => t.name));

    const prep = prepareSubagentToolCall(input, state.devConfig);
    if (prep.blockReason) return { block: true, reason: prep.blockReason };

    const gather = await runGatherPreflightOnSubagentCall(input, state.devConfig, availableToolNames, {
      notify: (level, msg) => ctx.ui.notify(msg, level === "warning" ? "warning" : "info"),
      confirm: (title, body) => ctx.ui.confirm(title, body),
    });
    if (gather.blockReason) return { block: true, reason: gather.blockReason };

    const verify = await runVerifyPreflightOnSubagentCall(input, state.devConfig);
    if (verify.blockReason) return { block: true, reason: verify.blockReason };
  });

  // ── Subagent result processing ───────────────────────

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "subagent") return;

    const contentAppend = await processSubagentToolResult({
      details: event.details,
      state,
      pricing,
      host: {
        syncHarnessRunMeta: () => syncHarnessRunSessionEntry(pi, state),
        refreshUi: () => updateStatusBar(ctx, state),
      },
    });

    if (contentAppend) {
      return { content: assembleHandoffContent(event.content, contentAppend) };
    }
  });

  // ── Orchestrator usage (main session) ─────────────────

  pi.on("turn_end", async (event, ctx) => {
    const workItemId = inferWorkItemIdFromSession(ctx, state.activeWorkItem);
    processOrchestratorTurnEnd({
      message: event.message,
      workItemId,
      state,
      pricing,
      dedup: orchestratorDedup,
      host: {
        syncHarnessRunMeta: () => syncHarnessRunSessionEntry(pi, state),
        refreshUi: () => updateStatusBar(ctx, state),
      },
    });
  });

  // ── End-of-turn notification ─────────────────────────

  pi.on("agent_end", async (_event, ctx) => {
    notifyPendingDecisionsIfAny({
      notify: (level, msg) => ctx.ui.notify(msg, level === "warning" ? "warning" : "info"),
    });
    updateStatusBar(ctx, state);
  });

  // ── Session start ────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state.devConfig = loadDevHarnessConfig();
    setLogLevel(resolveLogLevel(state.devConfig?.log_level));
    clearHarnessRunTag();
    applyHarnessCostSeed(state, seedHarnessSessionCostState());
    updateStatusBar(ctx, state);
    syncHarnessRunSessionEntry(pi, state);
  });
}
