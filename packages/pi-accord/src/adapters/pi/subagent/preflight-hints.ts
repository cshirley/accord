/**
 * Build Pi-session hints for core subagent preflight diagnostics.
 */

import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { resolveJudgmentModelRefFromHarness } from "@clive.shirley/accord-core/queries/subagent-preflight-scoped.js";
import type {
  SubagentPreflightHostHints,
  SubagentPreflightScopedModel,
} from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type AgentConfig,
  loadSubagentConfig,
  resolveModelConfig,
} from "../../../../../pi-subagent/src/agents.js";

const JUDGMENT_LIGHTWEIGHT_AGENT: AgentConfig = {
  name: "__judgment__",
  description: "",
  tier: "lightweight",
  systemPrompt: "",
  source: "user",
  filePath: "",
};

export function buildPiSubagentPreflightHints(
  ctx: ExtensionContext,
  devConfig: DevHarnessConfig | null,
): SubagentPreflightHostHints {
  const scoped_models: SubagentPreflightScopedModel[] = ctx.scopedModels.map((entry) => ({
    provider: entry.model.provider,
    modelId: entry.model.id,
    thinkingLevel: entry.thinkingLevel,
  }));

  const tierResolved = resolveModelConfig(JUDGMENT_LIGHTWEIGHT_AGENT, loadSubagentConfig());
  const lightweightTier = tierResolved
    ? { provider: tierResolved.provider, model: tierResolved.model }
    : null;

  const judgment_model = resolveJudgmentModelRefFromHarness(devConfig, lightweightTier);

  return { scoped_models, judgment_model };
}
