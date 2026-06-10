/**
 * Types for programmatic subagent spawns (host-neutral).
 */

import type { Message } from "@earendil-works/pi-ai";
import type { ReasoningEffort, ThinkingLevel } from "../agents.js";
import type { SubagentLiveActivity, SubagentProgress } from "../progress/index.js";

export interface SubagentUsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

/** Expected shape of the subagent's final assistant output. */
export type SubagentResponseContract =
  | {
      format: "instruction";
      instruction: string;
    }
  | {
      format: "markdown_section";
      title: string;
      body: string;
    }
  | {
      format: "json_schema_path";
      schemaPath: string;
      examplesPath?: string;
      instruction?: string;
    }
  | {
      format: "json_schema";
      label?: string;
      schema: Record<string, unknown>;
      examples?: unknown;
      instruction?: string;
    };

/** Low-level spawn parameters (also used by the Pi `subagent` tool wrapper). */
export interface SpawnSubagentParams {
  cwd: string;
  task: string;
  agentFile?: string;
  agent?: string;
  agentScope?: "user" | "project" | "both";
  model?: string;
  thinking?: ThinkingLevel;
  reasoningEffort?: ReasoningEffort;
  tools?: string[];
  systemAppend?: string;
  response?: SubagentResponseContract;
  step?: number;
  signal?: AbortSignal;
  /** Pi tool streaming adapter — prefer {@link RunSubagentRequest.onEvent} for hosts. */
  onUpdate?: (partial: SpawnSubagentUpdate) => void;
  onEvent?: (event: SubagentRunEvent) => void;
}

/**
 * Programmatic API request. Await {@link runSubagent} from ACCORD (or any host);
 * optional {@link RunSubagentRequest.timeoutMs} and structured events via `onEvent`.
 */
export type RunSubagentRequest = SpawnSubagentParams & {
  /** Wall-clock limit; aborts the child process when exceeded. */
  timeoutMs?: number;
};

export interface SpawnSubagentResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  agentFile?: string;
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: SubagentUsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
  liveActivity?: SubagentLiveActivity;
  output: string;
  parsedReturn?: unknown;
  /** Set when {@link RunSubagentRequest.timeoutMs} elapsed before the child exited. */
  timedOut?: boolean;
  /** Set when the combined abort signal fired (caller signal or timeout). */
  aborted?: boolean;
}

export type SpawnSubagentUpdate = {
  result: SpawnSubagentResult;
};

/** Structured status/progress events for programmatic callers. */
export type SubagentRunEvent =
  | { type: "resolving" }
  | {
      type: "resolved";
      agent: string;
      agentFile?: string;
      model?: string;
    }
  | { type: "process_started" }
  | { type: "status"; message: string }
  | { type: "turn_start"; turn: number }
  | {
      type: "tool_start";
      toolName: string;
      args: Record<string, unknown>;
      toolCallId?: string;
    }
  | {
      type: "tool_update";
      toolName: string;
      partialResult?: unknown;
    }
  | {
      type: "tool_end";
      toolName: string;
      args: Record<string, unknown>;
      isError: boolean;
      toolCallId?: string;
    }
  | { type: "text_delta"; preview: string }
  | {
      type: "progress";
      result: SpawnSubagentResult;
      progress: SubagentProgress;
    }
  | { type: "completed"; result: SpawnSubagentResult }
  | {
      type: "failed";
      result: SpawnSubagentResult;
      reason: "agent_resolution" | "process_error" | "exit_nonzero" | "aborted" | "timeout";
      message?: string;
    };

export class SubagentRunError extends Error {
  readonly result: SpawnSubagentResult;
  readonly reason: Extract<SubagentRunEvent, { type: "failed" }>["reason"];

  constructor(
    message: string,
    result: SpawnSubagentResult,
    reason: Extract<SubagentRunEvent, { type: "failed" }>["reason"],
  ) {
    super(message);
    this.name = "SubagentRunError";
    this.result = result;
    this.reason = reason;
  }
}
