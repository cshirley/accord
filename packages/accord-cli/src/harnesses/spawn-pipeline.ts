/**
 * Shared preflight → spawn → post-process path for headless harness backends.
 */

import { tryCommitOnTaskDone } from "@clive.shirley/accord-core/orchestration/commit-on-task-done.js";
import type { OrchestrationNotifyLevel } from "@clive.shirley/accord-core/orchestration/host.js";
import type { SubagentSpawnResult } from "@clive.shirley/accord-core/orchestration/types.js";
import {
  processSubagentToolResult,
  readPreparedSingleSubagentInput,
  runSubagentToolPreflight,
} from "@clive.shirley/accord-core/subagent/index.js";
import {
  extractTaskIdFromTaskText,
  extractWorkItemId,
  loadPricing,
} from "@clive.shirley/accord-core/telemetry/usage.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";

export type SpawnExecutionResult = {
  agent: string;
  task: string;
  exitCode: number;
  output?: string;
  stderr?: string;
  parsedReturn?: unknown;
};

export type SpawnPipelineOptions = {
  cwd: string;
  state: HarnessMutableState;
  availableToolNames?: Set<string>;
  autoConfirm?: boolean;
  spawnNotifyLabel?: string;
  notify: (level: OrchestrationNotifyLevel, text: string) => void;
};

export async function runSpawnPipeline(
  request: { agent: string; task: string },
  options: SpawnPipelineOptions,
  executeSpawn: (
    prepared: import("@clive.shirley/accord-core/subagent/run-request.js").PreparedSingleSubagentInput,
  ) => Promise<SpawnExecutionResult>,
): Promise<SubagentSpawnResult> {
  const pricing = loadPricing();
  const spawnLabel = options.spawnNotifyLabel ?? "accord";
  const availableToolNames = options.availableToolNames ?? new Set<string>();
  const autoConfirm = options.autoConfirm ?? true;
  const { notify, state } = options;

  const input: Record<string, unknown> = { agent: request.agent, task: request.task };

  const preflight = await runSubagentToolPreflight(input, {
    devConfig: state.devConfig,
    availableToolNames,
    host: {
      notify: (level, msg) => notify(level === "warning" ? "warning" : "info", msg),
      confirm: async () => autoConfirm,
    },
  });
  if (preflight.blockReason) {
    notify("warning", preflight.blockReason);
    return { exitCode: 1 };
  }

  const prepared = readPreparedSingleSubagentInput(input);
  if (!prepared) {
    notify("error", "Internal error: subagent payload missing after preflight.");
    return { exitCode: 1 };
  }

  const { agent, task } = prepared;
  notify("info", `${spawnLabel}: starting ${agent}…`);
  const singleResult = await executeSpawn(prepared);

  const subagentDetails = {
    mode: "single" as const,
    agentScope: "user" as const,
    projectAgentsDir: null as string | null,
    results: [
      {
        agent: singleResult.agent,
        task: singleResult.task,
        exitCode: singleResult.exitCode,
        output: singleResult.output,
        stderr: singleResult.stderr,
        parsedReturn: singleResult.parsedReturn,
      },
    ],
  };

  const append = await processSubagentToolResult({
    details: subagentDetails,
    state,
    pricing,
  });

  if (agent === "review-code" && singleResult.exitCode === 0) {
    const workItemId = extractWorkItemId(task, { mustExist: true });
    const taskId = extractTaskIdFromTaskText(task);
    if (workItemId && taskId != null) {
      const commitResult = await tryCommitOnTaskDone(
        workItemId,
        taskId,
        state.devConfig,
        options.cwd,
      );
      if (commitResult.ok && commitResult.hash) {
        notify("info", `Task commit: ${commitResult.hash}`);
      } else if (!commitResult.ok && commitResult.reason) {
        notify("warning", `Task commit failed: ${commitResult.reason}`);
      }
    }
  }

  const exitLabel = singleResult.exitCode === 0 ? "ok" : `exit ${String(singleResult.exitCode)}`;
  if (append.trim()) {
    notify("info", `${spawnLabel}: ${agent} (${exitLabel})\n${append}`);
  } else {
    notify("info", `${spawnLabel}: ${agent} (${exitLabel})`);
  }

  return { exitCode: singleResult.exitCode, parsedReturn: singleResult.parsedReturn };
}
