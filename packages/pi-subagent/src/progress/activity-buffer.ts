import type { Message } from "@earendil-works/pi-ai";
import { applyToolExecutionToMessages } from "./messages.js";
import {
  MAX_STATUS_ACTIVITY_LINES,
  MAX_TOOL_ACTIVITY_LINES,
  TEXT_DELTA_PULSE_MS,
  TEXT_PREVIEW_MAX,
  THINKING_DELTA_PULSE_MS,
  type SubagentLiveActivity,
} from "./types.js";
import { extractToolOutputPreview, formatToolCall } from "./tool-format.js";

/** Rolling activity log while the child `pi` process streams JSON. */
export class SubagentActivityBuffer {
  private statusLines: string[] = [];
  private toolLines: string[] = [];
  private activeToolLine: string | undefined;
  private activeToolOutput: string | undefined;
  private streamingText = "";
  private lastTextPulseAt = 0;
  private lastThinkingPulseAt = 0;

  pushStatus(line: string): void {
    this.pushUnique(line, "status");
  }

  onTurnStart(turnNumber: number): void {
    this.pushUnique(`turn ${String(turnNumber)} started`, "status");
  }

  onTextDelta(delta: string): void {
    if (!delta) return;
    this.streamingText += delta;
    if (this.streamingText.length > TEXT_PREVIEW_MAX * 2) {
      this.streamingText = this.streamingText.slice(-TEXT_PREVIEW_MAX * 2);
    }
    const now = Date.now();
    if (now - this.lastTextPulseAt < TEXT_DELTA_PULSE_MS) {
      return;
    }
    this.lastTextPulseAt = now;
    const preview = this.streamingText.trim();
    if (!preview) {
      return;
    }
    const tail = preview.length > 48 ? `…${preview.slice(-48)}` : preview;
    this.pushUnique(`composing… ${tail}`, "status");
  }

  onToolStart(toolName: string, args: Record<string, unknown>): void {
    const line = formatToolCall(toolName, args);
    this.activeToolLine = line;
    this.activeToolOutput = undefined;
    this.pushUnique(line, "tool");
  }

  onToolUpdate(toolName: string, partialResult: unknown): void {
    const preview = extractToolOutputPreview(partialResult);
    if (!preview) {
      return;
    }
    this.activeToolOutput = preview;
    const prefix = this.activeToolLine ?? formatToolCall(toolName, {});
    this.pushUnique(`${prefix} … ${preview}`, "tool");
  }

  onToolEnd(toolName: string, args: Record<string, unknown>, isError: boolean): void {
    const line = formatToolCall(toolName, args);
    this.pushUnique(isError ? `${line} (failed)` : `${line} (done)`, "tool");
    this.activeToolLine = undefined;
    this.activeToolOutput = undefined;
  }

  /**
   * Pi JSON `message_update` assistantMessageEvent (toolcall_*, thinking_*, text_*).
   * Tool calls often appear here before or instead of separate top-level tool_execution_* lines.
   */
  applyAssistantMessageEvent(
    event: Record<string, unknown>,
    messages: Message[],
  ): void {
    const eventKind = typeof event.type === "string" ? event.type : "";
    if (eventKind === "text_delta" && typeof event.delta === "string") {
      this.onTextDelta(event.delta);
      return;
    }
    if (eventKind === "thinking_start") {
      this.pushStatus("thinking…");
      return;
    }
    if (eventKind === "thinking_delta" && typeof event.delta === "string") {
      const now = Date.now();
      if (now - this.lastThinkingPulseAt < THINKING_DELTA_PULSE_MS) {
        return;
      }
      this.lastThinkingPulseAt = now;
      const preview =
        event.delta.length > 60 ? `…${event.delta.slice(-60)}` : event.delta;
      this.pushUnique(`thinking ${preview}`, "status");
      return;
    }

    const toolCall = event.toolCall;
    if (!toolCall || typeof toolCall !== "object") {
      return;
    }
    const tc = toolCall as Record<string, unknown>;
    const toolName = typeof tc.name === "string" ? tc.name : "tool";
    const toolArgs =
      tc.arguments && typeof tc.arguments === "object"
        ? (tc.arguments as Record<string, unknown>)
        : {};
    const toolId = typeof tc.id === "string" ? tc.id : undefined;

    if (eventKind === "toolcall_start") {
      this.onToolStart(toolName, toolArgs);
      applyToolExecutionToMessages(messages, toolName, toolArgs, toolId);
      return;
    }
    if (eventKind === "toolcall_end") {
      applyToolExecutionToMessages(messages, toolName, toolArgs, toolId);
      this.onToolEnd(toolName, toolArgs, false);
    }
  }

  snapshot(): SubagentLiveActivity {
    const streamingText = this.streamingText.trim();
    return {
      lines: [...this.statusLines, ...this.toolLines],
      activeToolLine: this.activeToolLine,
      activeToolOutput: this.activeToolOutput,
      streamingText: streamingText.length > 0 ? streamingText : undefined,
    };
  }

  private pushUnique(line: string, kind: "status" | "tool"): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const bucket = kind === "tool" ? this.toolLines : this.statusLines;
    const max = kind === "tool" ? MAX_TOOL_ACTIVITY_LINES : MAX_STATUS_ACTIVITY_LINES;
    if (bucket.at(-1) === trimmed) {
      return;
    }
    bucket.push(trimmed);
    if (bucket.length > max) {
      bucket.shift();
    }
  }
}
