/**
 * Block phase agents from mutating orchestrator-owned workflow state on disk.
 */

import { isOrchestratorOwnedWorkflowStatePath } from "./workflow-state-paths.js";

/** When true, agents may write work-item / per-task / checkpoint JSON (legacy). */
export function allowAgentWorkflowStateWrites(): boolean {
  const raw = process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function formatWorkflowStateWriteBlockedMessage(filePath: string): string {
  return [
    `Orchestrator-owned workflow state — agents must not write ${filePath}.`,
    "",
    "Return structured data in your fenced ```json return packet instead:",
    "- Work item phase / artifact paths → orchestrator applies via post-result handlers",
    "- Per-task `events[]` → include `events` in the return packet",
    "- Checkpoints → orchestrator manages via `dev_checkpoint` / resume",
    "",
    "Set ACCORD_ALLOW_AGENT_WORKFLOW_WRITES=1 only for legacy agent runs.",
  ].join("\n");
}

export function validateWorkflowStateWrite(
  filePath: string | undefined,
): { blocked: false } | { blocked: true; message: string } {
  if (!filePath || allowAgentWorkflowStateWrites()) {
    return { blocked: false };
  }
  if (!isOrchestratorOwnedWorkflowStatePath(filePath)) {
    return { blocked: false };
  }
  return { blocked: true, message: formatWorkflowStateWriteBlockedMessage(filePath) };
}
