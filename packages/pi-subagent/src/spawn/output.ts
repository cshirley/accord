import type { Message } from "@earendil-works/pi-ai";

function hasJsonReturnFence(text: string): boolean {
  return /```json[\s\S]*?```/i.test(text);
}

/** Last non-empty assistant `text` block in message history (may follow an earlier preamble block). */
export function getFinalOutputFromMessages(messages: Message[]): string {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const msg = messages[messageIndex];
    if (msg.role !== "assistant") continue;
    let lastText = "";
    for (const part of msg.content) {
      if (part.type === "text" && part.text.trim()) {
        lastText = part.text;
      }
    }
    if (lastText) return lastText;
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
  const streamed = streamingTextFallback?.trim() ?? "";
  if (!fromMessages) return streamed;
  if (!streamed) return fromMessages;
  if (hasJsonReturnFence(streamed) && !hasJsonReturnFence(fromMessages)) return streamed;
  if (hasJsonReturnFence(fromMessages)) return fromMessages;
  return streamed.length > fromMessages.length ? streamed : fromMessages;
}

type HarvestableSubagentResult = {
  messages: Message[];
  output?: string;
  liveActivity?: { streamingText?: string };
};

/** Resolve display/harvest text from a subagent run (messages, stream buffer, spawn output). */
export function resolveSubagentResultText(result: HarvestableSubagentResult): string {
  const fromMessages = getFinalOutputFromMessages(result.messages);
  if (fromMessages) return fromMessages;
  const resolvedOutput = result.output?.trim();
  if (resolvedOutput) return resolvedOutput;
  return getFinalOutput(result.messages, result.liveActivity?.streamingText);
}

/**
 * Chain `{previous}` substitution — never use spawn `output` (may reflect UI preview timing);
 * prefer final assistant messages, then the full harvest stream buffer.
 */
export function resolveSubagentChainPreviousOutput(result: HarvestableSubagentResult): string {
  const fromMessages = getFinalOutputFromMessages(result.messages);
  if (fromMessages) return fromMessages;
  return getFinalOutput(result.messages, result.liveActivity?.streamingText);
}

const SUMMARY_PREVIEW_MAX = 100;

function truncateSummaryPreview(text: string): string {
  return text.slice(0, SUMMARY_PREVIEW_MAX) + (text.length > SUMMARY_PREVIEW_MAX ? "..." : "");
}

function genericFailedPreview(result: SubagentSummarySource): string {
  if (result.stopReason === "aborted") return "(aborted)";
  if (result.stopReason === "error") return "(error)";
  if ((result.exitCode ?? 0) !== 0) return "(failed)";
  return "(no output)";
}

export type SubagentSummarySource = HarvestableSubagentResult & {
  exitCode?: number;
  stopReason?: string;
  errorMessage?: string;
  stderr?: string;
};

function isFailedSubagentRun(result: SubagentSummarySource): boolean {
  return (
    (result.exitCode ?? 0) !== 0 ||
    result.stopReason === "error" ||
    result.stopReason === "aborted"
  );
}

/** Whether collapsed TUI lines should use `toolOutput` styling (non-empty harvest). */
export function hasHarvestedSubagentText(result: HarvestableSubagentResult): boolean {
  return Boolean(resolveSubagentResultText(result));
}

/** One-line parallel summary body: harvest text, or generic failure hint (no raw stderr). */
export function resolveSubagentSummaryPreview(result: SubagentSummarySource): string {
  const harvested = resolveSubagentResultText(result);
  if (harvested) {
    return truncateSummaryPreview(harvested);
  }
  if (isFailedSubagentRun(result)) {
    return genericFailedPreview(result);
  }
  return "(no output)";
}
