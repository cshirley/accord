/**
 * Feature flags for harness orchestration (core runner + programmatic subagent).
 *
 * `ACCORD_CORE_ORCHESTRATOR` defaults to **on** when unset or empty.
 * Set to `0` or `false` to disable programmatic orchestration spawns for `/dev` workflow subcommands.
 */

export function isCoreOrchestratorEnabled(): boolean {
  const raw = process.env.ACCORD_CORE_ORCHESTRATOR?.trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (raw === "0" || lower === "false" || lower === "no" || lower === "off") {
    return false;
  }
  return true;
}
