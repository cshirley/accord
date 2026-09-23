/**
 * Merge per-task events from validated return packets onto the primary task file.
 */

import { advancePrimaryTask } from "../orchestration/post-result/primary-task.js";

function isTaskEvent(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.type === "string" && typeof record.at === "string";
}

export function extractTaskEventsFromPacket(packet: unknown): Record<string, unknown>[] {
  if (!packet || typeof packet !== "object") {
    return [];
  }
  const events = (packet as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    return [];
  }
  return events.filter(isTaskEvent);
}

/**
 * Appends packet `events[]` to the primary per-task file before promotion handlers run.
 * @returns true when at least one event was merged.
 */
export function applyTaskEventsFromPacket(workItemId: string, packet: unknown): boolean {
  const incoming = extractTaskEventsFromPacket(packet);
  if (incoming.length === 0) {
    return false;
  }

  return advancePrimaryTask(workItemId, ({ task }) => {
    const existing = Array.isArray(task.events) ? [...(task.events as unknown[])] : [];
    task.events = [...existing, ...incoming];
    return {};
  });
}
