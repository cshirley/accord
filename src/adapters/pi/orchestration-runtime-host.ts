/**
 * Pi {@link OrchestrationRuntimeHost} — gather/verify preflight, spawn, harness result path.
 */

import type { AssistantMessage, TextContent, UserMessage } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { harnessSpawnSubagent } from "../../../packages/pi-subagent/src/index.js";
import {
  prepareSubagentToolCall,
  processSubagentToolResult,
  runGatherPreflightOnSubagentCall,
  runVerifyPreflightOnSubagentCall,
} from "../../core/harness/index.js";
import type {
  OrchestrationJudgmentRequest,
  OrchestrationRuntimeHost,
} from "../../core/orchestration/host.js";
import {
  isOrchestrationJudgmentConfigured,
  ORCHESTRATION_JUDGMENT_SCHEMA_VERSION,
} from "../../core/orchestration/judgment.js";
import { loadPricing } from "../../core/telemetry/usage.js";
import type { HookState } from "./hook-state.js";
import { syncHarnessRunSessionEntry } from "./hook-state.js";
import { updateStatusBar } from "./status-bar.js";

const NOTIFY_APPEND_MAX = 4000;

const JUDGMENT_SYSTEM_PROMPT = [
  "You help compose a brief supplement for a downstream coding agent (already chosen by the harness).",
  "Return ONE JSON object only — no markdown fences, no prose outside the JSON.",
  'Schema: {"schema_version":"1.0","brief_appendix":"string","focus_points":["optional strings"]}',
  "Rules:",
  `- schema_version must be exactly "${ORCHESTRATION_JUDGMENT_SCHEMA_VERSION}".`,
  "- brief_appendix: concise markdown or plain text for the next agent; max ~4000 characters.",
  "- focus_points: optional short strings; omit when empty.",
  "- Do NOT include agent names, subagent names, tool names, or routing instructions.",
  "- Do NOT add keys other than schema_version, brief_appendix, focus_points.",
].join("\n");

const JUDGMENT_TASK_MAX_CHARS = 12_000;

function truncateForJudgmentPrompt(body: string): string {
  if (body.length <= JUDGMENT_TASK_MAX_CHARS) return body;
  return `${body.slice(0, JUDGMENT_TASK_MAX_CHARS)}\n\n(truncated for judgment prompt)`;
}

function assistantTextBlocks(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

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
      const prep = prepareSubagentToolCall(input, state.devConfig);
      if (prep.blockReason) {
        ctx.ui.notify(prep.blockReason, "warning");
        return { exitCode: 1 };
      }

      const gather = await runGatherPreflightOnSubagentCall(
        input,
        state.devConfig,
        options.availableToolNames,
        {
          notify: (level, msg) => ctx.ui.notify(msg, level === "warning" ? "warning" : "info"),
          confirm: (title, body) => ctx.ui.confirm(title, body),
        },
      );
      if (gather.blockReason) {
        ctx.ui.notify(gather.blockReason, "warning");
        return { exitCode: 1 };
      }

      const verify = await runVerifyPreflightOnSubagentCall(input, state.devConfig);
      if (verify.blockReason) {
        ctx.ui.notify(verify.blockReason, "warning");
        return { exitCode: 1 };
      }

      const agent = typeof input.agent === "string" ? input.agent : "";
      const task = typeof input.task === "string" ? input.task : "";
      if (!agent || !task) {
        ctx.ui.notify("Internal error: subagent payload missing after preflight.", "error");
        return { exitCode: 1 };
      }

      let singleResult: Awaited<ReturnType<typeof harnessSpawnSubagent>>;
      try {
        singleResult = await harnessSpawnSubagent({
          cwd: ctx.cwd,
          agent,
          task,
          signal: ctx.signal,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Subagent spawn failed: ${msg}`, "error");
        return { exitCode: 1 };
      }

      const details = {
        mode: "single" as const,
        agentScope: "user" as const,
        projectAgentsDir: null as string | null,
        results: [singleResult],
      };

      const append = await processSubagentToolResult({
        details,
        state,
        pricing,
        host: {
          syncHarnessRunMeta: () => syncHarnessRunSessionEntry(pi, state),
          refreshUi: () => updateStatusBar(ctx, state),
        },
      });

      const exitLabel =
        singleResult.exitCode === 0 ? "ok" : `exit ${String(singleResult.exitCode)}`;
      let tail = append ? `\n\n${append}` : "";
      if (tail.length > NOTIFY_APPEND_MAX) {
        tail = `${tail.slice(0, NOTIFY_APPEND_MAX)}\n…(truncated)`;
      }
      ctx.ui.notify(
        `${spawnLabel}: ${agent} (${exitLabel})${tail}`,
        singleResult.exitCode === 0 ? "info" : "warning",
      );

      return { exitCode: singleResult.exitCode };
    },

    async runJudgment(request: OrchestrationJudgmentRequest): Promise<string | undefined> {
      if (process.env.ACCORD_ORCHESTRATION_JUDGMENT !== "1") {
        return undefined;
      }
      if (!isOrchestrationJudgmentConfigured(state.devConfig, request.dispatchAgent)) {
        return undefined;
      }

      const model = ctx.model;
      if (!model) {
        ctx.ui.notify(
          "Orchestration judgment skipped: no active model in this session (set a model, or rely on template fallback).",
          "warning",
        );
        return undefined;
      }

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        ctx.ui.notify(`Orchestration judgment skipped: ${auth.error}`, "warning");
        return undefined;
      }

      const maxTokens = state.devConfig?.orchestration?.judgment?.max_tokens ?? 1536;
      const userBody = [
        "Harness dispatch context (do not change which agent runs — only propose supplement text):",
        `work_item_id: ${request.workItemId}`,
        `dispatch_agent: ${request.dispatchAgent}`,
        "",
        "Task preamble:",
        truncateForJudgmentPrompt(request.baseTask),
      ].join("\n");

      const now = Date.now();
      const messages: UserMessage[] = [{ role: "user", content: userBody, timestamp: now }];

      try {
        const assistant = await completeSimple(
          model,
          { systemPrompt: JUDGMENT_SYSTEM_PROMPT, messages },
          {
            maxTokens,
            temperature: 0.1,
            signal: ctx.signal,
            ...(auth.apiKey ? { apiKey: auth.apiKey } : {}),
            ...(auth.headers ? { headers: auth.headers } : {}),
          },
        );
        if (assistant.stopReason !== "stop" && assistant.stopReason !== "length") {
          ctx.ui.notify(
            `Orchestration judgment: model stopReason=${assistant.stopReason}${
              assistant.errorMessage ? ` (${assistant.errorMessage})` : ""
            } — using template fallback.`,
            "warning",
          );
          return undefined;
        }
        const text = assistantTextBlocks(assistant);
        return text || undefined;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Orchestration judgment failed: ${msg}`, "warning");
        return undefined;
      }
    },
  };
}
