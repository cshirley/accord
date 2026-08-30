/**
 * Scoped-model diagnostics for subagent preflight (Pi parent session).
 */

import type { SubagentPreflightScopedModel } from "./subagent-preflight.js";

export function modelInScopedList(
  provider: string,
  modelId: string,
  scoped: readonly SubagentPreflightScopedModel[],
): boolean {
  return scoped.some((entry) => entry.provider === provider && entry.modelId === modelId);
}

export function applyScopedPreflightWarnings(
  warnings: string[],
  spawn: { provider: string; model: string | null },
  scoped: readonly SubagentPreflightScopedModel[],
  judgmentModel: { provider: string; model: string } | null,
): void {
  if (scoped.length === 0) return;

  if (spawn.model && !modelInScopedList(spawn.provider, spawn.model, scoped)) {
    warnings.push(
      `Spawn model ${spawn.provider}/${spawn.model} is not in the parent session scoped models list (enabledModels / --models). Spawn will still use subagent.json.`,
    );
  }

  if (
    judgmentModel &&
    !modelInScopedList(judgmentModel.provider, judgmentModel.model, scoped)
  ) {
    warnings.push(
      `Judgment model ${judgmentModel.provider}/${judgmentModel.model} is not in the parent session scoped models list.`,
    );
  }
}

/** Resolve judgment provider/model from harness config + subagent.json lightweight tier (no Pi ctx). */
export function resolveJudgmentModelRefFromHarness(
  devConfig: { orchestration?: { judgment?: { model?: string } } } | null,
  lightweightTier: { provider: string; model: string } | null,
): { provider: string; model: string } | null {
  const configured = devConfig?.orchestration?.judgment?.model?.trim();
  if (configured) {
    const slash = configured.indexOf("/");
    if (slash > 0) {
      const provider = configured.slice(0, slash);
      const rest = configured.slice(slash + 1);
      const modelId = rest.split(":")[0]?.trim();
      if (provider && modelId) return { provider, model: modelId };
    }
  }
  return lightweightTier;
}
