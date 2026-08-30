/**
 * Config guard and spawn payload enrichment — before subagent runs.
 *
 * Mutates the outgoing `subagent` tool-call payload in place (agentFile,
 * systemAppend, response contract).
 */

import { agentDefersConfigGuard, agentRequiresConfig } from "../agents/registry.js";
import type { DevHarnessConfig } from "../config/index.js";
import { collectSubagentEntries } from "./entries.js";
import { applySubagentSpawnPayload } from "./payload.js";

export function prepareSubagentToolCall(
  input: Record<string, unknown>,
  devConfig: DevHarnessConfig | null,
): { blockReason?: string } {
  const entries = collectSubagentEntries(input);

  for (const entry of entries) {
    const agentName = entry.agent || "";
    if (agentRequiresConfig(agentName) && !agentDefersConfigGuard(agentName) && !devConfig) {
      return {
        blockReason:
          "No ACCORD config found. Run /dev init to configure the harness for this project.",
      };
    }
  }

  applySubagentSpawnPayload(input, devConfig);

  return {};
}
