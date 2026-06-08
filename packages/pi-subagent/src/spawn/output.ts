import type { Message } from "@earendil-works/pi-ai";

/** Last non-empty assistant `text` block in message history. */
export function getFinalOutputFromMessages(messages: Message[]): string {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const msg = messages[messageIndex];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text" && part.text.trim()) return part.text;
      }
    }
  }
  return "";
}

/**
 * Resolve harvestable subagent text for ACCORD return packets.
 *
 * Cursor / thinking models sometimes stream `text_delta` events (captured in
 * `streamingTextFallback`) while the final `message_end` assistant row has an
 * empty `content` array (e.g. when `hideThinkingBlock` strips visible text).
 */
export function getFinalOutput(messages: Message[], streamingTextFallback?: string): string {
  const fromMessages = getFinalOutputFromMessages(messages);
  if (fromMessages) return fromMessages;
  const streamed = streamingTextFallback?.trim();
  return streamed ?? "";
}
