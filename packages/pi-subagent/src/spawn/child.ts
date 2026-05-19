/**
 * Isolated child `pi --mode json` process runner.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { handleSubagentJsonEvent } from "../events/handle.js";
import {
  SubagentActivityBuffer,
  isSubagentStderrNoise,
  summarizeSubagentProgress,
} from "../progress/index.js";
import { parseSubagentReturnJson } from "../response-contract.js";
import type { SpawnSubagentParams, SpawnSubagentResult } from "./types.js";
import { getFinalOutput } from "./output.js";
import {
  buildSystemPrompt,
  buildTask,
  emptyUsage,
  failureResult,
  qualifyModel,
  resolveSpawnAgent,
  resolveSpawnModel,
} from "./resolve.js";

async function writePromptToTempFile(
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  });
  return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

/** Spawn an isolated subagent process. */
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
  if (modelResolved) {
    switch (modelResolved.thinkingMode) {
      case "flag":
        if (modelResolved.thinking) args.push("--thinking", modelResolved.thinking);
        break;
      case "reasoning_effort":
        if (modelResolved.reasoningEffort) {
          args.push("--reasoning-effort", modelResolved.reasoningEffort);
        }
        break;
      case "embedded":
      case "none":
        break;
    }
  } else if (params.thinking) {
    args.push("--thinking", params.thinking);
  }
  if (tools && tools.length > 0) args.push("--tools", tools.join(","));

  const activity = new SubagentActivityBuffer();
  activity.pushStatus("subagent process started");
  params.onEvent?.({ type: "resolved", agent: agent.name, agentFile: agent.filePath, model: qualifiedModel });
  params.onEvent?.({ type: "process_started" });
  params.onEvent?.({ type: "status", message: "subagent process started" });

  const currentResult: SpawnSubagentResult = {
    agent: agent.name,
    agentSource: agent.source,
    agentFile: agent.filePath,
    task: params.task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    model: qualifiedModel,
    step: params.step,
    output: "",
  };

  const emitUpdate = () => {
    currentResult.liveActivity = activity.snapshot();
    currentResult.output = getFinalOutput(currentResult.messages);
    const snapshot = { ...currentResult };
    params.onUpdate?.({ result: snapshot });
    if (params.onEvent) {
      const progress = summarizeSubagentProgress(agent.name, snapshot);
      params.onEvent({ type: "progress", result: snapshot, progress });
      if (progress.textPreview) {
        params.onEvent({ type: "text_delta", preview: progress.textPreview });
      }
    }
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
    let wasAborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const invocation = getPiInvocation(args);
      const proc = spawn(invocation.command, invocation.args, {
        cwd: params.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      emitUpdate();
      let buffer = "";

      const eventCtx = {
        currentResult,
        activity,
        emitUpdate,
        onEvent: params.onEvent,
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        handleSubagentJsonEvent(event as Record<string, unknown>, eventCtx);
      };

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data) => {
        currentResult.stderr += data.toString();
        for (const line of data.toString().split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("{")) {
            processLine(trimmed);
            continue;
          }
          if (isSubagentStderrNoise(trimmed)) {
            continue;
          }
          const preview = trimmed.length > 120 ? `…${trimmed.slice(-120)}` : trimmed;
          const statusMessage = `stderr: ${preview}`;
          activity.pushStatus(statusMessage);
          params.onEvent?.({ type: "status", message: statusMessage });
          emitUpdate();
        }
      });

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        resolve(code ?? 0);
      });

      proc.on("error", () => {
        resolve(1);
      });

      if (params.signal) {
        const killProc = () => {
          wasAborted = true;
          proc.kill("SIGTERM");
          setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
          }, 5000);
        };
        if (params.signal.aborted) killProc();
        else params.signal.addEventListener("abort", killProc, { once: true });
      }
    });

    currentResult.exitCode = exitCode;
    currentResult.output = getFinalOutput(currentResult.messages);
    currentResult.parsedReturn = parseSubagentReturnJson(currentResult.output);
    if (wasAborted) {
      const reason = params.signal?.reason;
      if (reason instanceof DOMException && reason.name === "TimeoutError") {
        throw new Error("Subagent run timed out");
      }
      throw new Error("Subagent was aborted");
    }
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
