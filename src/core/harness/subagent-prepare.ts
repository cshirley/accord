/**
 * Config guard, stack/schema brief injection, intent contract — before subagent runs.
 *
 * This hook intentionally mutates the outgoing `subagent` tool-call payload
 * (entry.task strings and input.model). That is the Pi hook contract: the
 * pre-tool-call hook adjusts arguments in place so that the dispatched call
 * carries the injected brief. Do not refactor to a defensive copy — the
 * mutation is load-bearing.
 */

import { agentDefersConfigGuard, agentRequiresConfig } from "../agents/registry.js";
import { formatIntentContractForTask } from "../briefing/intent-contract-brief.js";
import type { DevHarnessConfig } from "../config/index.js";
import { createLogger } from "../logging.js";
import { formatConfigBrief, formatSchemaBrief } from "../verification/runner.js";
import { collectSubagentEntries } from "./subagent-entries.js";

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
    if (devConfig && typeof entry.task === "string") {
      entry.task += formatConfigBrief(devConfig);
    }
    if (typeof entry.task === "string") {
      const schemas = formatSchemaBrief(agentName);
      if (schemas) entry.task += schemas;
      entry.task += formatIntentContractForTask(entry.task);
    }
  }

  if (typeof input.model === "string" && input.model.startsWith("cursor-agent/")) {
    const modelId = input.model.replace("cursor-agent/", "");
    log.info(`remapping model ${input.model} → ${modelId}`);
    input.model = modelId;
  }

  return {};
}
