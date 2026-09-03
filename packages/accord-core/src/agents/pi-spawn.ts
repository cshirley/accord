/**
 * Headless Pi subprocess spawner (`pi --mode json -p`).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendThinkingCliArgs } from "./cli-args.js";
import { createPiStreamState, handlePiJsonEvent, resolvePiStreamOutput } from "./pi-stream.js";
import { parseSubagentReturnJson } from "./response-contract.js";
import {
  buildSystemPrompt,
  buildTask,
  emptyUsage,
  failureResult,
  qualifyModel,
  resolveSpawnAgent,
  resolveSpawnModel,
  type SpawnSubagentParams,
  type SpawnSubagentResult,
} from "./spawn-resolve.js";

const STDERR_BUFFER_CAP = 1024 * 1024;

function resolvePiBinary(): string {
  return process.env.ACCORD_PI_BIN?.trim() || "pi";
}

async function writePromptToTempFile(
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "accord-pi-spawn-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

/** Spawn an isolated Pi subagent process for headless hosts (accord-cli). */
export async function spawnSubagent(params: SpawnSubagentParams): Promise<SpawnSubagentResult> {
  const resolved = resolveSpawnAgent(params);
  if (!resolved.agent) {
    return failureResult(
      params.agent ?? path.basename(params.agentFile ?? "unknown"),
      params.task,
      resolved.error ?? "Agent resolution failed.",
      params.step,
      params.agentFile,
    );
  }

  const agent = resolved.agent;
  const tools = params.tools ?? agent.tools;
  const modelResolved = resolveSpawnModel(agent, params);
  let qualifiedModel: string | undefined;
  if (modelResolved) {
    qualifiedModel = qualifyModel(modelResolved.model, modelResolved.provider);
  } else if (params.model?.includes("/")) {
    qualifiedModel = params.model;
  } else if (params.model) {
    qualifiedModel = params.model;
  }

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (qualifiedModel) args.push("--model", qualifiedModel);
  appendThinkingCliArgs(args, modelResolved, params.thinking);
  if (tools && tools.length > 0) args.push("--tools", tools.join(","));

  const streamState = createPiStreamState();
  const currentResult: SpawnSubagentResult = {
    agent: agent.name,
    agentSource: agent.source,
    agentFile: agent.filePath,
    task: params.task,
    exitCode: 0,
    messages: streamState.messages,
    stderr: "",
    usage: emptyUsage(),
    model: qualifiedModel,
    step: params.step,
    output: "",
  };

  let tmpPromptDir: string | null = null;
  let tmpPromptPath: string | null = null;

  try {
    const systemPrompt = buildSystemPrompt(agent, params.systemAppend);
    if (systemPrompt) {
      const tmp = await writePromptToTempFile(agent.name, systemPrompt);
      tmpPromptDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      args.push("--append-system-prompt", tmpPromptPath);
    }

    const taskBody = buildTask(params.task, params.response);
    args.push(`Task: ${taskBody}`);

    const piBin = resolvePiBinary();
    const exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(piBin, args, {
        cwd: params.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";

      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          handlePiJsonEvent(streamState, event);
        } catch {
          /* ignore non-JSON lines */
        }
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        const text = data.toString();
        if (currentResult.stderr.length < STDERR_BUFFER_CAP) {
          const remaining = STDERR_BUFFER_CAP - currentResult.stderr.length;
          if (text.length <= remaining) {
            currentResult.stderr += text;
          } else {
            currentResult.stderr += `${text.slice(0, remaining)}\n[stderr truncated at ${String(STDERR_BUFFER_CAP)} bytes]`;
          }
        }
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{")) processLine(trimmed);
        }
      });

      let killTimer: ReturnType<typeof setTimeout> | undefined;
      let abortListener: (() => void) | undefined;
      const signal = params.signal;

      const detachAbort = () => {
        if (killTimer !== undefined) {
          clearTimeout(killTimer);
          killTimer = undefined;
        }
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
          abortListener = undefined;
        }
      };

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        detachAbort();
        resolve(code ?? 0);
      });

      proc.on("error", () => {
        detachAbort();
        resolve(1);
      });

      if (signal) {
        const killProc = () => {
          proc.kill("SIGTERM");
          killTimer = setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (signal.aborted) {
          killProc();
        } else {
          abortListener = killProc;
          signal.addEventListener("abort", killProc, { once: true });
        }
      }
    });

    currentResult.exitCode = exitCode;
    currentResult.usage = streamState.usage;
    currentResult.model = streamState.model ?? qualifiedModel;
    currentResult.stopReason = streamState.stopReason;
    currentResult.errorMessage = streamState.errorMessage;
    currentResult.output = resolvePiStreamOutput(streamState);
    currentResult.parsedReturn = parseSubagentReturnJson(currentResult.output);
    return currentResult;
  } finally {
    if (tmpPromptPath) {
      try {
        fs.unlinkSync(tmpPromptPath);
      } catch {
        /* ignore */
      }
    }
    if (tmpPromptDir) {
      try {
        fs.rmdirSync(tmpPromptDir);
      } catch {
        /* ignore */
      }
    }
  }
}
