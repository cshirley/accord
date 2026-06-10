import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description:
    'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: "user",
});

const ResponseContractSchema = Type.Union([
  Type.Object({
    format: Type.Literal("instruction"),
    instruction: Type.String(),
  }),
  Type.Object({
    format: Type.Literal("markdown_section"),
    title: Type.String(),
    body: Type.String(),
  }),
  Type.Object({
    format: Type.Literal("json_schema_path"),
    schemaPath: Type.String(),
    examplesPath: Type.Optional(Type.String()),
    instruction: Type.Optional(Type.String()),
  }),
  Type.Object({
    format: Type.Literal("json_schema"),
    label: Type.Optional(Type.String()),
    schema: Type.Record(Type.String(), Type.Unknown()),
    examples: Type.Optional(Type.Unknown()),
    instruction: Type.Optional(Type.String()),
  }),
]);

export const SubagentParamsSchema = Type.Object({
  agentFile: Type.Optional(
    Type.String({
      description: "Absolute path to agent markdown definition (preferred over agent name)",
    }),
  ),
  agent: Type.Optional(
    Type.String({ description: "Name of the agent to invoke (for single mode)" }),
  ),
  task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
  model: Type.Optional(
    Type.String({
      description: "Override model (provider/model or bare id with profile provider)",
    }),
  ),
  thinking: Type.Optional(
    StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, {
      description: "Override thinking level when the provider supports --thinking",
    }),
  ),
  systemAppend: Type.Optional(
    Type.String({ description: "Markdown appended to the agent system prompt" }),
  ),
  response: Type.Optional(ResponseContractSchema),
  tasks: Type.Optional(
    Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description: "Prompt before running project-local agents. Default: true.",
      default: true,
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the agent process (single mode)" }),
  ),
  timeoutMs: Type.Optional(
    Type.Number({
      description:
        "Wall-clock limit in milliseconds. Omit to use spawnTimeoutMs from subagent.json (default 30 min). Pass 0 to disable.",
    }),
  ),
});

export type SubagentParams = Static<typeof SubagentParamsSchema>;

/** Typebox schema for the subagent tool (same shape as {@link SubagentParams}). */
export const SubagentParams = SubagentParamsSchema;
