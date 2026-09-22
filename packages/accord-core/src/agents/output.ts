/**
 * Resolve final assistant text from Pi JSON stream messages.
 */

export type PiMessage = {
  role: string;
  content: Array<{ type: string; text?: string }>;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
    totalTokens?: number;
  };
  stopReason?: string;
  errorMessage?: string;
};

function hasJsonReturnFence(text: string): boolean {
  return /```json[\s\S]*?```/i.test(text);
}

/** Last non-empty assistant `text` block (models may emit preamble then return JSON in a later block). */
export function getFinalOutputFromMessages(messages: PiMessage[]): string {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;
    let lastText = "";
    for (const part of message.content) {
      if (part.type === "text" && part.text?.trim()) {
        lastText = part.text;
      }
    }
    if (lastText) return lastText;
  }
  return "";
}

export function getFinalOutput(messages: PiMessage[], streamingTextFallback?: string): string {
  const fromMessages = getFinalOutputFromMessages(messages);
  const streamed = streamingTextFallback?.trim() ?? "";
  if (!fromMessages) return streamed;
  if (!streamed) return fromMessages;
  if (hasJsonReturnFence(streamed) && !hasJsonReturnFence(fromMessages)) return streamed;
  if (hasJsonReturnFence(fromMessages)) return fromMessages;
  return streamed.length > fromMessages.length ? streamed : fromMessages;
}
