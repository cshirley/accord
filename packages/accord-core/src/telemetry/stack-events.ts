import { createLogger, type Logger } from "../logging.js";

export type StackEventLevel = "debug" | "info" | "warn" | "error";

export interface StackEventSpec {
  name: string;
  level: StackEventLevel;
  fields: readonly string[];
  numericFields?: readonly string[];
}

export const STACK_EVENTS: readonly StackEventSpec[] = [
  {
    name: "stack.commit.created",
    level: "info",
    fields: ["work_item_id", "ref", "outcome", "sha"],
  },
  {
    name: "stack.guard.rejected",
    level: "warn",
    fields: ["work_item_id", "ref", "rule", "path"],
  },
  {
    name: "stack.state.snapshot",
    level: "debug",
    fields: ["work_item_id", "task", "file_count", "bytes", "redactions"],
    numericFields: ["file_count", "bytes", "redactions"],
  },
  {
    name: "stack.overrun.detected",
    level: "warn",
    fields: ["work_item_id", "task", "est_lines", "act_lines"],
  },
  {
    name: "stack.ci.alert",
    level: "error",
    fields: ["work_item_id", "condition"],
  },
];

export function emitStackEvent(
  event: string,
  fields: Record<string, string | number>,
  logger: Logger = createLogger("stack"),
): void {
  const spec = STACK_EVENTS.find((entry) => entry.name === event);
  if (!spec) throw new Error(`unknown stack event: ${event}`);
  const keys = Object.keys(fields);
  const unknown = keys.filter((key) => !spec.fields.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${event}: unknown field(s): ${unknown.join(", ")}`);
  }
  const missing = spec.fields.filter((key) => !keys.includes(key));
  if (missing.length > 0) {
    throw new Error(`${event}: missing field(s): ${missing.join(", ")}`);
  }
  for (const key of spec.numericFields ?? []) {
    const value = fields[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${event}: field ${key} must be a number`);
    }
  }
  const body = keys.map((key) => `${key}=${fields[key]}`).join(" ");
  logger[spec.level](`${event} ${body}`);
}
