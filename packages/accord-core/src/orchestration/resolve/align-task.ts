/**
 * Task bodies for **phase-align** and **phase-gather** during the aligning coarse phase.
 */

import { loadGlobalConfig, mergeContextSources } from "../../config/global.js";
import type { DevHarnessConfig } from "../../config/index.js";
import { devCheckpointRead } from "../../work-items/checkpoint.js";
import { enrichmentsDirRelForWorkItem, loadWorkItem } from "../../work-items/io.js";
import { buildResumeTaskBrief } from "./resume.js";

export interface AlignGatherHint {
  ticket_id?: string;
  reason?: string;
}

function workItemDescription(wi: ReturnType<typeof loadWorkItem>): string {
  if (!wi) return "";
  const finish = typeof wi.expected_finish === "string" ? wi.expected_finish.trim() : "";
  if (finish) return finish;
  const title = typeof wi.title === "string" ? wi.title.trim() : "";
  return title;
}

/**
 * Outbound task for **phase-gather** when align returned `needs_gather`.
 */
export function buildGatherSpawnTask(
  workItemId: string,
  gatherHint: AlignGatherHint | undefined,
  devConfig: DevHarnessConfig | null,
): string {
  const wi = loadWorkItem(workItemId);
  const globalCfg = loadGlobalConfig();
  const mergedSources = mergeContextSources(globalCfg?.context_sources, devConfig?.context_sources);

  const ticketId = gatherHint?.ticket_id?.trim() || workItemId;
  const lines = [
    "ACCORD harness — phase-gather (orchestrator).",
    "",
    `work_item_id: ${workItemId}`,
    `tracker: { "type": "jira" }`,
    ...(gatherHint?.reason ? [`gather_reason: ${gatherHint.reason}`] : []),
    ...(workItemDescription(wi) ? [`description: ${workItemDescription(wi)}`] : []),
    "",
    `Fetch ticket **${ticketId}** (summary, description, acceptance criteria, links).`,
    `Write enrichment cache under \`${enrichmentsDirRelForWorkItem(workItemId)}/\` (same \`.tasks/\` tree as the work item JSON).`,
    "Return status `done` with a factual `context` summary and enrichment references.",
    "",
    ...(mergedSources.length > 0
      ? ["context_sources:", "```json", JSON.stringify(mergedSources, null, 2), "```", ""]
      : []),
    "Return the structured result packet required by your agent contract.",
  ];
  return lines.join("\n");
}

/**
 * Rich align task with checkpoint + optional inline gather_result (orchestrator-owned).
 */
export function buildAlignSpawnTask(input: {
  workItemId: string;
  title: string;
  pattern: string;
  variant?: string;
  devConfig: DevHarnessConfig | null;
  gatherResult?: Record<string, unknown>;
  description?: string;
}): string {
  const wi = loadWorkItem(input.workItemId);
  const cp = devCheckpointRead(input.workItemId);
  const description = input.description?.trim() || workItemDescription(wi) || input.title;

  const lines = [
    "ACCORD harness — phase-align (orchestrator).",
    "",
    `work_item_id: ${input.workItemId}`,
    `description: ${description}`,
    `pattern: ${input.pattern}`,
    ...(input.variant ? [`variant: ${input.variant}`] : []),
    `title: ${input.title}`,
  ];

  if (input.gatherResult && Object.keys(input.gatherResult).length > 0) {
    lines.push("", "gather_result:", "```json", JSON.stringify(input.gatherResult, null, 2), "```");
  }

  if (cp) {
    const answeredMap: Record<string, string> = {};
    for (const id of cp.answered ?? []) {
      answeredMap[id] = "";
    }
    lines.push(
      "",
      "draft:",
      "```json",
      JSON.stringify(cp.draft ?? {}, null, 2),
      "```",
      "",
      "answered:",
      "```json",
      JSON.stringify(answeredMap, null, 2),
      "```",
      "",
      `pending reflection ids: ${(cp.pending ?? []).join(", ") || "(none)"}`,
    );
  } else {
    lines.push("", "draft: {}", "", "answered: {}");
  }

  lines.push(
    "",
    "Produce `docs/dev/<work_item_id>/brief.md` when converged (`status: done`).",
    "Return the structured result packet required by your agent contract.",
  );

  return lines.join("\n");
}

/** Align resume spawn when coarse phase is `aligning`; otherwise use generic brief. */
export function buildAlignResumeTaskIfApplicable(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
  devConfig: DevHarnessConfig | null;
  gatherResult?: Record<string, unknown>;
}): string | null {
  if (input.dispatchAgent !== "phase-align" || input.phase !== "aligning") {
    return null;
  }
  return buildAlignSpawnTask({
    workItemId: input.workItemId,
    title: input.title,
    pattern: input.pattern,
    variant: input.variant,
    devConfig: input.devConfig,
    gatherResult: input.gatherResult,
  });
}

export function buildAlignResumeTaskOrGeneric(input: {
  workItemId: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  dispatchAgent: string;
  devConfig: DevHarnessConfig | null;
  gatherResult?: Record<string, unknown>;
}): string {
  return (
    buildAlignResumeTaskIfApplicable(input) ??
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
