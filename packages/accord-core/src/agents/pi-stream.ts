/**
 * Minimal Pi JSON stream event handler for headless subprocess spawns.
 */

import { getFinalOutput, type PiMessage } from "./output.js";

export type PiStreamState = {
  messages: PiMessage[];
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
  streamingText: string;
};

export function createPiStreamState(): PiStreamState {
  return {
    messages: [],
    usage: {
      turns: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
    },
    streamingText: "",
  };
}

function upsertStreamingMessage(messages: PiMessage[], message: PiMessage): void {
  const last = messages.at(-1);
  if (last && last.role === message.role) {
    messages[messages.length - 1] = message;
  } else {
    messages.push(message);
  }
}

function asMessage(value: unknown): PiMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as PiMessage;
  if (typeof record.role !== "string" || !Array.isArray(record.content)) return null;
  return record;
}

export function handlePiJsonEvent(state: PiStreamState, event: Record<string, unknown>): void {
  const eventType = typeof event.type === "string" ? event.type : "";

  if (eventType === "message_start" || eventType === "message_update") {
    const message = asMessage(event.message);
    if (message) {
      upsertStreamingMessage(state.messages, message);
    }
    if (eventType === "message_update" && event.assistantMessageEvent) {
      const assistantEvent = event.assistantMessageEvent as Record<string, unknown>;
      if (assistantEvent.type === "text_delta" && typeof assistantEvent.delta === "string") {
        state.streamingText += assistantEvent.delta;
      }
    }
    return;
  }

  if (eventType === "message_end") {
    const message = asMessage(event.message);
    if (!message) return;
    upsertStreamingMessage(state.messages, message);
    if (message.role === "assistant") {
      state.usage.turns++;
      const usage = message.usage;
      if (usage) {
        state.usage.input += usage.input || 0;
        state.usage.output += usage.output || 0;
        state.usage.cacheRead += usage.cacheRead || 0;
        state.usage.cacheWrite += usage.cacheWrite || 0;
        state.usage.cost += usage.cost?.total || 0;
        state.usage.contextTokens = usage.totalTokens || 0;
      }
      if (!state.model && message.model) state.model = message.model;
      if (message.stopReason) state.stopReason = message.stopReason;
      if (message.errorMessage) state.errorMessage = message.errorMessage;
    }
    return;
  }

  if (eventType === "tool_result_end") {
    const message = asMessage(event.message);
    if (message) state.messages.push(message);
  }
}

export function resolvePiStreamOutput(state: PiStreamState): string {
  return getFinalOutput(state.messages, state.streamingText);
}
