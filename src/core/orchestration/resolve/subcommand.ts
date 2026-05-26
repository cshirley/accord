/**
 * Map `/dev` subcommands to harness orchestration resolutions.
 */

import { parseKnownDevSubcommandArgs } from "../../commands/dispatch.js";
import type { DevHarnessConfig } from "../../config/index.js";
import type { ResumeOrchestrationResolution } from "../types.js";
import { resolveFinishOrchestration } from "./finish.js";
import { resolveForcedAgentOrchestration } from "./forced.js";
import { resolveResumeOrchestration } from "./resume.js";

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

export function resolveDevSubcommandOrchestration(
  subcommand: string,
  workItemId: string,
  rawArgs: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  const plan = planDevSubcommandOrchestration(subcommand, rawArgs);
  switch (plan.kind) {
    case "resume":
      return resolveResumeOrchestration(workItemId, devConfig);
    case "finish":
      return resolveFinishOrchestration(workItemId, devConfig);
    case "forced":
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
