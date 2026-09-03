/**
 * Exec harness — subprocess template backend (Phase 3).
 */

import { spawn } from "node:child_process";
import { loadGlobalConfig } from "@clive.shirley/accord-core/config/global.js";
import { mergeHarnessConfig, resolveBackendExecConfig } from "@clive.shirley/accord-core/config/harness-resolve.js";
import type { ExecHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import { extractReturnPacket } from "@clive.shirley/accord-core/subagent/result/packet.js";
import type { PreparedSingleSubagentInput } from "@clive.shirley/accord-core/subagent/run-request.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";
import { cliNotify } from "../notify.js";
import { renderExecCommand, resolveExecTemplateVars } from "./exec-template.js";
import { runSpawnPipeline } from "./spawn-pipeline.js";
import type { AgentHarness, AgentHarnessFactoryOptions } from "./types.js";

export type ExecHarnessOptions = AgentHarnessFactoryOptions & {
  state: HarnessMutableState;
  execConfig?: ExecHarnessConfig;
};

export function resolveExecHarnessConfig(
  state: HarnessMutableState,
  options?: { harnessConfig?: import("@clive.shirley/accord-core/config/types.js").DevHarnessHarnessConfig; backendId?: string },
): ExecHarnessConfig | undefined {
  const globalConfig = loadGlobalConfig();
  const merged =
    options?.harnessConfig ??
    mergeHarnessConfig(globalConfig?.harness, state.devConfig?.harness);
  return resolveBackendExecConfig(merged, options?.backendId);
}

export function createExecHarness(options: ExecHarnessOptions): AgentHarness {
  const execConfig =
    options.execConfig ??
    resolveExecHarnessConfig(options.state, {
      harnessConfig: options.harnessConfig,
      backendId: options.execBackendId,
    });

  return {
    id: "exec",
    cwd: options.cwd,

    notify(level, text) {
      cliNotify(level, text);
    },

    async spawnSubagent(request) {
      if (!execConfig?.command?.length) {
        cliNotify(
          "error",
          "exec harness requires harness.exec.command in AGENTS.md Dev Harness JSON or ~/.config/accord/accord.json.",
        );
        return { exitCode: 1 };
      }

      return runSpawnPipeline(
        request,
        {
          cwd: options.cwd,
          state: options.state,
          lifecycleHost: options.lifecycleHost,
          availableToolNames: options.availableToolNames,
          autoConfirm: options.autoConfirm,
          spawnNotifyLabel: options.spawnNotifyLabel,
          notify: (level, text) => cliNotify(level, text),
        },
        async (prepared) => runExecSpawn(prepared, options.cwd, execConfig),
      );
    },
  };
}

export async function runExecSpawn(
  prepared: PreparedSingleSubagentInput,
  cwd: string,
  execConfig: ExecHarnessConfig,
): Promise<{
  agent: string;
  task: string;
  exitCode: number;
  output?: string;
  stderr?: string;
  parsedReturn?: unknown;
}> {
  const { agent } = prepared;
  const vars = resolveExecTemplateVars(cwd, prepared);
  const argv = renderExecCommand(execConfig.command, vars);
  const [command, ...args] = argv;
  if (!command) {
    return {
      agent,
      task: vars.task,
      exitCode: 1,
      stderr: "harness.exec.command resolved to an empty argv",
    };
  }

  const responseSource = execConfig.response_json ?? "stdout";

  const result = await spawnExecProcess(command, args, {
    cwd,
    env: execConfig.env,
  });
  const responseText = responseSource === "stderr" ? result.stderr : result.stdout;
  const parsedReturn = extractReturnPacket(responseText) ?? undefined;

  return {
    agent,
    task: vars.task,
    exitCode: result.exitCode,
    output: result.stdout,
    stderr: result.stderr,
    parsedReturn,
  };
}

type SpawnExecProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export function spawnExecProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<SpawnExecProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
