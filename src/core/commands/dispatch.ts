/**
 * Command dispatch — deterministic routing for /dev subcommands.
 */

import * as path from "node:path";
import { devTasks } from "../queries/dashboard.js";
import { listWorkItemFiles, readJson, TASKS_DIR } from "../work-items/io.js";
import type { WorkItem } from "../work-items/types.js";

export type EmptyInputRoute =
  | { route: "help" }
  | { route: "suggest_resume"; id: string; title: string; phase: string }
  | { route: "dashboard"; formatted: string };

export type SubcommandRoute =
  | { type: "known"; subcommand: string; args: string }
  | { type: "empty"; route: EmptyInputRoute }
  | { type: "classify"; text: string };

/** Canonical subcommand definitions — drives both dispatch and tab-completion. */
export const DEV_SUBCOMMANDS: { value: string; description: string }[] = [
  // Happy-path workflow order first; autocomplete preserves this order.
  { value: "init", description: "Detect stack & configure ACCORD" },
  { value: "align", description: "Frame the problem before spec" },
  { value: "spec", description: "Write/refine a spec" },
  { value: "plan", description: "Generate an implementation plan" },
  { value: "resume", description: "Resume a work item" },
  { value: "finish", description: "Run deterministic post-implementation closeout" },
  { value: "check", description: "Run lower-level acceptance checks" },
  { value: "gaps", description: "Find gaps in a step" },
  { value: "review", description: "Decision queue" },
  { value: "deviations", description: "Check deviations from spec" },
  { value: "amend-spec", description: "Amend the spec" },
  { value: "spec-gaps", description: "Find spec gaps" },
  { value: "tasks", description: "Task dashboard" },
  {
    value: "retro",
    description: "Retrospective over harness sessions and shift-left opportunities",
  },
  {
    value: "tag",
    description: "Label this session for usage analytics (/dev tag [--new] <label>, --clear)",
  },
  { value: "help", description: "Show usage" },
];

/** Split on first run of flags so multi-word labels stay intact. */
export function parseHarnessTagArgs(
  raw: string,
): { mode: "show" } | { mode: "clear" } | { mode: "set"; label: string; newRunId: boolean } {
  const t = raw.trim();
  if (!t) return { mode: "show" };
  if (t === "--clear") return { mode: "clear" };
  if (t.startsWith("--new ") && t.length > 6) {
    return { mode: "set", label: t.slice(6).trim(), newRunId: true };
  }
  if (t === "--new") {
    return { mode: "set", label: "", newRunId: true };
  }
  return { mode: "set", label: t, newRunId: false };
}

const KNOWN_SUBCOMMANDS = new Set([...DEV_SUBCOMMANDS.map((s) => s.value), "-h", "--help", "?"]);

export function devDispatch(input: string): SubcommandRoute {
  const trimmed = input.trim();
  if (!trimmed) return { type: "empty", route: devEmptyInputRoute() };

  const parts = trimmed.split(/\s+/);
  const first = parts[0].toLowerCase();

  if (KNOWN_SUBCOMMANDS.has(first)) {
    const sub = ["-h", "--help", "?"].includes(first) ? "help" : first;
    return { type: "known", subcommand: sub, args: parts.slice(1).join(" ") };
  }

  return { type: "classify", text: trimmed };
}

export function devEmptyInputRoute(): EmptyInputRoute {
  const files = listWorkItemFiles();
  if (files.length === 0) return { route: "help" };

  if (files.length === 1) {
    const wi = readJson<WorkItem>(path.join(TASKS_DIR, files[0]));
    if (wi) return { route: "suggest_resume", id: wi.id, title: wi.title, phase: wi.phase };
  }

  return { route: "dashboard", formatted: devTasks().formatted };
}
