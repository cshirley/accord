/**
 * Pi CLI backend for ACCORD harnesses (`--harness pi` and optional exec preset).
 *
 * Spawns isolated `pi --mode json -p` child processes via accord-core's headless
 * {@link spawnSubagent} API. Frontmatter (`tier`, `model`, `thinking`) resolves
 * through `subagent.json` and `accord.json` harness tiers.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSubagentReturnJson, spawnSubagent } from "@clive.shirley/accord-core/agents/index.js";
import type { PreparedSingleSubagentInput } from "@clive.shirley/accord-core/subagent/run-request.js";
import { cliNotify } from "../notify.js";
import { runSpawnPipeline, type SpawnExecutionResult } from "./spawn-pipeline.js";
import {
  loadAgentFromSpawnFile,
  parseExecAgentSpawnArgv,
  readFileIfExists,
  type ExecAgentSpawnArgs,
} from "./exec-agent-shared.js";
import type { AgentHarness, AgentHarnessFactoryOptions } from "./types.js";

export type PiExecArgs = ExecAgentSpawnArgs;

export type PiExecResult = SpawnExecutionResult & {
  model?: string;
};

export function parsePiExecArgv(argv: string[]): PiExecArgs {
  return parseExecAgentSpawnArgv(argv, "pi-exec");
}

/** Spawn one phase/review agent through `pi --mode json -p`. */
export async function runPiExecSpawn(
  prepared: PreparedSingleSubagentInput,
  cwd: string,
): Promise<PiExecResult> {
  const agent = loadAgentFromSpawnFile(prepared.agentFile);
  const result = await spawnSubagent({
    cwd,
    agent: prepared.agent,
    agentFile: prepared.agentFile,
    task: prepared.task,
    systemAppend: prepared.systemAppend,
    response: prepared.response,
    tools: agent?.tools,
  });

  return {
    agent: result.agent,
    task: result.task,
    exitCode: result.exitCode,
    output: result.output,
    stderr: result.stderr,
    parsedReturn: result.parsedReturn ?? parseSubagentReturnJson(result.output),
    model: result.model,
  };
}

/** File-based entry for `harness.exec` templates (task/system files staged by exec harness). */
export async function runPiExec(args: PiExecArgs): Promise<PiExecResult> {
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const task = readFileIfExists(args.taskFile);
  const systemAppend = readFileIfExists(args.systemAppendFile);
  const agentId =
    args.agentId ?? path.basename(args.agentFile ?? "unknown", ".md").replace(/^phase-|^review-/, "");

  return runPiExecSpawn(
    {
      agent: agentId,
      agentFile: args.agentFile,
      task,
      systemAppend: systemAppend || undefined,
    },
    cwd,
  );
}

/** Built-in `--harness pi` backend (no `harness.exec` config required). */
export function createPiHarness(options: AgentHarnessFactoryOptions): AgentHarness {
  return {
    id: "pi",
    cwd: options.cwd,

    notify(level, text) {
      options.notify?.(level, text);
    },

    async spawnSubagent(request) {
      const notify = options.notify ?? ((level, text) => cliNotify(level, text));
      return runSpawnPipeline(
        request,
        {
          cwd: options.cwd,
          state: options.state,
          lifecycleHost: options.lifecycleHost,
          availableToolNames: options.availableToolNames,
          autoConfirm: options.autoConfirm,
          spawnNotifyLabel: options.spawnNotifyLabel,
          notify,
        },
        async (prepared) => runPiExecSpawn(prepared, options.cwd),
      );
    },
  };
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Bundled `harness.exec.command` argv for Pi CLI subprocess spawns. */
export const PI_EXEC_COMMAND: string[] = [
  process.execPath,
  path.join(PACKAGE_ROOT, "scripts/pi-exec.ts"),
  "--agent={{agentId}}",
  "--agent-file={{agentFile}}",
  "--task-file={{taskFile}}",
  "--system-append-file={{systemAppendFile}}",
  "--cwd={{cwd}}",
];

/** Preset `harness.exec` block when you want exec harness id with Pi backend. */
export const PI_EXEC_HARNESS = {
  default: "exec" as const,
  exec: {
    command: PI_EXEC_COMMAND,
    response_json: "stdout" as const,
  },
};

export async function main(argv: string[]): Promise<number> {
  const args = parsePiExecArgv(argv);
  const result = await runPiExec(args);
  if (result.output) process.stdout.write(result.output);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(2);
    });
}
