/**
 * Recover post-result handling when a subagent exits 0 without a return packet
 * but the primary task file already holds enough state.
 */

import { validateReturn } from "../artifacts/validation.js";
import type { DevHarnessConfig } from "../config/index.js";
import { loadTaskFile } from "../work-items/io.js";
import { runPostResultHandlerForAgent } from "./post-result/registry.js";
import { persistValidatedAgentReturn } from "./task-agent-audit.js";

const RECOVERABLE_IMPLEMENTATION_AGENTS = new Set([
  "phase-test",
  "phase-code",
  "review-test",
  "review-code",
]);

function minimalUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
}

function buildPacketFromTaskFile(agentName: string, task: Record<string, unknown>): unknown | null {
  if (agentName === "phase-test") {
    const files = task.test_files;
    if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === "string")) {
      return null;
    }
    if (task.red_confirmed !== true) {
      return null;
    }
    return {
      status: "done",
      test_files: files,
      red_confirmed: true,
      ...(typeof task.test_output === "string" ? { test_output: task.test_output } : {}),
      ...(Array.isArray(task.ac_covered) ? { ac_covered: task.ac_covered } : {}),
      usage: minimalUsage(),
    };
  }

  const feedback = task.last_review_feedback as { agent?: string; packet?: unknown } | undefined;
  if (
    (agentName === "review-test" || agentName === "review-code") &&
    feedback?.agent === agentName &&
    feedback.packet &&
    typeof feedback.packet === "object"
  ) {
    return feedback.packet;
  }

  return null;
}

/**
 * @returns Markdown to append when recovery ran post-result; empty when nothing to recover.
 */
export async function tryRecoverMissingReturnPacketFromTaskFile(
  workItemId: string,
  agentName: string,
  taskId: number | null,
  devConfig: DevHarnessConfig | null,
): Promise<string> {
  if (!RECOVERABLE_IMPLEMENTATION_AGENTS.has(agentName) || taskId === null) {
    return "";
  }

  const task = loadTaskFile(workItemId, String(taskId));
  if (!task) {
    return "";
  }

  const packet = buildPacketFromTaskFile(agentName, task as Record<string, unknown>);
  if (!packet) {
    return "";
  }

  const validation = await validateReturn(agentName, packet);
  if (!validation.valid) {
    return "";
  }

  persistValidatedAgentReturn(workItemId, agentName, packet);
  const post = runPostResultHandlerForAgent(agentName, workItemId, packet, devConfig);
  return [
    "",
    `✓ **${agentName}** had no return packet but task file state was complete — recovered from disk and advanced harness state.`,
    post ? post.trimStart() : "",
    `Run \`/dev resume ${workItemId}\` to continue.`,
  ]
    .filter(Boolean)
    .join("\n");
}
