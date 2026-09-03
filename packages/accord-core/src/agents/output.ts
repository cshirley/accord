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

export function getFinalOutputFromMessages(messages: PiMessage[]): string {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "text" && part.text?.trim()) return part.text;
      }
    }
  }
  return "";
}

export function getFinalOutput(messages: PiMessage[], streamingTextFallback?: string): string {
  const fromMessages = getFinalOutputFromMessages(messages);
  if (fromMessages) return fromMessages;
  const streamed = streamingTextFallback?.trim();
  return streamed ?? "";
}
