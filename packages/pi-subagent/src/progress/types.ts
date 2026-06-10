/**
 * Progress display types for subagent runs.
 */

export type DisplayItem =
  | { type: "text"; text: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown> };

export type SubagentLiveActivity = {
  lines: string[];
  activeToolLine?: string;
  activeToolOutput?: string;
  streamingText?: string;
};

export type SubagentProgress = {
  agent: string;
  turns: number;
  lastToolLine?: string;
  recentToolLines: string[];
  activityLines: string[];
  activeToolOutput?: string;
  textPreview?: string;
};

export const MAX_STATUS_ACTIVITY_LINES = 4;
export const MAX_TOOL_ACTIVITY_LINES = 8;
export const TOOL_OUTPUT_PREVIEW_MAX = 100;
export const TEXT_DELTA_PULSE_MS = 2500;
export const THINKING_DELTA_PULSE_MS = 2000;
export const MAX_RECENT_TOOLS = 8;
export const TEXT_PREVIEW_MAX = 120;
