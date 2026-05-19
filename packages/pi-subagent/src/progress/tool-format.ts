import * as os from "node:os";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { TOOL_OUTPUT_PREVIEW_MAX } from "./types.js";

type ThemeFg = (color: ThemeColor, text: string) => string;

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

/** Extract a short tail from tool_execution_* partialResult / result payloads. */
export function extractToolOutputPreview(partialResult: unknown): string | undefined {
  if (!partialResult || typeof partialResult !== "object") {
    return undefined;
  }
  const content = (partialResult as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const chunks: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: string }).text === "string"
    ) {
      chunks.push((block as { text: string }).text);
    }
  }
  const joined = chunks.join("").trim();
  if (!joined) {
    return undefined;
  }
  const tail = joined.split("\n").slice(-2).join(" ").trim();
  if (tail.length <= TOOL_OUTPUT_PREVIEW_MAX) {
    return tail;
  }
  return `…${tail.slice(-TOOL_OUTPUT_PREVIEW_MAX)}`;
}
