/**
 * Offline Pi session transcript analysis via SessionManager (RPC get_entries / get_tree parity).
 */

import * as fs from "node:fs";
import {
  type CustomEntry,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

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

function latestHarnessMarker(entries: SessionEntry[]): HarnessMarkerData | undefined {
  let latest: HarnessMarkerData | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const custom = entry as CustomEntry<HarnessMarkerData>;
    if (custom.customType !== "dev-harness-run") continue;
    latest = custom.data ?? {};
  }
  return latest;
}

function countToolErrors(entries: SessionEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "toolResult" && message.isError) {
      count++;
    }
  }
  return count;
}

function countCompactions(entries: SessionEntry[]): number {
  return entries.filter((entry) => entry.type === "compaction").length;
}

/** Fallback for minimal / legacy JSONL without a full session header (insights export snippets). */
function parseSessionFileLegacy(sessionPath: string): SessionTranscriptSummary | null {
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const lines = fs.readFileSync(sessionPath, "utf8").split("\n");
    let entry_count = 0;
    let compaction_count = 0;
    let tool_error_count = 0;
    let harness_marker: HarnessMarkerData | undefined;
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as {
        type?: string;
        customType?: string;
        data?: HarnessMarkerData;
        message?: { role?: string; isError?: boolean };
      };
      if (entry.type === "session") continue;
      entry_count++;
      if (entry.type === "compaction") compaction_count++;
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
      branch_roots: 1,
      compaction_count,
      tool_error_count,
      harness_marker,
    };
  } catch {
    return null;
  }
}

/** Analyze a persisted Pi session JSONL (SessionManager.open — same data as RPC get_entries/get_tree). */
export function analyzeSessionTranscript(sessionPath: string): SessionTranscriptSummary | null {
  try {
    const sm = SessionManager.open(sessionPath);
    const entries = sm.getEntries();
    if (entries.length === 0) {
      return parseSessionFileLegacy(sessionPath);
    }
    const tree = sm.getTree();
    return {
      entry_count: entries.length,
      branch_roots: tree.length,
      compaction_count: countCompactions(entries),
      tool_error_count: countToolErrors(entries),
      harness_marker: latestHarnessMarker(entries),
    };
  } catch {
    return parseSessionFileLegacy(sessionPath);
  }
}

/** Read the latest dev-harness-run marker from a session file (replaces line-at-a-time JSONL scan). */
export function readHarnessMarkerFromSession(sessionPath: string): HarnessMarkerData | null {
  const summary = analyzeSessionTranscript(sessionPath);
  return summary?.harness_marker ?? null;
}
