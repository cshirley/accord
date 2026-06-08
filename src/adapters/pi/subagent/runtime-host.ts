/**
 * Pi {@link OrchestrationRuntimeHost} — preflight, programmatic spawn, harness result path.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { tryCommitOnTaskDone } from "../../../core/orchestration/commit-on-task-done.js";
import type { OrchestrationRuntimeHost } from "../../../core/orchestration/host.js";
import {
  buildSingleSubagentRunRequest,
  processSubagentToolResult,
  readPreparedSingleSubagentInput,
  runSubagentToolPreflight,
} from "../../../core/subagent/index.js";
import {
  extractTaskIdFromTaskText,
  extractWorkItemId,
  loadPricing,
} from "../../../core/telemetry/usage.js";
import { SPAWN_TIMEOUT_DISABLED, SubagentRunError } from "../../../integrations/pi-subagent.js";
import type { HookState } from "../hook-state.js";
import { syncHarnessRunSessionEntry } from "../hook-state.js";
import { updateStatusBar } from "../status-bar.js";
import { startOrchestratorSubagentChatDisplay } from "./chat-display.js";
import { runOrchestrationJudgment } from "./judgment.js";
import {
  createOrchestrationSubagentOnUpdate,
  mapSpawnResultToSingle,
  type OrchestrationSubagentSingleResult,
  runOrchestrationSubagent,
} from "./spawn-bridge.js";
import {
  clearOrchestratorSpawnWidget,
  mountOrchestratorSpawnWidget,
  refreshOrchestratorSpawnUi,
  registerOrchestratorSpawn,
  startOrchestratorSpawnHeartbeat,
  stopOrchestratorSpawnHeartbeat,
  unregisterOrchestratorSpawn,
  updateOrchestratorSpawn,
} from "./spawn-status.js";

const NOTIFY_APPEND_MAX = 4000;

export function createResumeOrchestrationRuntimeHost(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  options: { availableToolNames: Set<string>; spawnNotifyLabel?: string },
): OrchestrationRuntimeHost {
  const pricing = loadPricing();
  const spawnLabel = options.spawnNotifyLabel ?? "Orchestration";

  return {
    notify(level, text) {
      const uiLevel = level === "error" ? "error" : level === "warning" ? "warning" : "info";
      ctx.ui.notify(text, uiLevel);
    },

    async spawnSubagent(request: { agent: string; task: string }) {
      const input: Record<string, unknown> = { agent: request.agent, task: request.task };
      const preflight = await runSubagentToolPreflight(input, {
        devConfig: state.devConfig,
        availableToolNames: options.availableToolNames,
        host: {
          notify: (level, msg) => ctx.ui.notify(msg, level === "warning" ? "warning" : "info"),
          confirm: (title, body) => ctx.ui.confirm(title, body),
        },
      });
      if (preflight.blockReason) {
        ctx.ui.notify(preflight.blockReason, "warning");
        return { exitCode: 1 };
      }

      const prepared = readPreparedSingleSubagentInput(input);
      if (!prepared) {
        ctx.ui.notify("Internal error: subagent payload missing after preflight.", "error");
        return { exitCode: 1 };
      }

      const { agent, task } = prepared;

      ctx.ui.notify(`${spawnLabel}: starting ${agent}…`, "info");

      const spawnStatusId = `spawn-${agent}-${String(Date.now())}`;

      registerOrchestratorSpawn(spawnStatusId, { label: spawnLabel, agent });
      if (ctx.hasUI) {
        mountOrchestratorSpawnWidget(ctx);
        startOrchestratorSpawnHeartbeat(ctx);
        ctx.ui.setWorkingMessage(`${spawnLabel}: starting ${agent}…`);
        ctx.ui.setWorkingIndicator();
        void refreshOrchestratorSpawnUi(ctx);
      }

      const chatUi = startOrchestratorSubagentChatDisplay(pi, ctx, {
        label: spawnLabel,
        agent,
        task,
        onProgress: (progress) => {
          updateOrchestratorSpawn(spawnStatusId, progress);
        },
        onUiRefresh: () => {
          void refreshOrchestratorSpawnUi(ctx);
        },
      });

      let singleResult: OrchestrationSubagentSingleResult;
      const subagentDetails = {
        mode: "single" as const,
        agentScope: "user" as const,
        projectAgentsDir: null as string | null,
      };
      try {
        singleResult = await runOrchestrationSubagent(
          buildSingleSubagentRunRequest(prepared, ctx.cwd, {
            timeoutMs: SPAWN_TIMEOUT_DISABLED,
            signal: ctx.signal,
            onEvent: (event) => {
              if (event.type === "progress") {
                updateOrchestratorSpawn(spawnStatusId, event.progress);
              }
            },
            onUpdate: createOrchestrationSubagentOnUpdate(
              (results) => ({ ...subagentDetails, results }),
              (partial) => chatUi.onUpdate(partial as Parameters<typeof chatUi.onUpdate>[0]),
            ),
          }),
        );
      } catch (e) {
        if (e instanceof SubagentRunError) {
          singleResult = mapSpawnResultToSingle(e.result);
          const level = e.reason === "aborted" || e.reason === "timeout" ? "warning" : "error";
          ctx.ui.notify(`Subagent spawn failed: ${e.message}`, level);
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          ctx.ui.notify(`Subagent spawn failed: ${msg}`, "error");
          return { exitCode: 1 };
        }
      } finally {
        chatUi.dispose();
        unregisterOrchestratorSpawn(spawnStatusId);
        if (ctx.hasUI) {
          stopOrchestratorSpawnHeartbeat();
          clearOrchestratorSpawnWidget(ctx);
          ctx.ui.setWorkingMessage(undefined);
          ctx.ui.setWorkingIndicator();
          void refreshOrchestratorSpawnUi(ctx);
        }
      }

      const details = { ...subagentDetails, results: [singleResult] };

      const append = await processSubagentToolResult({
        details,
        state,
        pricing,
        host: {
          syncHarnessRunMeta: () => syncHarnessRunSessionEntry(pi, state),
          refreshUi: () => updateStatusBar(ctx, state),
        },
      });

      let commitAppend = "";
      if (agent === "review-code" && singleResult.exitCode === 0) {
        const workItemId = extractWorkItemId(task, { mustExist: true });
        const taskId = extractTaskIdFromTaskText(task);
        if (workItemId && taskId != null) {
          const commitResult = await tryCommitOnTaskDone(
            workItemId,
            taskId,
            state.devConfig,
            ctx.cwd,
            ctx.signal,
          );
          if (commitResult.ok && commitResult.hash) {
            commitAppend = `\n\n**Task commit:** \`${commitResult.hash}\` — ${commitResult.message ?? ""}`;
          } else if (commitResult.ok && commitResult.skipped && commitResult.reason) {
            commitAppend = `\n\n**Task commit:** skipped (${commitResult.reason}).`;
          } else if (!commitResult.ok && commitResult.reason) {
            commitAppend = `\n\n**Task commit failed:** ${commitResult.reason}`;
            ctx.ui.notify(`Task commit failed: ${commitResult.reason}`, "warning");
          }
        }
      }

      const exitLabel =
        singleResult.exitCode === 0 ? "ok" : `exit ${String(singleResult.exitCode)}`;
      let tail = append || commitAppend ? `\n\n${append}${commitAppend}` : "";
      if (tail.length > NOTIFY_APPEND_MAX) {
        tail = `${tail.slice(0, NOTIFY_APPEND_MAX)}\n…(truncated)`;
      }
      ctx.ui.notify(
        `${spawnLabel}: ${agent} (${exitLabel})${tail}`,
        singleResult.exitCode === 0 ? "info" : "warning",
      );

      return { exitCode: singleResult.exitCode, parsedReturn: singleResult.parsedReturn };
    },

    async runJudgment(request) {
      return runOrchestrationJudgment(ctx, state.devConfig, request);
    },
  };
}
