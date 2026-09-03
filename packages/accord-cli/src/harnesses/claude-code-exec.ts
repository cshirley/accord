/**
 * Claude Code CLI backend for ACCORD `harness.exec`.
 *
 * Agent markdown frontmatter (`tier`, `model`, `thinking`) is the control plane:
 * resolved via `subagent.json` → `claude --model` + `--effort`. Frontmatter is
 * not passed as argv. Agent body → `--system-prompt`; project stack →
 * `--append-system-prompt`; orchestrator task → prompt argument.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatClaudeCodeTools,
  loadAgentFromSpawnFile,
  parseExecAgentSpawnArgv,
  readFileIfExists,
  resolveSpawnModelFromAgentFile,
  type ExecAgentSpawnArgs,
} from "./exec-agent-shared.js";
import { formatClaudeCodeCliEffort, formatClaudeCodeCliModel } from "./claude-code-model.js";

export type ClaudeCodeExecArgs = ExecAgentSpawnArgs;

export type ClaudeCodeExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  model?: string;
  effort?: string;
  promptChars: number;
};

export function parseClaudeCodeExecArgv(argv: string[]): ClaudeCodeExecArgs {
  return parseExecAgentSpawnArgv(argv, "claude-code-exec");
}

export async function runClaudeCodeExec(
  args: ClaudeCodeExecArgs,
  options?: { claudeBin?: string; skipPermissions?: boolean },
): Promise<ClaudeCodeExecResult> {
  const workdir = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const task = readFileIfExists(args.taskFile);
  const systemAppend = readFileIfExists(args.systemAppendFile);
  const agent = loadAgentFromSpawnFile(args.agentFile);
  const systemPrompt = agent?.systemPrompt?.trim() ?? "";

  const resolved = resolveSpawnModelFromAgentFile(args.agentFile);
  const model = resolved ? formatClaudeCodeCliModel(resolved) : undefined;
  const effort = resolved ? formatClaudeCodeCliEffort(resolved) : undefined;
  const tools = formatClaudeCodeTools(agent);

  const skipPermissions =
    options?.skipPermissions ??
    !["0", "false", "no"].includes(
      (process.env.ACCORD_CLAUDE_SKIP_PERMISSIONS ?? "1").trim().toLowerCase(),
    );

  const claudeBin = options?.claudeBin ?? process.env.ACCORD_CLAUDE_CODE_BIN ?? "claude";
  const cliArgs = ["-p", "--output-format", "text"];
  if (skipPermissions) {
    cliArgs.push("--dangerously-skip-permissions");
  }
  if (model) {
    cliArgs.push("--model", model);
  }
  if (effort) {
    cliArgs.push("--effort", effort);
  }
  if (systemPrompt) {
    cliArgs.push("--system-prompt", systemPrompt);
  }
  if (systemAppend.trim()) {
    cliArgs.push("--append-system-prompt", systemAppend.trim());
  }
  if (tools?.length) {
    cliArgs.push("--tools", tools.join(","));
  }
  cliArgs.push(task);

  const result = await spawnClaudeProcess(claudeBin, cliArgs, workdir);
  return {
    ...result,
    model,
    effort,
    promptChars: task.length,
  };
}

function spawnClaudeProcess(
  command: string,
  args: string[],
  cwd: string,
): Promise<Pick<ClaudeCodeExecResult, "exitCode" | "stdout" | "stderr">> {
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

/** Bundled `harness.exec.command` argv for Claude Code CLI. */
export const CLAUDE_CODE_EXEC_COMMAND: string[] = [
  process.execPath,
  path.join(PACKAGE_ROOT, "scripts/claude-code-exec.ts"),
  "--agent={{agentId}}",
  "--agent-file={{agentFile}}",
  "--task-file={{taskFile}}",
  "--system-append-file={{systemAppendFile}}",
  "--cwd={{cwd}}",
];

/** Preset `harness.exec` block for global or project config. */
export const CLAUDE_CODE_EXEC_HARNESS = {
  default: "exec" as const,
  exec: {
    command: CLAUDE_CODE_EXEC_COMMAND,
    response_json: "stdout" as const,
  },
};

export async function main(argv: string[]): Promise<number> {
  const args = parseClaudeCodeExecArgv(argv);
  const result = await runClaudeCodeExec(args);
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
