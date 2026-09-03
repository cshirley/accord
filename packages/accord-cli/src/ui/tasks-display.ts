/**
 * Colored rendering for the tasks dashboard (`devTasks().formatted`).
 */

import type { TasksDashboardResult } from "@clive.shirley/accord-core/queries/dashboard.js";
import { accent, bold, dim, error, heading, muted, success, warn } from "./colors.js";

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

export function classifyTasksDashboardLine(line: string): TasksDashboardLineKind {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return "empty";
  if (trimmed.startsWith("Work items")) return "title";
  if (trimmed === "Active" || trimmed === "Done") return "section";
  if (trimmed.startsWith("ID")) return "header";
  if (trimmed === "—") return "dash";
  if (trimmed.startsWith("Needs attention")) return "attention";
  if (trimmed.startsWith("No items need review")) return "muted";
  if (trimmed.startsWith(INDENT) && (trimmed.includes("/dev") || trimmed.includes("accord"))) {
    return "hint";
  }
  if (trimmed.startsWith(`${INDENT}tasks:`)) return "legend";
  if (/^\s+\d+ work item/.test(line)) return "title";
  if (/^[A-Z][A-Z0-9_-]+/.test(trimmed)) return "row";
  return "title";
}

export function styleTasksDashboardLine(line: string): string {
  const trimmed = line.trimEnd();
  const kind = classifyTasksDashboardLine(line);
  if (kind === "empty") return "";

  switch (kind) {
    case "title":
      return heading(trimmed);
    case "section":
      return accent(bold(trimmed));
    case "header":
      return bold(dim(trimmed));
    case "dash":
      return dim(trimmed);
    case "attention":
      return warn(bold(trimmed));
    case "muted":
      return muted(trimmed);
    case "hint":
      return accent(trimmed.slice(INDENT.length));
    case "legend":
      return dim(trimmed);
    case "row":
      return styleDashboardRow(trimmed);
    default:
      return trimmed;
  }
}

function styleDashboardRow(line: string): string {
  const idMatch = /^([A-Z][A-Z0-9_-]+)/.exec(line);
  if (!idMatch) return line;
  const id = idMatch[1];
  const rest = line.slice(id.length);
  let styledRest = rest;
  if (rest.includes("done")) styledRest = rest.replace("done", success("done"));
  if (rest.includes("b")) styledRest = styledRest.replace(/(\d+)b/, `${warn("$1")}b`);
  if (rest.includes("!")) styledRest = styledRest.replace(/![\w,]+/, (match) => error(match));
  return `${accent(id)}${styledRest}`;
}

export function renderTasksDashboard(dashboard: TasksDashboardResult): string {
  const lines = dashboard.formatted
    .replaceAll("/dev", "accord")
    .split("\n")
    .map((line) => styleTasksDashboardLine(line))
    .filter((line) => line.length > 0);
  return lines.join("\n");
}

export function renderTasksDashboardHeader(dashboard: TasksDashboardResult): string {
  const active = dashboard.rows.filter((row) => !row.completed_at).length;
  const done = dashboard.rows.filter((row) => row.completed_at).length;
  const parts = [`${String(dashboard.rows.length)} item${dashboard.rows.length === 1 ? "" : "s"}`];
  if (active > 0) parts.push(`${String(active)} active`);
  if (done > 0) parts.push(`${String(done)} done`);
  if (dashboard.total_cost > 0) parts.push(`$${dashboard.total_cost.toFixed(2)}`);
  return heading("ACCORD") + dim(` · tasks · ${parts.join(" · ")}`);
}
