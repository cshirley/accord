/**
 * Line styling for `/dev tasks` dashboard output (rendered via dev-formatted-display).
 */

import type { Theme } from "@earendil-works/pi-coding-agent";

const INDENT = "  ";

export type TasksDashboardLineKind =
  | "title"
  | "section"
  | "header"
  | "dash"
  | "attention"
  | "muted"
  | "hint"
  | "legend"
  | "row"
  | "empty";

export type TasksDashboardMessageDetails = {
  formatted: string;
};

/** Classify a dashboard text line for themed rendering (testable without a TUI). */
export function classifyTasksDashboardLine(line: string): TasksDashboardLineKind {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return "empty";
  if (trimmed.startsWith("Work items")) return "title";
  if (trimmed === "Active" || trimmed === "Done") return "section";
  if (trimmed.startsWith("ID")) return "header";
  if (trimmed === "—") return "dash";
  if (trimmed.startsWith("Needs attention")) return "attention";
  if (trimmed.startsWith("No items need review")) return "muted";
  if (trimmed.startsWith(INDENT) && trimmed.includes("/dev")) return "hint";
  if (trimmed.startsWith(`${INDENT}tasks:`)) return "legend";
  if (/^\s+\d+ work item/.test(line)) return "title";
  if (/^[A-Z][A-Z0-9_-]+/.test(trimmed)) return "row";
  return "title";
}

export function styleTasksDashboardLine(theme: Theme, line: string): string {
  const trimmed = line.trimEnd();
  const kind = classifyTasksDashboardLine(line);
  if (kind === "empty") return "";

  switch (kind) {
    case "title":
      return theme.bold(theme.fg("text", trimmed));
    case "section":
      return theme.bold(theme.fg("accent", trimmed));
    case "header":
      return theme.bold(theme.fg("toolTitle", trimmed));
    case "dash":
      return theme.fg("border", trimmed);
    case "attention":
      return theme.bold(theme.fg("warning", trimmed));
    case "muted":
      return theme.fg("muted", trimmed);
    case "hint":
      return theme.fg("accent", trimmed.slice(INDENT.length));
    case "legend":
      return theme.fg("dim", trimmed);
    case "row":
      return theme.fg("toolOutput", trimmed);
    default:
      return theme.fg("text", trimmed);
  }
}
