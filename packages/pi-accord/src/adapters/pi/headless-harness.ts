/**
 * Headless Pi harness — programmatic pi-subagent spawn + core pre/post hooks.
 *
 * Used by standalone `accord --harness pi` (no Pi TUI). The Pi extension uses
 * {@link createPiExtensionHarness} instead for full UI integration.
 */

import "@clive.shirley/pi-accord/queries/subagent-preflight.js";
import {
  runSpawnPipeline,
  type SpawnExecutionResult,
} from "@clive.shirley/accord-cli/harnesses/spawn-pipeline.js";
import type {
  AgentHarness,
  AgentHarnessFactoryOptions,
} from "@clive.shirley/accord-cli/harnesses/types.js";
import { buildSingleSubagentRunRequest } from "@clive.shirley/accord-core/subagent/index.js";
import { SPAWN_TIMEOUT_DISABLED, SubagentRunError } from "../../integrations/pi-subagent.js";
import { mapSpawnResultToSingle, runOrchestrationSubagent } from "./subagent/spawn-bridge.js";

export type PiHeadlessHarnessOptions = AgentHarnessFactoryOptions;

export function createPiHeadlessHarness(options: PiHeadlessHarnessOptions): AgentHarness {
  return {
    id: "pi",
    cwd: options.cwd,

    notify(level, text) {
      options.notify?.(level, text);
    },

    async spawnSubagent(request) {
      const notify = options.notify ?? (() => {});
      return runSpawnPipeline(
        request,
        {
          cwd: options.cwd,
          state: options.state,
          availableToolNames: options.availableToolNames,
          autoConfirm: options.autoConfirm,
          spawnNotifyLabel: options.spawnNotifyLabel,
          notify,
        },
        async (prepared) => executePiSpawn(prepared, options.cwd, notify),
      );
    },
  };
}

async function executePiSpawn(
  prepared: { agent: string; task: string },
  cwd: string,
  notify: PiHeadlessHarnessOptions["notify"],
): Promise<SpawnExecutionResult> {
  const { agent, task } = prepared;
  const emit = notify ?? (() => {});

  try {
    const singleResult = await runOrchestrationSubagent(
      buildSingleSubagentRunRequest(prepared, cwd, {
        timeoutMs: SPAWN_TIMEOUT_DISABLED,
        onEvent: (event) => {
          if (event.type === "progress" && event.progress?.lastToolLine) {
            emit("info", `${agent}: ${event.progress.lastToolLine}`);
          }
        },
      }) as import("../../integrations/pi-subagent.js").RunSubagentRequest,
    );
    return {
      agent: singleResult.agent,
      task: singleResult.task,
      exitCode: singleResult.exitCode,
      output: singleResult.output,
      stderr: singleResult.stderr,
      parsedReturn: singleResult.parsedReturn,
    };
  } catch (error) {
    if (error instanceof SubagentRunError) {
      const singleResult = mapSpawnResultToSingle(error.result);
      const level = error.reason === "aborted" || error.reason === "timeout" ? "warning" : "error";
      emit(level, `Subagent spawn failed: ${error.message}`);
      return {
        agent: singleResult.agent,
        task: singleResult.task,
        exitCode: singleResult.exitCode,
        output: singleResult.output,
        stderr: singleResult.stderr,
        parsedReturn: singleResult.parsedReturn,
      };
    }
    const msg = error instanceof Error ? error.message : String(error);
    emit("error", `Subagent spawn failed: ${msg}`);
    return { agent, task, exitCode: 1, stderr: msg };
  }
}
