/**
 * Config guard and spawn payload enrichment — before subagent runs.
 *
 * Mutates the outgoing `subagent` tool-call payload in place (agentFile,
 * systemAppend, response contract, optional model remap).
 */

import { agentDefersConfigGuard, agentRequiresConfig } from "../agents/registry.js";
import type { DevHarnessConfig } from "../config/index.js";
import { createLogger } from "../logging.js";
import { collectSubagentEntries } from "./subagent-entries.js";
import { applySubagentSpawnPayload } from "./subagent-spawn-payload.js";

const log = createLogger("harness");

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

  if (typeof input.model === "string" && input.model.startsWith("cursor-agent/")) {
    const modelId = input.model.replace("cursor-agent/", "");
    log.info(`remapping model ${input.model} → ${modelId}`);
    input.model = modelId;
  }

  return {};
}
