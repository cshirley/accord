/**
 * `/dev gaps` — surface verification gaps from verify.json (deterministic).
 */

import { devVerifySummary } from "./verify-summary.js";
import { err, ok, type Result } from "../types/result.js";

export interface DevGapsResult {
  verdict: string;
  gap_count: number;
  formatted: string;
  /** When true, caller should spawn `phase-gaps` (e.g. `--tickets`). */
  spawn_tickets: boolean;
}

export function devGaps(
  workItemId: string,
  options?: { spawnTickets?: boolean },
): Result<DevGapsResult> {
  const summary = devVerifySummary(workItemId);
  if (!summary.ok) return err(summary.error);

  const { gaps, verdict, formatted } = summary.value;
  const lines = [`${workItemId} — verification gaps\n`, formatted];

  if (gaps.length === 0) {
    lines.push("", "No open gaps in the verify report.");
    if (verdict !== "pass") {
      lines.push("Re-run `/dev finish` or `/dev check` if you expected failing criteria.");
    }
  } else if (!options?.spawnTickets) {
    lines.push(
      "",
      `${gaps.length} gap(s) listed above.`,
      "To propose Jira follow-up tickets, run:",
      `  /dev gaps ${workItemId} --tickets`,
    );
  } else {
    lines.push("", "Spawning phase-gaps to propose/create follow-up tickets…");
  }

  return ok({
    verdict,
    gap_count: gaps.length,
    formatted: lines.join("\n"),
    spawn_tickets: Boolean(options?.spawnTickets),
  });
}

export function gapsArgsWantTickets(rawArgs: string): boolean {
  return /\B--tickets\b/.test(rawArgs);
}
