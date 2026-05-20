/**
 * ACCORD orchestration UI helpers for programmatic subagent spawns.
 */

import {
  looksLikeToolActivityLine,
  type SubagentProgress,
} from "../../../integrations/pi-subagent.js";

/** Heartbeat interval while orchestration spawns run (status line + widget repaint). */
export const ORCHESTRATOR_SPAWN_HEARTBEAT_MS = 500;

export function formatOrchestratorSpawnElapsed(startedAt: number, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
}

function hasToolActivity(progress: SubagentProgress): boolean {
  if (progress.recentToolLines.length > 0) {
    return true;
  }
  return progress.activityLines.some(looksLikeToolActivityLine);
}

export function formatOrchestratorStallHint(
  progress: SubagentProgress,
  startedAt: number,
  now = Date.now(),
): string | undefined {
  const elapsedSec = Math.floor((now - startedAt) / 1000);
  if (elapsedSec < 4) {
    return undefined;
  }
  if (hasToolActivity(progress)) {
    return undefined;
  }
  const preview = progress.textPreview?.trim();
  if (preview) {
    return preview.length > 72 ? `composing… ${preview.slice(0, 72)}…` : `composing… ${preview}`;
  }
  return `waiting for model response…`;
}

export function formatOrchestratorProgressWidgetLines(
  label: string,
  agent: string,
  progress: SubagentProgress,
  options?: { startedAt?: number; now?: number },
): string[] {
  const lines = [`${label}: ${agent} · turn ${String(progress.turns)}`];
  const activityTail = progress.activityLines.slice(-5);
  if (activityTail.length > 0) {
    for (const activityLine of activityTail) {
      lines.push(activityLine.startsWith("→") ? activityLine : `→ ${activityLine}`);
    }
  } else if (progress.lastToolLine) {
    lines.push(`→ ${progress.lastToolLine}`);
  }

  if (progress.activeToolOutput) {
    lines.push(`   ${progress.activeToolOutput}`);
  } else if (options?.startedAt !== undefined) {
    const stallHint = formatOrchestratorStallHint(progress, options.startedAt, options.now);
    if (stallHint) {
      lines.push(`→ ${stallHint}`);
    }
  } else if (progress.textPreview) {
    lines.push(progress.textPreview);
  } else if (activityTail.length === 0 && !progress.lastToolLine) {
    lines.push("(waiting for subagent — tools and output appear here)");
  }

  return lines;
}
