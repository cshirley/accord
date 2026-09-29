/**
 * Agent `events[]` from return packets. On the v2 task file they are stored on the agent's log
 * entry (see `src/tasks/record.ts`); promotion to the work item reads them from there.
 */

import { packetEvents } from "../tasks/record.js";
import type { TaskEvent } from "../tasks/types.js";

export function extractTaskEventsFromPacket(packet: unknown): TaskEvent[] {
  if (!packet || typeof packet !== "object") {
    return [];
  }
  return packetEvents(packet as Record<string, unknown>);
}
