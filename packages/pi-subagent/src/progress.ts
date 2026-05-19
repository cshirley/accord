/**
 * Subagent progress summaries for harness-driven spawns (orchestrator UI).
 */

import * as os from "node:os";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

export type HarnessSubagentProgress = {
  agent: string;
  turns: number;
  lastToolLine?: string;
  recentToolLines: string[];
  textPreview?: string;
};

type ThemeFg = (color: ThemeColor, text: string) => string;

const MAX_RECENT_TOOLS = 8;
const TEXT_PREVIEW_MAX = 120;

function shortenPath(filePath: string): string {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

export function formatToolCall(
  toolName: string,
  args: Record<string, unknown>,
  themeFg?: ThemeFg,
): string {
  const fg = (color: ThemeColor, text: string) => (themeFg ? themeFg(color, text) : text);

  switch (toolName) {
    case "bash": {
      const command = (args.command as string) || "...";
      const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return fg("muted", "$ ") + fg("toolOutput", preview);
    }
    case "read": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      let text = fg("accent", filePath);
      if (offset !== undefined || limit !== undefined) {
        const startLine = offset ?? 1;
        const endLine = limit !== undefined ? startLine + limit - 1 : "";
        text += fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
      }
      return fg("muted", "read ") + text;
    }
    case "write": {
      const rawPath = (args.file_path || args.path || "...") as string;
      const filePath = shortenPath(rawPath);
      const content = (args.content || "") as string;
      const lines = content.split("\n").length;
      let text = fg("muted", "write ") + fg("accent", filePath);
      if (lines > 1) text += fg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": {
      const rawPath = (args.file_path || args.path || "...") as string;
      return fg("muted", "edit ") + fg("accent", shortenPath(rawPath));
    }
    case "ls": {
      const rawPath = (args.path || ".") as string;
      return fg("muted", "ls ") + fg("accent", shortenPath(rawPath));
    }
    case "find": {
      const pattern = (args.pattern || "*") as string;
      const rawPath = (args.path || ".") as string;
      return (
        fg("muted", "find ") + fg("accent", pattern) + fg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    case "grep": {
      const pattern = (args.pattern || "") as string;
      const rawPath = (args.path || ".") as string;
      return (
        fg("muted", "grep ") +
        fg("accent", `/${pattern}/`) +
        fg("dim", ` in ${shortenPath(rawPath)}`)
      );
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return fg("accent", toolName) + fg("dim", ` ${preview}`);
    }
  }
}

/** Reflect a live tool_execution_* JSON event into messages for progress summaries. */
export function applyToolExecutionToMessages(
  messages: Message[],
  toolName: string,
  args: Record<string, unknown>,
  toolCallId?: string,
): void {
  const toolCallPart = {
    type: "toolCall" as const,
    id: toolCallId ?? `harness-${toolName}-${String(messages.length)}`,
    name: toolName,
    arguments: args,
  };
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    const content = Array.isArray(last.content) ? [...last.content] : [];
    const existingIndex = content.findIndex((part) => part.type === "toolCall");
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

export function summarizeHarnessSubagentProgress(
  agent: string,
  result: { messages: Message[]; usage: { turns: number } },
): HarnessSubagentProgress {
  const displayItems = getDisplayItems(result.messages);
  const toolLines: string[] = [];
  for (const item of displayItems) {
    if (item.type === "toolCall") {
      toolLines.push(formatToolCall(item.name, item.args));
    }
  }
  const recentToolLines = toolLines.slice(-MAX_RECENT_TOOLS);
  const rawText = latestAssistantText(result.messages);
  const textPreview =
    rawText && rawText.length > TEXT_PREVIEW_MAX
      ? `${rawText.slice(0, TEXT_PREVIEW_MAX)}…`
      : rawText;

  return {
    agent,
    turns: result.usage.turns,
    lastToolLine: recentToolLines.at(-1),
    recentToolLines,
    textPreview,
  };
}

type SubagentDetailsLike = {
  results: Array<{ messages: Message[]; usage: { turns: number } }>;
};

export type HarnessSubagentOnUpdate = (partial: AgentToolResult<SubagentDetailsLike>) => void;

export function createHarnessSubagentOnUpdate(
  agent: string,
  onProgress: (progress: HarnessSubagentProgress) => void,
): HarnessSubagentOnUpdate {
  return (partial) => {
    const current = partial.details?.results[0];
    if (!current) return;
    onProgress(summarizeHarnessSubagentProgress(agent, current));
  };
}

/** Lines for `ctx.ui.setWidget` during harness-orchestrated spawns. */
export function formatOrchestratorProgressWidgetLines(
  label: string,
  agent: string,
  progress: HarnessSubagentProgress,
): string[] {
  const lines = [`${label}: ${agent} · turn ${String(progress.turns)}`];
  if (progress.lastToolLine) {
    lines.push(`→ ${progress.lastToolLine}`);
  } else if (progress.textPreview) {
    lines.push(progress.textPreview);
  } else {
    lines.push("(running…)");
  }
  const extra = progress.recentToolLines.slice(0, -1);
  for (const toolLine of extra.slice(-3)) {
    lines.push(`  ${toolLine}`);
  }
  return lines;
}
