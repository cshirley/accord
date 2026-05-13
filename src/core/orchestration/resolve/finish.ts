/**
 * `/dev finish` — deterministic closeout: blockers check, then `phase-verify-acceptance` spawn plan.
 */

import { agentRequiresConfig, getAgentMeta } from "../../agents/registry.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { loadWorkItem } from "../../work-items/io.js";
import type { WorkItem } from "../../work-items/types.js";
import type { ResumeOrchestrationResolution } from "../types.js";

const VERIFY_AGENT = "phase-verify-acceptance";

function workItemHasFinishBlockers(wi: WorkItem): string | null {
  const pendingDecisions = (wi.decisions ?? []).filter((d) => d.status === "pending");
  const pendingDeviations = (wi.deviations ?? []).filter(
    (d) => !d.status || d.status === "pending",
  );
  if (pendingDecisions.length === 0 && pendingDeviations.length === 0) {
    return null;
  }
  const lines: string[] = ["Resolve on this work item before `/dev finish`:"];
  for (const d of pendingDecisions) {
    lines.push(`- Decision (${d.id}): ${d.question}`);
  }
  for (const d of pendingDeviations) {
    lines.push(`- Deviation (task ${String(d.task_id)}): ${d.description}`);
  }
  return lines.join("\n");
}

function buildFinishVerifyAcceptanceTask(input: {
  workItemId: string;
  specPath: string;
  planPath: string;
  briefPath: string;
}): string {
  return [
    "ACCORD harness finish — spawn **phase-verify-acceptance**.",
    "",
    `work_item_id: ${input.workItemId}`,
    `spec_path: ${input.specPath}`,
    `plan_path: ${input.planPath}`,
    `brief_path: ${input.briefPath}`,
    "",
    "Run your full acceptance verification per the agent contract, then write `verify.json` beside the spec.",
  ].join("\n");
}

/**
 * Plans `/dev finish <ID>`: blocks on pending decisions/deviations for this work item,
 * requires spec/plan/brief paths, then resolves to a **phase-verify-acceptance** spawn when configured.
 */
export function resolveFinishOrchestration(
  workItemId: string,
  devConfig: DevHarnessConfig | null,
): ResumeOrchestrationResolution {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return {
      outcome: "forward_skill",
      reason: `Work item "${workItemId}" not found — delegate to accord skill.`,
    };
  }

  if (wi.terminal_outcome && wi.completed_at) {
    return {
      outcome: "complete",
      messages: [
        {
          level: "info",
          text: `Work item ${workItemId} is already terminal (${wi.terminal_outcome}). Nothing to finish.`,
        },
      ],
    };
  }

  const blocker = workItemHasFinishBlockers(wi);
  if (blocker) {
    return {
      outcome: "blocked",
      messages: [{ level: "warning", text: blocker }],
    };
  }

  if (!wi.spec || !wi.plan || !wi.brief) {
    const missing = [!wi.spec && "spec", !wi.plan && "plan", !wi.brief && "brief"].filter(Boolean);
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: `Finish needs spec, plan, and brief paths on the work item. Missing: ${missing.join(", ") || "unknown"}.`,
        },
      ],
    };
  }

  if (!getAgentMeta(VERIFY_AGENT)) {
    return {
      outcome: "forward_skill",
      reason: `Agent "${VERIFY_AGENT}" is not registered — delegate to accord skill.`,
    };
  }

  if (agentRequiresConfig(VERIFY_AGENT) && !devConfig) {
    return {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: "No ACCORD config found. Run /dev init to configure before running finish (verify-acceptance needs harness commands).",
        },
      ],
    };
  }

  const task = buildFinishVerifyAcceptanceTask({
    workItemId,
    specPath: wi.spec,
    planPath: wi.plan,
    briefPath: wi.brief,
  });

  return {
    outcome: "spawn",
    workItemId,
    agent: VERIFY_AGENT,
    task,
  };
}
