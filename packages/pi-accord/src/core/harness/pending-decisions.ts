import { discoverWorkItems } from "../telemetry/usage.js";
import type { HarnessHost } from "./types.js";

/** Notify when any work item has pending decisions (e.g. end of agent turn). */
export function notifyPendingDecisionsIfAny(host: HarnessHost): void {
  const items = discoverWorkItems();
  const totalPending = items.reduce((sum, wi) => sum + wi.decisions_pending, 0);
  if (totalPending > 0) {
    host.notify?.(
      "warning",
      `${totalPending} pending decision${totalPending > 1 ? "s" : ""} — run /dev review`,
    );
  }
}
