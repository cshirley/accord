import * as path from "node:path";
import { loadSubagentConfig } from "../agents.js";
import { classifySpawnFailure, combineAbortSignals } from "./abort.js";
import { spawnSubagent } from "./child.js";
import { failureResult } from "./resolve.js";
import { resolveSpawnTimeoutMs } from "./timeout.js";
import type { RunSubagentRequest, SpawnSubagentParams, SpawnSubagentResult } from "./types.js";
import { SubagentRunError } from "./types.js";

/**
 * Programmatic subagent entry point for ACCORD and other hosts.
 *
 * Awaits an isolated child `pi` process, supports {@link RunSubagentRequest.timeoutMs},
 * and streams structured {@link SubagentRunEvent} values through `onEvent`.
 *
 * Throws {@link SubagentRunError} on timeout, caller abort, or agent resolution failure.
 * Non-zero exit codes return the result and emit `failed` without throwing.
 */
export async function runSubagent(params: RunSubagentRequest): Promise<SpawnSubagentResult> {
  params.onEvent?.({ type: "resolving" });

  const timeoutMs = resolveSpawnTimeoutMs(params.timeoutMs, loadSubagentConfig());
  const combined =
    timeoutMs != null || params.signal
      ? combineAbortSignals(params.signal, timeoutMs)
      : null;

  const spawnParams: SpawnSubagentParams = {
    ...params,
    signal: combined?.signal ?? params.signal,
  };

  let result: SpawnSubagentResult;
  try {
    result = await spawnSubagent(spawnParams);
  } catch (error) {
    const timedOut = combined?.timedOut() ?? false;
    const callerAborted = combined?.callerAborted() ?? false;
    combined?.cleanup();
    const message = error instanceof Error ? error.message : String(error);
    const failure = failureResult(
      params.agent ?? path.basename(params.agentFile ?? "unknown"),
      params.task,
      message,
      params.step,
      params.agentFile,
    );
    if (timedOut && timeoutMs != null) {
      failure.timedOut = true;
      failure.aborted = true;
      const timeoutMessage = `Subagent timed out after ${String(timeoutMs)}ms`;
      params.onEvent?.({
        type: "failed",
        result: failure,
        reason: "timeout",
        message: timeoutMessage,
      });
      throw new SubagentRunError(timeoutMessage, failure, "timeout");
    }
    if (callerAborted || message.includes("aborted")) {
      failure.aborted = true;
      params.onEvent?.({
        type: "failed",
        result: failure,
        reason: "aborted",
        message,
      });
      throw new SubagentRunError(message, failure, "aborted");
    }
    const reason = "process_error";
    params.onEvent?.({ type: "failed", result: failure, reason, message });
    throw error;
  }

  combined?.cleanup();

  const timedOut = combined?.timedOut() ?? false;
  const callerAborted = combined?.callerAborted() ?? false;
  const resolutionError = result.exitCode !== 0 && result.messages.length === 0 && Boolean(result.stderr);

  if (timedOut) {
    result.timedOut = true;
    result.aborted = true;
    const reason = "timeout";
    params.onEvent?.({
      type: "failed",
      result,
      reason,
      message: `Timed out after ${String(timeoutMs)}ms`,
    });
    throw new SubagentRunError(
      `Subagent timed out after ${String(timeoutMs)}ms`,
      result,
      reason,
    );
  }

  if (callerAborted) {
    result.aborted = true;
    const reason = "aborted";
    params.onEvent?.({ type: "failed", result, reason, message: "Subagent run was aborted" });
    throw new SubagentRunError("Subagent run was aborted", result, reason);
  }

  if (resolutionError) {
    const reason = "agent_resolution";
    params.onEvent?.({
      type: "failed",
      result,
      reason,
      message: result.stderr || "Agent resolution failed",
    });
    throw new SubagentRunError(result.stderr || "Agent resolution failed", result, reason);
  }

  if (result.exitCode !== 0) {
    const reason = classifySpawnFailure(result, { timedOut: false, aborted: false });
    params.onEvent?.({
      type: "failed",
      result,
      reason,
      message: result.errorMessage ?? result.stderr,
    });
    return result;
  }

  params.onEvent?.({ type: "completed", result });
  return result;
}
