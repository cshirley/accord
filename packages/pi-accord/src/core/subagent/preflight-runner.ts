/**
 * Shared preflight for Pi `subagent` tool calls and programmatic orchestration spawns.
 */

import type { DevHarnessConfig } from "../config/index.js";
import {
  agentRequiresSpawnPreflight,
  runSubagentSpawnPreflightCheck,
} from "../queries/subagent-preflight.js";
import type { HarnessHost } from "../types/host.js";
import { firstSubagentAgentName } from "./entries.js";
import { runGatherPreflightOnSubagentCall } from "./preflight/gather.js";
import { runPipelineArtifactPreflightOnSubagentCall } from "./preflight/pipeline-artifacts.js";
import { runVerifyPreflightOnSubagentCall } from "./preflight/verify.js";
import { prepareSubagentToolCall } from "./prepare.js";

export type SubagentPreflightOptions = {
  devConfig: DevHarnessConfig | null;
  availableToolNames: Set<string>;
  /** Required for phase-gather dependency confirm; omit only in tests. */
  host?: HarnessHost;
};

/**
 * Prepares spawn payload (agentFile, systemAppend, response contract) and runs
 * gather/verify gates. Mutates `input` in place when preparation succeeds.
 */
export async function runSubagentToolPreflight(
  input: Record<string, unknown>,
  options: SubagentPreflightOptions,
): Promise<{ blockReason?: string }> {
  const prep = prepareSubagentToolCall(input, options.devConfig);
  if (prep.blockReason) {
    return prep;
  }

  const host: HarnessHost = options.host ?? {
    notify: () => {},
    confirm: async () => true,
  };

  const gather = await runGatherPreflightOnSubagentCall(
    input,
    options.devConfig,
    options.availableToolNames,
    host,
  );
  if (gather.blockReason) {
    return gather;
  }

  const pipeline = await runPipelineArtifactPreflightOnSubagentCall(input);
  if (pipeline.blockReason) {
    return pipeline;
  }

  const verify = await runVerifyPreflightOnSubagentCall(input, options.devConfig);
  if (verify.blockReason) {
    return verify;
  }

  const agent = firstSubagentAgentName(input);
  if (agent && agentRequiresSpawnPreflight(agent)) {
    const credential = runSubagentSpawnPreflightCheck(agent);
    if (!credential.ok) {
      return {
        blockReason: [
          `Subagent preflight failed for ${agent}:`,
          ...credential.blocks.map((b) => `- ${b}`),
          "",
          "Run dev_subagent_preflight before retrying.",
        ].join("\n"),
      };
    }
  }

  return {};
}
