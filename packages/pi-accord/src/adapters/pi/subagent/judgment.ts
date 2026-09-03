/**
 * Optional LLM judgment hook for orchestration resume spawns (Pi session model).
 */

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import type { OrchestrationJudgmentRequest } from "@clive.shirley/accord-core/orchestration/host.js";
import {
  isOrchestrationJudgmentConfigured,
  ORCHESTRATION_JUDGMENT_SCHEMA_VERSION,
} from "@clive.shirley/accord-core/orchestration/judgment.js";
import type { AssistantMessage, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { resolveJudgmentModel } from "./resolve-judgment-model.js";

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

export async function runOrchestrationJudgment(
  ctx: ExtensionCommandContext,
  devConfig: DevHarnessConfig | null,
  request: OrchestrationJudgmentRequest,
): Promise<string | undefined> {
  if (process.env.ACCORD_ORCHESTRATION_JUDGMENT !== "1") {
    return undefined;
  }
  if (!isOrchestrationJudgmentConfigured(devConfig, request.dispatchAgent)) {
    return undefined;
  }

  const resolved = await resolveJudgmentModel(ctx, devConfig);
  if (!resolved) {
    ctx.ui.notify(
      "Orchestration judgment skipped: no model with valid credentials (set orchestration.judgment.model, subagent.json lightweight tier, or scoped models).",
      "warning",
    );
    return undefined;
  }

  if (resolved.piggybackWarning) {
    ctx.ui.notify(resolved.piggybackWarning, "warning");
  }

  const model = resolved.model;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    ctx.ui.notify(`Orchestration judgment skipped: ${auth.error}`, "warning");
    return undefined;
  }

  const maxTokens = devConfig?.orchestration?.judgment?.max_tokens ?? 1536;
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
}
