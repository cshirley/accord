/**
 * Parse Pi JSON stream events from harness-spawned subagent processes.
 */

import type { Message } from "@earendil-works/pi-ai";
import {
  applyToolExecutionToMessages,
  mergeToolCallsFromAssistantMessage,
  type SubagentActivityBuffer,
} from "../progress/index.js";
import type { SubagentRunEvent } from "../spawn/types.js";

export type SubagentRunState = {
  messages: Message[];
  usage: {
    turns: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    contextTokens: number;
  };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
};

export type SubagentEventContext = {
  currentResult: SubagentRunState;
  activity: SubagentActivityBuffer;
  emitUpdate: () => void;
  onEvent?: (event: SubagentRunEvent) => void;
};

function upsertStreamingMessage(messages: Message[], msg: Message): void {
  const last = messages.at(-1);
  if (last && last.role === msg.role) {
    messages[messages.length - 1] = msg;
  } else {
    messages.push(msg);
  }
  mergeToolCallsFromAssistantMessage(messages, msg);
}

export function handleSubagentJsonEvent(
  ev: Record<string, unknown>,
  ctx: SubagentEventContext,
): void {
  const { currentResult, activity, emitUpdate, onEvent } = ctx;
  const eventType = typeof ev.type === "string" ? ev.type : "";

  if (eventType === "session") return;

  if (eventType === "agent_start") {
    activity.pushStatus("agent running");
    onEvent?.({ type: "status", message: "agent running" });
    emitUpdate();
    return;
  }

  if (eventType === "turn_start") {
    const turn = currentResult.usage.turns + 1;
    activity.onTurnStart(turn);
    onEvent?.({ type: "turn_start", turn });
    emitUpdate();
    return;
  }

  if (eventType === "turn_end" && ev.message) {
    const msg = ev.message as Message;
    mergeToolCallsFromAssistantMessage(currentResult.messages, msg);
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type !== "toolCall") {
          continue;
        }
        activity.onToolStart(part.name, part.arguments as Record<string, unknown>);
      }
    }
    emitUpdate();
    return;
  }

  if ((eventType === "message_start" || eventType === "message_update") && ev.message) {
    const msg = ev.message as Message;
    upsertStreamingMessage(currentResult.messages, msg);
    if (eventType === "message_update" && ev.assistantMessageEvent) {
      activity.applyAssistantMessageEvent(
        ev.assistantMessageEvent as Record<string, unknown>,
        currentResult.messages,
      );
    }
    emitUpdate();
    return;
  }

  if (eventType === "message_end" && ev.message) {
    const msg = ev.message as Message;
    upsertStreamingMessage(currentResult.messages, msg);
    if (msg.role === "assistant") {
      currentResult.usage.turns++;
      const usage = msg.usage;
      if (usage) {
        currentResult.usage.input += usage.input || 0;
        currentResult.usage.output += usage.output || 0;
        currentResult.usage.cacheRead += usage.cacheRead || 0;
        currentResult.usage.cacheWrite += usage.cacheWrite || 0;
        currentResult.usage.cost += usage.cost?.total || 0;
        currentResult.usage.contextTokens = usage.totalTokens || 0;
      }
      if (!currentResult.model && msg.model) currentResult.model = msg.model;
      if (msg.stopReason) currentResult.stopReason = msg.stopReason;
      if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
    }
    emitUpdate();
    return;
  }

  if (eventType === "tool_execution_start") {
    const toolName = typeof ev.toolName === "string" ? ev.toolName : "tool";
    const toolArgs =
      ev.args && typeof ev.args === "object" ? (ev.args as Record<string, unknown>) : {};
    const toolCallId = typeof ev.toolCallId === "string" ? ev.toolCallId : undefined;
    activity.onToolStart(toolName, toolArgs);
    onEvent?.({ type: "tool_start", toolName, args: toolArgs, toolCallId });
    applyToolExecutionToMessages(currentResult.messages, toolName, toolArgs, toolCallId);
    emitUpdate();
    return;
  }

  if (eventType === "tool_execution_update") {
    const toolName = typeof ev.toolName === "string" ? ev.toolName : "tool";
    const toolArgs =
      ev.args && typeof ev.args === "object" ? (ev.args as Record<string, unknown>) : {};
    activity.onToolUpdate(toolName, ev.partialResult);
    onEvent?.({ type: "tool_update", toolName, partialResult: ev.partialResult });
    applyToolExecutionToMessages(
      currentResult.messages,
      toolName,
      toolArgs,
      typeof ev.toolCallId === "string" ? ev.toolCallId : undefined,
    );
    emitUpdate();
    return;
  }

  if (eventType === "tool_execution_end") {
    const toolName = typeof ev.toolName === "string" ? ev.toolName : "tool";
    const toolArgs =
      ev.args && typeof ev.args === "object" ? (ev.args as Record<string, unknown>) : {};
    const toolCallId = typeof ev.toolCallId === "string" ? ev.toolCallId : undefined;
    const isError = ev.isError === true;
    activity.onToolEnd(toolName, toolArgs, isError);
    onEvent?.({ type: "tool_end", toolName, args: toolArgs, isError, toolCallId });
    applyToolExecutionToMessages(currentResult.messages, toolName, toolArgs, toolCallId);
    emitUpdate();
    return;
  }

  if (eventType === "tool_result_end" && ev.message) {
    currentResult.messages.push(ev.message as Message);
    emitUpdate();
    return;
  }

  if (eventType === "auto_retry_start") {
    const attempt = typeof ev.attempt === "number" ? ev.attempt : 1;
    const maxAttempts = typeof ev.maxAttempts === "number" ? ev.maxAttempts : 1;
    const message = `retry ${String(attempt)}/${String(maxAttempts)}`;
    activity.pushStatus(message);
    onEvent?.({ type: "status", message });
    emitUpdate();
    return;
  }

  if (eventType === "compaction_start") {
    activity.pushStatus("compacting context…");
    onEvent?.({ type: "status", message: "compacting context…" });
    emitUpdate();
  }
}
