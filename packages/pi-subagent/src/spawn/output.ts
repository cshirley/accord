import type { Message } from "@earendil-works/pi-ai";

export function getFinalOutput(messages: Message[]): string {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const msg = messages[messageIndex];
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}
