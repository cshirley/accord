import type { AgentHarness } from "./types.js";

/** {@link AgentHarness} satisfies {@link OrchestrationRuntimeHost} — pass through to core runner. */
export function asRuntimeHost(harness: AgentHarness): AgentHarness {
  return harness;
}
