/**
 * Rich resume task bodies for multi-turn **phase-spec** and **phase-plan** agents.
 */

import { devCheckpointRead } from "../../work-items/checkpoint.js";
import { loadWorkItem } from "../../work-items/io.js";
import { buildAnsweredMapForInterview } from "../post-result/needs-input.js";
import { buildResumeTaskBrief } from "./resume.js";

const INTERVIEW_AGENT_BY_PHASE: Readonly<Record<string, string>> = {
  speccing: "phase-spec",
  planning: "phase-plan",
};

function artifactPathForPhase(
  wi: NonNullable<ReturnType<typeof loadWorkItem>>,
  phase: string,
): string | undefined {
  if (phase === "speccing") {
    return wi.brief?.trim() || undefined;
  }
  if (phase === "planning") {
    return wi.spec?.trim() || undefined;
  }
  return undefined;
}

export function buildInterviewResumeTaskIfApplicable(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
}): string | null {
  const expectedAgent = INTERVIEW_AGENT_BY_PHASE[input.phase];
  if (!expectedAgent || input.dispatchAgent !== expectedAgent) {
    return null;
  }

  const wi = loadWorkItem(input.workItemId);
  const cp = devCheckpointRead(input.workItemId);
  const answered = buildAnsweredMapForInterview(input.workItemId);
  const artifactPath = wi ? artifactPathForPhase(wi, input.phase) : undefined;

  const lines = [
    `ACCORD harness — ${input.dispatchAgent} (orchestrator).`,
    "",
    `work_item_id: ${input.workItemId}`,
    `work_item_phase: ${input.phase}`,
    `pattern: ${input.pattern}`,
    ...(input.variant ? [`variant: ${input.variant}`] : []),
    `title: ${input.title}`,
  ];

  if (input.phase === "speccing" && artifactPath) {
    lines.push(`brief_path: ${artifactPath}`);
  }
  if (input.phase === "planning") {
    if (wi?.brief?.trim()) {
      lines.push(`brief_path: ${wi.brief.trim()}`);
    }
    if (artifactPath) {
      lines.push(`spec_path: ${artifactPath}`);
    }
  }

  lines.push(
    "",
    "draft:",
    "```json",
    JSON.stringify(cp?.draft ?? {}, null, 2),
    "```",
    "",
    "answered:",
    "```json",
    JSON.stringify(answered, null, 2),
    "```",
    "",
    `pending question ids: ${(cp?.pending ?? []).join(", ") || "(none)"}`,
    "",
    input.phase === "speccing"
      ? "Write `docs/dev/<work_item_id>/spec.json` when converged (`status: done`)."
      : "Write `docs/dev/<work_item_id>/plan.json` when converged (`status: done`).",
    "Return the structured result packet required by your agent contract.",
  );

  return lines.join("\n");
}

export function buildInterviewResumeTaskOrGeneric(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
}): string {
  return (
    buildInterviewResumeTaskIfApplicable(input) ??
    buildResumeTaskBrief({
      workItemId: input.workItemId,
      phase: input.phase,
      title: input.title,
      pattern: input.pattern,
      variant: input.variant,
      dispatchAgent: input.dispatchAgent,
    })
  );
}
