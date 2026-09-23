/**
 * Host-neutral subagent spawn contracts (mirrors pi-subagent public types).
 */

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

export interface SubagentSpawnProgressEvent {
  type?: string;
  progress?: {
    lastToolLine?: string;
    [key: string]: unknown;
  };
}

export interface SpawnSubagentParams {
  cwd: string;
  task: string;
  agentFile?: string;
  agent?: string;
  agentScope?: "user" | "project" | "both";
  model?: string;
  systemAppend?: string;
  response?: SubagentResponseContract;
  confirmProjectAgents?: boolean;
  signal?: AbortSignal;
  onUpdate?: (...args: never[]) => void;
  onEvent?: (event: SubagentSpawnProgressEvent) => void;
}

export type RunSubagentRequest = SpawnSubagentParams & {
  timeoutMs?: number;
};
