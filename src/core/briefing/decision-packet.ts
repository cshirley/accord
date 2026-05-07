/**
 * Decision packet formatting.
 */

import { loadWorkItem } from "../work-items/io.js";

export function devDecisionPacket(
  workItemId: string,
  opts: { state_label: string; fields: Record<string, string>; next_action: string },
): string {
  const wi = loadWorkItem(workItemId);
  const pendingCount = (wi?.decisions || []).filter(d => d.status === "pending").length;

  const lines: string[] = [];
  lines.push(`${(wi?.pattern || "").toUpperCase()} ${opts.state_label}`);
  for (const [key, val] of Object.entries(opts.fields)) {
    lines.push(`  ${key}: ${val}`);
  }
  lines.push(`  Ready for: ${opts.next_action}`);
  if (pendingCount > 0) lines.push(`\nPending decisions: ${pendingCount} — run /dev review.`);
  return lines.join("\n");
}
