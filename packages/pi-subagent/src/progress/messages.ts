import type { Message } from "@earendil-works/pi-ai";
import type { DisplayItem } from "./types.js";

/** Reflect a live tool_execution_* JSON event into messages for progress summaries. */
export function applyToolExecutionToMessages(
  messages: Message[],
  toolName: string,
  args: Record<string, unknown>,
  toolCallId?: string,
): void {
  const id = toolCallId ?? `harness-${toolName}-${String(messages.length)}`;
  const toolCallPart = {
    type: "toolCall" as const,
    id,
    name: toolName,
    arguments: args,
  };
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    const content = Array.isArray(last.content) ? [...last.content] : [];
    const existingIndex = content.findIndex((part) => part.type === "toolCall" && part.id === id);
    if (existingIndex >= 0) {
      content[existingIndex] = toolCallPart;
    } else {
      content.push(toolCallPart);
    }
    messages[messages.length - 1] = { ...last, content };
    return;
  }
  messages.push({
    role: "assistant",
    content: [toolCallPart],
    timestamp: Date.now(),
  } as Message);
}

/** Merge toolCall parts from a streamed assistant message into the progress message list. */
export function mergeToolCallsFromAssistantMessage(messages: Message[], msg: Message): void {
  if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
    return;
  }
  for (const part of msg.content) {
    if (part.type !== "toolCall") {
      continue;
    }
    applyToolExecutionToMessages(
      messages,
      part.name,
      part.arguments as Record<string, unknown>,
      part.id,
    );
  }
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") items.push({ type: "text", text: part.text });
        else if (part.type === "toolCall")
          items.push({ type: "toolCall", name: part.name, args: part.arguments });
      }
    }
  }
  return items;
}
