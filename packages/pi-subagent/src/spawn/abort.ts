import type { SpawnSubagentResult, SubagentRunEvent } from "./types.js";

export type CombinedAbort = {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
  callerAborted: () => boolean;
};

export function combineAbortSignals(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): CombinedAbort {
  const controller = new AbortController();
  let timeoutFired = false;
  let callerFired = false;
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const attach = (signal: AbortSignal, onAbort: () => void) => {
    if (signal.aborted) {
      onAbort();
      return;
    }
    const listener = () => onAbort();
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  };

  if (callerSignal) {
    attach(callerSignal, () => {
      callerFired = true;
      controller.abort(callerSignal.reason);
    });
  }

  if (timeoutMs != null && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timeoutFired = true;
      controller.abort(new DOMException("Subagent run timed out", "TimeoutError"));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    timedOut: () => timeoutFired,
    callerAborted: () => callerFired && !timeoutFired,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      for (const { signal, listener } of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

export function classifySpawnFailure(
  result: SpawnSubagentResult,
  options: { timedOut: boolean; aborted: boolean; resolutionError?: boolean },
): Extract<SubagentRunEvent, { type: "failed" }>["reason"] {
  if (options.timedOut) return "timeout";
  if (options.aborted) return "aborted";
  if (options.resolutionError || result.stderr.includes("Could not load agent")) {
    return "agent_resolution";
  }
  if (result.exitCode !== 0) return "exit_nonzero";
  return "process_error";
}
