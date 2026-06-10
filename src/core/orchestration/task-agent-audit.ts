/**
 * Persist validated subagent return packets (and prose analysis) on per-task JSON
 * for audit and orchestrator consumption.
 */

import {
  extractAnalysisFromSubagentResult,
  extractReturnPacketFromSubagentResult,
} from "../subagent/result/packet.js";
import { advancePrimaryTask } from "./post-result/primary-task.js";
import {
  isReviewReturnPacket,
  persistLastReviewFeedback,
  type ReviewReturnPacket,
} from "./review-feedback.js";

export interface TaskAgentReturn {
  agent: string;
  at: string;
  /** Task `phase` when the return was recorded. */
  task_phase?: string;
  packet: Record<string, unknown>;
  /** Prose analysis from the subagent (assistant text before the JSON fence, or packet.analysis). */
  analysis?: string;
}

export interface PostResultAuditContext {
  /** Narrative analysis extracted from the subagent assistant message. */
  analysisText?: string;
}

const ADVERSARIAL_REVIEW_AGENTS = new Set(["review-test", "review-code"]);

function clonePacket(packet: unknown): Record<string, unknown> {
  if (!packet || typeof packet !== "object") {
    return {};
  }
  return JSON.parse(JSON.stringify(packet)) as Record<string, unknown>;
}

function resolveAnalysisText(
  packet: Record<string, unknown>,
  analysisText?: string,
): string | undefined {
  const fromPacket = packet.analysis;
  if (typeof fromPacket === "string" && fromPacket.trim().length > 0) {
    return fromPacket.trim();
  }
  const fromAssistant = analysisText?.trim();
  if (fromAssistant && fromAssistant.length > 0) {
    return fromAssistant;
  }
  return undefined;
}

function appendAgentReturn(task: Record<string, unknown>, entry: TaskAgentReturn): void {
  const existing = Array.isArray(task.agent_returns) ? [...(task.agent_returns as unknown[])] : [];
  existing.push(entry);
  task.agent_returns = existing;
}

/**
 * Records a validated return packet on the primary task file. Review agents also refresh
 * `last_review_feedback` so the orchestrator can route retries from task state alone.
 */
export function persistValidatedAgentReturn(
  workItemId: string,
  agent: string,
  packet: unknown,
  audit?: PostResultAuditContext,
): boolean {
  const packetRecord = clonePacket(packet);
  const analysis = resolveAnalysisText(packetRecord, audit?.analysisText);

  return advancePrimaryTask(workItemId, ({ task, timestamp }) => {
    const taskPhase = typeof task.phase === "string" ? task.phase : undefined;

    appendAgentReturn(task, {
      agent,
      at: timestamp,
      task_phase: taskPhase,
      packet: packetRecord,
      ...(analysis ? { analysis } : {}),
    });

    if (ADVERSARIAL_REVIEW_AGENTS.has(agent) && isReviewReturnPacket(packet)) {
      persistLastReviewFeedback(
        task,
        agent as "review-test" | "review-code",
        packet as ReviewReturnPacket,
        timestamp,
        { analysis, packet: packetRecord },
      );
    }

    return {};
  });
}

/** Extract analysis + packet from a raw subagent tool result row. */
export function extractSubagentReturnAudit(result: unknown): {
  packet: Record<string, unknown> | null;
  analysisText?: string;
} {
  const packet = extractReturnPacketFromSubagentResult(result);
  const analysisText = extractAnalysisFromSubagentResult(result);
  return {
    packet,
    ...(analysisText ? { analysisText } : {}),
  };
}

export { ADVERSARIAL_REVIEW_AGENTS };
