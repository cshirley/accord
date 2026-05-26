import type { Message } from "@earendil-works/pi-ai";
import { getDisplayItems } from "./messages.js";
import { formatToolCall } from "./tool-format.js";
import {
  MAX_RECENT_TOOLS,
  MAX_STATUS_ACTIVITY_LINES,
  MAX_TOOL_ACTIVITY_LINES,
  type SubagentLiveActivity,
  type SubagentProgress,
  TEXT_PREVIEW_MAX,
} from "./types.js";

function latestAssistantText(messages: Message[]): string | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const msg = messages[messageIndex];
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (part.type === "text" && part.text.trim()) return part.text.trim();
    }
  }
  return undefined;
}

/** Merge status lines from the activity buffer with tool lines parsed from messages. */
export function mergeActivityWithToolLines(activityLines: string[], toolLines: string[]): string[] {
  const merged = [...activityLines];
  for (const toolLine of toolLines) {
    if (!merged.includes(toolLine)) {
      merged.push(toolLine);
    }
  }
  return merged.slice(-(MAX_STATUS_ACTIVITY_LINES + MAX_TOOL_ACTIVITY_LINES));
}

export function summarizeSubagentProgress(
  agent: string,
  result: {
    messages: Message[];
    usage: { turns: number };
    liveActivity?: SubagentLiveActivity;
  },
): SubagentProgress {
  const displayItems = getDisplayItems(result.messages);
  const toolLines: string[] = [];
  for (const item of displayItems) {
    if (item.type === "toolCall") {
      toolLines.push(formatToolCall(item.name, item.args));
    }
  }
  const recentToolLines = toolLines.slice(-MAX_RECENT_TOOLS);
  const live = result.liveActivity;
  const activityLines = mergeActivityWithToolLines(live?.lines ?? [], recentToolLines);
  const rawText = live?.streamingText ?? latestAssistantText(result.messages);
  const textPreview =
    rawText && rawText.length > TEXT_PREVIEW_MAX
      ? `${rawText.slice(0, TEXT_PREVIEW_MAX)}…`
      : rawText;

  return {
    agent,
    turns: result.usage.turns,
    lastToolLine: activityLines.at(-1) ?? recentToolLines.at(-1),
    recentToolLines,
    activityLines,
    activeToolOutput: live?.activeToolOutput,
    textPreview,
  };
}
