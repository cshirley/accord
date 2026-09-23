/**
 * Cursor Agent CLI backend for ACCORD `harness.exec`.
 *
 * Agent markdown frontmatter (`tier`, `model`, `thinking`) is the control plane:
 * resolved via `subagent.json` profiles → `agent --model`. Only the agent body,
 * project stack append, and orchestrator task become the prompt.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCursorAgentPrompt,
  loadAgentFromSpawnFile,
  parseExecAgentSpawnArgv,
  readFileIfExists,
  resolveSpawnModelFromAgentFile,
  type ExecAgentSpawnArgs,
} from "./exec-agent-shared.js";
export {
  buildCursorAgentPrompt,
  inferAgentNamespace,
  loadAgentFromSpawnFile,
  parseExecAgentSpawnArgv,
  readFileIfExists,
  resolveSpawnModelFromAgentFile,
  type ExecAgentSpawnArgs,
} from "./exec-agent-shared.js";
import { formatCursorAgentCliModel } from "./cursor-agent-model.js";

export type CursorAgentExecArgs = ExecAgentSpawnArgs;

export type CursorAgentExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  model?: string;
  promptChars: number;
};

/** Resolve `agent --model` from agent file frontmatter + `subagent.json` profiles. */
export function resolveCursorAgentModel(agentFile: string | undefined): string | undefined {
  const resolved = resolveSpawnModelFromAgentFile(agentFile);
  if (!resolved) return undefined;
  return formatCursorAgentCliModel(resolved);
}

export function parseCursorAgentExecArgv(argv: string[]): CursorAgentExecArgs {
  return parseExecAgentSpawnArgv(argv, "cursor-agent-exec");
}

export async function runCursorAgentExec(
  args: CursorAgentExecArgs,
  options?: { agentBin?: string },
): Promise<CursorAgentExecResult> {
  const workdir = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const task = readFileIfExists(args.taskFile);
  const systemAppend = readFileIfExists(args.systemAppendFile);
  const agent = loadAgentFromSpawnFile(args.agentFile);
  const prompt = buildCursorAgentPrompt({
    agentBody: agent?.systemPrompt,
    systemAppend,
    task,
  });

  const agentBin = options?.agentBin ?? process.env.ACCORD_CURSOR_AGENT_BIN ?? "agent";
  const cliArgs = ["--print", "--force", "--output-format", "text"];
  const model = resolveCursorAgentModel(args.agentFile);
  if (model) {
    cliArgs.push("--model", model);
  }
  // `--` keeps `---` section dividers in the prompt out of argv parsing.
  cliArgs.push("--", prompt);

  const result = await spawnAgentProcess(agentBin, cliArgs, workdir);
  return { ...result, model, promptChars: prompt.length };
}

function spawnAgentProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<Pick<CursorAgentExecResult, "exitCode" | "stdout" | "stderr">> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
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
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Bundled `harness.exec.command` argv for Cursor Agent CLI. */
export const CURSOR_AGENT_EXEC_COMMAND: string[] = [
  process.execPath,
  path.join(PACKAGE_ROOT, "scripts/cursor-agent-exec.ts"),
  "--agent={{agentId}}",
  "--agent-file={{agentFile}}",
  "--task-file={{taskFile}}",
  "--system-append-file={{systemAppendFile}}",
  "--cwd={{cwd}}",
];

/** Preset `harness.exec` block for global or project config. */
export const CURSOR_AGENT_EXEC_HARNESS = {
  default: "exec" as const,
  exec: {
    command: CURSOR_AGENT_EXEC_COMMAND,
    response_json: "stdout" as const,
  },
};

export async function main(argv: string[]): Promise<number> {
  const args = parseCursorAgentExecArgv(argv);
  const result = await runCursorAgentExec(args);
  if (result.stdout) process.stdout.write(result.stdout);
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
