import { randomBytes } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { renderTaskTrace } from "../tasks/render.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { loadTaskFile, writeJson } from "../work-items/io.js";
import { capBytes, redactTaskFile } from "./redact.js";

type TaskRecord = Record<string, unknown>;
type StringCapper = (text: string) => string;

export function stateSnapshotDirRel(workItemId: string, taskId: number): string {
  return `${devArtifactDirRel(workItemId)}/state/task-${String(taskId)}`;
}

function capStrings(node: unknown, cap: StringCapper): unknown {
  if (typeof node === "string") return cap(node);
  if (Array.isArray(node)) return node.map((item) => capStrings(item, cap));
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as TaskRecord).map(([key, child]) => [key, capStrings(child, cap)]),
    );
  }
  return node;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Writes the redacted, capped state snapshot (STATE.md + task.json) for a task when
 * stack.state.persist is "tree" and stack.state.redact is true. Never touches the live task file.
 */
export function writeStateSnapshot(
  workItemId: string,
  taskId: number,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string = process.cwd(),
): void {
  const { state } = resolveStackConfig(devConfig);
  if (state.persist !== "tree" || !state.redact) return;
  const live = loadTaskFile(workItemId, String(taskId), cwd);
  if (!live) return;

  const redacted = redactTaskFile(live as unknown as TaskRecord);
  let stringCap = Math.max(64, Math.floor(state.max_bytes / 4));
  let task: TaskRecord = redacted.value;
  let markdown = "";
  for (;;) {
    const capped = capStrings(redacted.value, (text) => capBytes(text, stringCap).value);
    task = capped as TaskRecord;
    const control = { ...((task.control as TaskRecord | undefined) ?? {}) };
    control.in_flight = null;
    control.owner_nonce = randomBytes(3).toString("hex");
    task = { ...task, control };
    markdown = renderTaskTrace(task as never);
    if (
      (jsonBytes(task) <= state.max_bytes &&
        Buffer.byteLength(markdown, "utf8") <= state.max_bytes) ||
      stringCap <= 64
    ) {
      break;
    }
    stringCap = Math.max(64, Math.floor(stringCap / 2));
  }
  markdown = capBytes(markdown, state.max_bytes).value;

  const dirRel = stateSnapshotDirRel(workItemId, taskId);
  const dir = join(cwd, dirRel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "STATE.md"), markdown, "utf8");
  writeJson(join(dir, "task.json"), task);

  const bytes = statSync(join(dir, "STATE.md")).size + statSync(join(dir, "task.json")).size;
  try {
    emitStackEvent("stack.state.snapshot", {
      work_item_id: workItemId,
      task: taskId,
      file_count: 2,
      bytes,
      redactions: redacted.redactions,
    });
  } catch {
    // telemetry must never fail the snapshot
  }
}
