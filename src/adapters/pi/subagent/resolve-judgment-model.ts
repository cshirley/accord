/**
 * Resolve the model for orchestration judgment `completeSimple` — independent of chat model when possible.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import {
  type ExtensionContext,
  ModelRuntime,
  resolveCliModel,
} from "@earendil-works/pi-coding-agent";
import type { DevHarnessConfig } from "../../../core/config/index.js";
import {
  loadSubagentConfig,
  resolveModelConfig,
  type AgentConfig,
} from "../../../../packages/pi-subagent/src/agents.js";

export type JudgmentModelSource = "config" | "lightweight_tier" | "scoped" | "chat";

export interface ResolvedJudgmentModel {
  model: Model<any>;
  thinkingLevel?: ThinkingLevel;
  source: JudgmentModelSource;
  /** Set when falling back to the interactive chat model. */
  piggybackWarning?: string;
}

const JUDGMENT_LIGHTWEIGHT_AGENT: AgentConfig = {
  name: "__judgment__",
  description: "",
  tier: "lightweight",
  systemPrompt: "",
  source: "user",
  filePath: "",
};

let modelRuntimePromise: Promise<ModelRuntime> | null = null;

function getModelRuntime(): Promise<ModelRuntime> {
  if (!modelRuntimePromise) {
    modelRuntimePromise = ModelRuntime.create();
  }
  return modelRuntimePromise;
}

function modelsEqual(a: Model<any>, b: Model<any>): boolean {
  return a.provider === b.provider && a.id === b.id;
}

async function resolveConfiguredJudgmentModel(
  modelRef: string,
  thinkingOverride: ThinkingLevel | undefined,
  ctx: ExtensionContext,
): Promise<Model<any> | undefined> {
  const runtime = await getModelRuntime();
  const resolved = resolveCliModel({
    cliModel: modelRef,
    cliThinking: thinkingOverride,
    modelRuntime: runtime,
  });
  if (resolved.error || !resolved.model) return undefined;
  const fromRegistry = ctx.modelRegistry.find(resolved.model.provider, resolved.model.id);
  return fromRegistry ?? resolved.model;
}

async function modelHasAuth(model: Model<any>, ctx: ExtensionContext): Promise<boolean> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  return auth.ok;
}

/** Last scoped entry — matches Ctrl+P order when the user curated the shortlist. */
function pickScopedJudgmentModel(ctx: ExtensionContext): Model<any> | undefined {
  if (ctx.scopedModels.length === 0) return undefined;
  return ctx.scopedModels[ctx.scopedModels.length - 1]?.model;
}

export async function resolveJudgmentModel(
  ctx: ExtensionContext,
  devConfig: DevHarnessConfig | null,
): Promise<ResolvedJudgmentModel | null> {
  const judgment = devConfig?.orchestration?.judgment;
  const configThinking = judgment?.thinking as ThinkingLevel | undefined;

  if (judgment?.model?.trim()) {
    const model = await resolveConfiguredJudgmentModel(judgment.model.trim(), configThinking, ctx);
    if (model && (await modelHasAuth(model, ctx))) {
      return {
        model,
        thinkingLevel: configThinking,
        source: "config",
      };
    }
  }

  const tierResolved = resolveModelConfig(JUDGMENT_LIGHTWEIGHT_AGENT, loadSubagentConfig());
  if (tierResolved) {
    const model = ctx.modelRegistry.find(tierResolved.provider, tierResolved.model);
    if (model && (await modelHasAuth(model, ctx))) {
      return {
        model,
        thinkingLevel: tierResolved.thinking as ThinkingLevel | undefined,
        source: "lightweight_tier",
      };
    }
  }

  const scopedModel = pickScopedJudgmentModel(ctx);
  if (scopedModel && (await modelHasAuth(scopedModel, ctx))) {
    const scopedEntry = ctx.scopedModels.find((entry) => modelsEqual(entry.model, scopedModel));
    return {
      model: scopedModel,
      thinkingLevel: scopedEntry?.thinkingLevel,
      source: "scoped",
    };
  }

  const chatModel = ctx.model;
  if (chatModel && (await modelHasAuth(chatModel, ctx))) {
    return {
      model: chatModel,
      thinkingLevel: ctx.thinkingLevel,
      source: "chat",
      piggybackWarning:
        "Orchestration judgment is using the interactive chat model. Set orchestration.judgment.model or align subagent.json lightweight tier for a dedicated model.",
    };
  }

  return null;
}
