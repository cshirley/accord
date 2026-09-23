/**
 * Build a complete ~/.config/accord/accord.json document.
 */

import type {
  AgentTierConfig,
  DevHarnessGlobalConfig,
  HarnessTierMap,
} from "@clive.shirley/accord-core/config/types.js";
import { detectInstalledHarnesses, type DetectedHarness } from "./detect-harnesses.js";

export type GenerateGlobalConfigOptions = {
  /** Default backend id (pi, claude, cursor). */
  defaultHarnessId: string;
  /** Subset of backends to include (defaults to installed only). */
  backends?: DetectedHarness[];
};

const TIER_DEFAULTS: Record<string, HarnessTierMap> = {
  pi: {
    reasoning: { harness: "pi", model: "anthropic/claude-opus-4-7", thinking: "high" },
    workhorse: { harness: "pi", model: "anthropic/claude-sonnet-4-6", thinking: "medium" },
    lightweight: { harness: "pi", model: "anthropic/claude-haiku-4-5", thinking: "low" },
    review: { harness: "pi", model: "anthropic/claude-opus-4-7", thinking: "xhigh" },
  },
  claude: {
    reasoning: { harness: "claude", model: "claude-opus-4-7", thinking: "high" },
    workhorse: { harness: "claude", model: "claude-sonnet-4-6", thinking: "medium" },
    lightweight: { harness: "claude", model: "claude-haiku-4-5", thinking: "low" },
    review: { harness: "claude", model: "claude-opus-4-7", thinking: "xhigh" },
  },
  cursor: {
    reasoning: { harness: "cursor", model: "claude-opus-5-thinking", thinking: "high" },
    workhorse: { harness: "cursor", model: "composer-2.5", thinking: "medium" },
    lightweight: { harness: "cursor", model: "claude-haiku-4-5", thinking: "low" },
    review: { harness: "cursor", model: "gpt-5.4", thinking: "xhigh" },
  },
};

export function defaultTiersForHarness(defaultHarnessId: string): HarnessTierMap {
  return TIER_DEFAULTS[defaultHarnessId] ?? TIER_DEFAULTS.claude;
}

export function buildGlobalAccordConfig(
  options: GenerateGlobalConfigOptions,
): DevHarnessGlobalConfig {
  const detected = options.backends ?? detectInstalledHarnesses().filter((b) => b.installed);
  const backends = detected.map((backend) => ({
    id: backend.id,
    label: backend.label,
    kind: backend.kind,
    command: backend.command,
    response_json: backend.response_json,
    binary_env: backend.binary_env,
  }));

  return {
    orchestration: {
      resume: {
        no_auto_chain_agents: [],
        max_sequential_spawns: 32,
      },
      commit: {
        on_task_done: true,
      },
    },
    harness: {
      default: options.defaultHarnessId,
      backends,
      tiers: defaultTiersForHarness(options.defaultHarnessId),
    },
    providers: [],
  };
}

export function formatGlobalAccordConfigJson(config: DevHarnessGlobalConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function summarizeTier(tier: AgentTierConfig | undefined): string {
  if (!tier) return "(unset)";
  const thinking = tier.thinking ? ` thinking=${tier.thinking}` : "";
  return `${tier.harness} → ${tier.model}${thinking}`;
}
