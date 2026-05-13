/**
 * Feature flags for harness orchestration (core runner + programmatic subagent).
 */

export function isCoreOrchestratorEnabled(): boolean {
  return process.env.ACCORD_CORE_ORCHESTRATOR?.trim() === "1";
}
