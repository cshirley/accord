/**
 * Offline Pi session transcript analysis (JSONL scan — no Pi SDK required).
 */

import * as fs from "node:fs";

export interface HarnessMarkerData {
  harness_run_id?: string;
  harness_session_tag?: string;
  work_item_id?: string;
  work_item_ids?: string[];
  auto_provisioned?: boolean;
  updated_at?: string;
}

export interface SessionTranscriptSummary {
  entry_count: number;
  branch_roots: number;
  compaction_count: number;
  tool_error_count: number;
  harness_marker?: HarnessMarkerData;
}

function parseSessionFile(sessionPath: string): SessionTranscriptSummary | null {
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const lines = fs.readFileSync(sessionPath, "utf8").split("\n");
    let entry_count = 0;
    let compaction_count = 0;
    let tool_error_count = 0;
    let branch_roots = 0;
    let harness_marker: HarnessMarkerData | undefined;
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as {
        type?: string;
        customType?: string;
        data?: HarnessMarkerData;
        message?: { role?: string; isError?: boolean };
        parentId?: string | null;
      };
      if (entry.type === "session") continue;
      entry_count++;
      if (entry.type === "compaction") compaction_count++;
      if (entry.parentId == null && entry.type !== "custom") branch_roots++;
      if (
        entry.type === "message" &&
        entry.message?.role === "toolResult" &&
        entry.message.isError
      ) {
        tool_error_count++;
      }
      if (entry.type === "custom" && entry.customType === "dev-harness-run") {
        harness_marker = entry.data ?? {};
      }
    }
    if (entry_count === 0) return null;
    return {
      entry_count,
      branch_roots: Math.max(branch_roots, 1),
      compaction_count,
      tool_error_count,
      harness_marker,
    };
  } catch {
    return null;
  }
}

/** Analyze a persisted Pi session JSONL file. */
export function analyzeSessionTranscript(sessionPath: string): SessionTranscriptSummary | null {
  return parseSessionFile(sessionPath);
}

/** Read the latest dev-harness-run marker from a session file. */
export function readHarnessMarkerFromSession(sessionPath: string): HarnessMarkerData | null {
  const summary = analyzeSessionTranscript(sessionPath);
  return summary?.harness_marker ?? null;
}
