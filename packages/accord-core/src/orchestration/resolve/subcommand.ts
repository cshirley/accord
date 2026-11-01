/**
 * Map `/dev` subcommands to harness orchestration resolutions.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseKnownDevSubcommandArgs } from "../../commands/dispatch.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { resolveStackConfig } from "../../config/stack-flags.js";
import { cancelAmend, openAmend, readAmendSession } from "../../contract/amend-session.js";
import type { ResumeOrchestrationResolution } from "../types.js";
import { resolveFinishOrchestration } from "./finish.js";
import { resolveForcedAgentOrchestration } from "./forced.js";
import { type ResolveResumeOrchestrationOptions, resolveResumeOrchestration } from "./resume.js";

/** Subcommands handled in the extension without spawning (tools / messaging only). */
export const EXTENSION_ONLY_DEV_SUBCOMMANDS = new Set([
  "help",
  "tasks",
  "retro",
  "tag",
  "rehydrate",
  "init",
  "spec-gaps",
  "review",
  "gaps",
  "deviations",
]);

const FORCED_AGENT_BY_SUBCOMMAND: Readonly<Record<string, string>> = {
  align: "phase-align",
  spec: "phase-spec",
  plan: "phase-plan",
  check: "phase-verify-acceptance",
  gaps: "phase-gaps",
  deviations: "review-deviation",
  "amend-spec": "phase-spec",
};

export type DevSubcommandOrchestrationPlan =
  | { kind: "resume" }
  | { kind: "finish" }
  | { kind: "forced"; agentId: string; taskSuffix?: string }
  | { kind: "extension_only" };

export function planDevSubcommandOrchestration(
  subcommand: string,
  rawArgs: string,
): DevSubcommandOrchestrationPlan {
  if (EXTENSION_ONLY_DEV_SUBCOMMANDS.has(subcommand)) {
    return { kind: "extension_only" };
  }
  if (subcommand === "resume") return { kind: "resume" };
  if (subcommand === "finish") return { kind: "finish" };

  const agentId = FORCED_AGENT_BY_SUBCOMMAND[subcommand];
  if (!agentId) {
    return { kind: "extension_only" };
  }

  if (subcommand === "amend-spec") {
    return {
      kind: "forced",
      agentId,
      taskSuffix:
        "Mid-implementation spec amendment: update the spec per the amend-spec playbook and agent contract.",
    };
  }

  if (subcommand === "deviations") {
    const parsed = parseKnownDevSubcommandArgs(subcommand, rawArgs);
    const tail = parsed.positional.slice(1).join(" ");
    return {
      kind: "forced",
      agentId,
      taskSuffix: tail
        ? `Deviation review request: ${tail}`
        : "Review open deviations on this work item per the review-deviation agent contract.",
    };
  }

  if (subcommand === "check") {
    return {
      kind: "forced",
      agentId,
      taskSuffix:
        "Rerun lower-level acceptance verification for the current work item per phase-verify-acceptance.",
    };
  }

  return { kind: "forced", agentId };
}

function parseAmendArgs(
  workItemId: string,
  rawArgs: string,
): { reason: string; replan: boolean; cancel: boolean } {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] === workItemId) tokens.shift();
  const rest = tokens.filter((token) => token !== "--replan" && token !== "--cancel");
  return {
    reason: rest.join(" "),
    replan: tokens.includes("--replan"),
    cancel: tokens.includes("--cancel"),
  };
}

function resolveLockedAmendSpec(
  workItemId: string,
  rawArgs: string,
  devConfig: DevHarnessConfig | null,
  forcedSuffix: string | undefined,
): ResumeOrchestrationResolution {
  const cwd = process.cwd();
  const parsed = parseAmendArgs(workItemId, rawArgs);
  if (parsed.cancel) {
    const wasOpen = readAmendSession(workItemId, cwd) !== null;
    cancelAmend(workItemId, cwd);
    return {
      outcome: "blocked",
      messages: [
        {
          level: "info",
          text: wasOpen
            ? `Contract amend cancelled for ${workItemId}.`
            : `No open contract amend to cancel for ${workItemId}.`,
        },
      ],
    };
  }
  const wasOpen = readAmendSession(workItemId, cwd) !== null;
  const opened = openAmend(workItemId, { reason: parsed.reason, replan: parsed.replan }, cwd);
  if (!opened.ok) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: `/dev amend-spec ${workItemId} <reason> [--replan]: ${opened.reason}.`,
        },
      ],
    };
  }
  const resolution = resolveForcedAgentOrchestration(
    workItemId,
    FORCED_AGENT_BY_SUBCOMMAND["amend-spec"] as string,
    devConfig,
    {
      subcommand: "amend-spec",
      taskSuffix: [
        forcedSuffix,
        `Amend reason: ${parsed.reason}`,
        parsed.replan ? "Replan follows (--replan)." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );
  if (resolution.outcome !== "spawn" && !wasOpen) cancelAmend(workItemId, cwd);
  return resolution;
}

export function resolveDevSubcommandOrchestration(
  subcommand: string,
  workItemId: string,
  rawArgs: string,
  devConfig: DevHarnessConfig | null,
  options?: ResolveResumeOrchestrationOptions,
): ResumeOrchestrationResolution {
  const plan = planDevSubcommandOrchestration(subcommand, rawArgs);
  switch (plan.kind) {
    case "resume":
      return resolveResumeOrchestration(workItemId, devConfig, options);
    case "finish":
      return resolveFinishOrchestration(workItemId, devConfig);
    case "forced":
      if (
        subcommand === "amend-spec" &&
        resolveStackConfig(devConfig).enabled &&
        existsSync(join(process.cwd(), "docs", "dev", workItemId, "contract.lock.json"))
      ) {
        return resolveLockedAmendSpec(workItemId, rawArgs, devConfig, plan.taskSuffix);
      }
      return resolveForcedAgentOrchestration(workItemId, plan.agentId, devConfig, {
        subcommand,
        taskSuffix: plan.taskSuffix,
      });
    default:
      return {
        outcome: "blocked",
        messages: [
          {
            level: "warning",
            text: `Subcommand /dev ${subcommand} is handled in the extension (no subagent spawn).`,
          },
        ],
      };
  }
}
