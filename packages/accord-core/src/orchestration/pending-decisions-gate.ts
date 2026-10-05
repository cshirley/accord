/**
 * Blocks `/dev resume` / `accord resume` from spawning implementation-pipeline agents
 * (`phase-test`, `phase-code`, `review-test`, `review-code`, `phase-verify-task`) while
 * the work item has an unanswered `decisions[]` entry.
 *
 * None of those agents can read or resolve `decisions[]` themselves \u2014 unlike
 * `phase-align`/`phase-spec`/`phase-plan` (which either ask the question or consume the
 * answer via their own interview loop), a pending decision left open during implementation
 * would otherwise be silently ignored: the agent just keeps writing code/tests with no
 * idea a question is open. Default is a hard block; pass `allowPendingDecisions: true`
 * (`--allow-pending-decisions` on the CLI, `/dev resume <ID> --allow-pending-decisions`
 * in Pi) to bypass \u2014 e.g. when the pending decision is known to be unrelated to the
 * next task.
 */

import { workItemJsonPath } from "../work-items/tasks-dir.js";
import type { Decision, WorkItem } from "../work-items/types.js";
import type { OrchestrationMessage } from "./types.js";

/** Task-scoped implement-pipeline agents that have no mechanism to consume `decisions[]`. */
export const PENDING_DECISIONS_GATE_AGENTS: ReadonlySet<string> = new Set([
  "phase-test",
  "phase-code",
  "review-test",
  "review-code",
  "phase-verify-task",
]);

function pendingDecisions(wi: WorkItem): Decision[] {
  return (wi.decisions ?? []).filter((d) => d.status === "pending");
}

function formatPendingDecisionsBlockMessage(
  workItemId: string,
  agent: string,
  pending: Decision[],
): string {
  const wiPath = workItemJsonPath(workItemId);
  const lines = [
    `Resume blocked: ${String(pending.length)} pending decision(s) on ${workItemId} \u2014 **${agent}** has no way to see or act on them.`,
    "",
  ];
  for (const d of pending) {
    lines.push(`- \`${d.id}\` (${d.source}): ${d.question}`);
  }
  lines.push(
    "",
    `Answer with \`accord answer ${workItemId} <decision-id> "answer"\` (or \`/dev answer\` in Pi; stored in \`decisions[]\` of \`${wiPath}\`), then re-run \`accord resume ${workItemId}\` (or \`/dev resume ${workItemId}\`).`,
    "",
    "To proceed anyway (the pending decision is unrelated to the next step): add `--allow-pending-decisions` to the resume command.",
  );
  return lines.join("\n");
}

/**
 * Returns a blocking message when `agent` is a gated implement-pipeline agent and the
 * work item has pending decisions, unless `allowPendingDecisions` is set. Returns `null`
 * when resume should proceed.
 */
export function pendingDecisionsGateMessage(
  wi: WorkItem,
  agent: string,
  allowPendingDecisions?: boolean,
): OrchestrationMessage | null {
  if (allowPendingDecisions) return null;
  if (!PENDING_DECISIONS_GATE_AGENTS.has(agent)) return null;

  const pending = pendingDecisions(wi);
  if (pending.length === 0) return null;

  return {
    level: "warning",
    text: formatPendingDecisionsBlockMessage(wi.id, agent, pending),
  };
}
