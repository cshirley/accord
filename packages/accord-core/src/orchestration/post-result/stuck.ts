/**
 * Universal handling for any phase agent returning `status: "stuck"`.
 *
 * Every return schema that supports `stuck` requires the same shape
 * (`question` + `context`, optional `tried`) regardless of agent. Unlike the
 * multi-turn `needs_input` interview loop (see `needs-input.ts`), a stuck
 * packet carries no question `id` and needs no checkpoint/draft continuity —
 * it's a single escalation that must land in `decisions[]` so it isn't lost,
 * then the agent simply respawns once answered.
 *
 * Called unconditionally in `subagent/result/process.ts` for every agent,
 * independent of whether the rest of the packet passes schema validation —
 * losing a stuck agent's question behind an unrelated validation error would
 * silently strand the work item with no record of why.
 */

import { loadWorkItem, now, workItemJsonPath, writeJson } from "../../work-items/io.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function isStuckPacket(packet: unknown): boolean {
  return asRecord(packet)?.status === "stuck";
}

/**
 * Promotes a `stuck` packet's `question`/`context`/`tried` into `decisions[]`
 * (idempotent per identical pending question) and returns a human-readable handoff.
 * No-op (returns `""`) when the packet isn't `stuck`, has no `question`, or the
 * work item can't be loaded.
 */
export function applyStuckPostResult(workItemId: string, agent: string, packet: unknown): string {
  if (!isStuckPacket(packet)) {
    return "";
  }
  const record = asRecord(packet);
  const question = typeof record?.question === "string" ? record.question.trim() : "";
  if (!question) {
    return "";
  }
  const context = typeof record?.context === "string" ? record.context.trim() : "";
  const tried = typeof record?.tried === "string" ? record.tried.trim() : "";

  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return "";
  }

  const decisions = wi.decisions ?? [];
  const alreadyPending = decisions.some(
    (d) => d.source === "escalation" && d.status === "pending" && d.question === question,
  );
  if (alreadyPending) {
    return "";
  }

  const ordinal = decisions.filter((d) => d.id.startsWith(`${agent}-stuck-`)).length + 1;
  const id = `${agent}-stuck-${String(ordinal)}`;
  const timestamp = now();
  const wiPath = workItemJsonPath(workItemId);

  decisions.push({
    id,
    source: "escalation",
    status: "pending",
    question,
    context: [context, tried ? `Tried: ${tried}` : ""].filter(Boolean).join("\n") || undefined,
    phase: wi.phase,
    asked_at: timestamp,
  });
  wi.decisions = decisions;
  wi.updated = timestamp;
  writeJson(wiPath, wi);

  return [
    "",
    `\u23f8 **${agent} is stuck** and needs your input.`,
    "",
    `Promoted to \`decisions[]\` in \`${wiPath}\` as \`${id}\`.`,
    `- question: ${question}`,
    context ? `- context: ${context}` : "",
    tried ? `- tried: ${tried}` : "",
    "",
    `Headless: \`accord answer ${workItemId} ${id} "answer"\`, then \`accord resume ${workItemId}\`.`,
    `In Pi: \`/dev answer ${workItemId} ${id} "answer"\` (or reply in chat), then \`/dev resume ${workItemId}\`.`,
  ]
    .filter(Boolean)
    .join("\n");
}
