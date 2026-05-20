/**
 * Pi `pi.on(...)` registrations — kept separate from `hooks.ts` so the entry
 * module stays a small surface for exports + `registerHooks` wiring.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadDevHarnessConfig } from "../../core/config/index.js";
import {
  applyHarnessCostSeed,
  createOrchestratorUsageDedup,
  formatArtifactValidationFailureMessage,
  isAgentsMdPath,
  notifyPendingDecisionsIfAny,
  processOrchestratorTurnEnd,
  processSubagentToolResult,
  runSubagentToolPreflight,
  seedHarnessSessionCostState,
  validateHarnessArtifactWriteIfApplicable,
} from "../../core/harness/index.js";
import { resolveLogLevel, setLogLevel } from "../../core/logging.js";
import {
  assembleHandoffContent,
  clearHarnessRunTag,
  inferWorkItemIdFromSession,
  loadPricing,
} from "../../core/telemetry/usage.js";
import { type HookState, syncHarnessRunSessionEntry } from "./hook-state.js";
import { isPlanModeActive, planModeSubagentBlockReason } from "./plan-mode.js";
import { updateStatusBar } from "./status-bar.js";

export function registerPiHarnessHookListeners(pi: ExtensionAPI, state: HookState): void {
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
      const pathForMessage = filePath ?? "(unknown path)";
      return {
        content: [
          {
            type: "text",
            text: formatArtifactValidationFailureMessage(pathForMessage, res.errors),
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
    const availableToolNames = new Set(pi.getAllTools().map((t) => t.name));

    const preflight = await runSubagentToolPreflight(input, {
      devConfig: state.devConfig,
      availableToolNames,
      host: {
        notify: (level, msg) => ctx.ui.notify(msg, level === "warning" ? "warning" : "info"),
        confirm: (title, body) => ctx.ui.confirm(title, body),
      },
    });
    if (preflight.blockReason) return { block: true, reason: preflight.blockReason };
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
