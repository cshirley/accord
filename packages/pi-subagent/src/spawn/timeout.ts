import type { SubagentConfig } from "../agents.js";

/** Pass as {@link RunSubagentRequest.timeoutMs} to disable the wall-clock limit. */
export const SPAWN_TIMEOUT_DISABLED = 0;

/** Used when neither the call site nor `subagent.json` sets `spawnTimeoutMs`. */
export const DEFAULT_SPAWN_TIMEOUT_MS = 30 * 60 * 1000;

function spawnTimeoutFromEnv(): number | undefined {
  const raw = process.env.ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS;
  if (raw == null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Resolve wall-clock limit for a subagent child process.
 *
 * - `timeoutMs === 0` → no limit (orchestration / long harness phases).
 * - positive `timeoutMs` on the request → use as-is.
 * - omitted on the request → `subagent.json` `spawnTimeoutMs`, else {@link DEFAULT_SPAWN_TIMEOUT_MS}.
 */
export function resolveSpawnTimeoutMs(
  requested: number | undefined,
  config?: SubagentConfig,
): number | undefined {
  if (requested === SPAWN_TIMEOUT_DISABLED) {
    return undefined;
  }
  if (requested != null && requested > 0) {
    return requested;
  }
  const fromConfig = config?.spawnTimeoutMs;
  if (fromConfig === SPAWN_TIMEOUT_DISABLED) {
    return undefined;
  }
  if (fromConfig != null && fromConfig > 0) {
    return fromConfig;
  }
  const fromEnv = spawnTimeoutFromEnv();
  if (fromEnv != null) {
    return fromEnv;
  }
  return DEFAULT_SPAWN_TIMEOUT_MS;
}
