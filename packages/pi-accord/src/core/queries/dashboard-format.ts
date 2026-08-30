/**
 * Format `/dev tasks` dashboard as fixed-width tables for TUI notify.
 */

import type { TasksDashboardRow } from "./dashboard.js";

const INDENT = "  ";
/** Visible gap between columns (not part of cell padding). */
const COL_GAP = "  ";

const PATTERN_SHORT: Record<string, string> = {
  implement: "imp",
  quick_fix: "qfx",
  investigate: "inv",
  infra: "inf",
  analyse: "anl",
};

const VARIANT_SHORT: Record<string, string> = {
  standard: "std",
  express: "exp",
  orchestrated: "orc",
};

const PHASE_SHORT: Record<string, string> = {
  aligning: "align",
  speccing: "spec",
  planning: "plan",
  implementing: "impl",
  fixing: "fix",
  verifying: "vrfy",
  gathering: "gather",
  exploring: "expl",
  researching: "rsch",
};

export interface DashboardFormatInput {
  rows: TasksDashboardRow[];
  total_pending: number;
  total_pending_deviations: number;
  total_blocked_tasks: number;
  finish_ready_count: number;
  total_cost: number;
  attention_summary: string;
}

interface TableColumn {
  header: string;
  width: number;
  cell: (row: TasksDashboardRow) => string;
}

const TABLE_COLUMNS: TableColumn[] = [
  { header: "ID", width: 12, cell: (r) => r.id },
  { header: "PAT", width: 7, cell: (r) => abbreviatePatternLabel(r.pattern) },
  { header: "PHASE", width: 10, cell: (r) => abbreviatePhaseLabel(r) },
  { header: "TASKS", width: 10, cell: (r) => formatTasksCell(r) },
  { header: "ATTN", width: 10, cell: (r) => formatAttentionCell(r) },
  { header: "NEXT", width: 22, cell: (r) => formatNextCell(r) },
  { header: "COST", width: 8, cell: (r) => formatCostCell(r) },
  { header: "AGE", width: 8, cell: (r) => r.updated_relative },
];

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function padCell(text: string, width: number): string {
  return truncate(text, width).padEnd(width);
}

/** `implement/standard` → `imp/std`; unknown segments use first 3 chars. */
export function abbreviatePatternLabel(combined: string): string {
  const slash = combined.indexOf("/");
  if (slash < 0) {
    return PATTERN_SHORT[combined] ?? combined.slice(0, 3);
  }
  const base = combined.slice(0, slash);
  const variant = combined.slice(slash + 1);
  const shortBase = PATTERN_SHORT[base] ?? base.slice(0, 3);
  const shortVariant = VARIANT_SHORT[variant] ?? variant.slice(0, 3);
  return `${shortBase}/${shortVariant}`;
}

export function abbreviatePhaseLabel(row: TasksDashboardRow): string {
  const phase = PHASE_SHORT[row.phase] ?? row.phase.slice(0, 8);
  if (!row.terminal_outcome) return phase;
  const outcome = row.terminal_outcome.slice(0, 4);
  return `${phase}/${outcome}`;
}

function formatTasksCell(row: TasksDashboardRow): string {
  if (row.tasks_total === 0) return "—";
  const parts: string[] = [`${row.tasks_done}/${row.tasks_total}`];
  if (row.tasks_blocked > 0) parts.push(`${String(row.tasks_blocked)}b`);
  if (row.tasks_in_progress > 0) parts.push(`${String(row.tasks_in_progress)}↑`);
  if (row.tasks_pending > 0) parts.push(`${String(row.tasks_pending)}p`);
  const [first, ...rest] = parts;
  return rest.length === 0 ? first : `${first}·${rest.join("·")}`;
}

function formatAttentionCell(row: TasksDashboardRow): string {
  if (row.completed_at) return "done";
  const parts: string[] = [];
  if (row.pending_decisions > 0) parts.push(`${String(row.pending_decisions)}dec`);
  if (row.pending_deviations > 0) parts.push(`${String(row.pending_deviations)}dev`);
  if (row.has_checkpoint) parts.push("cp");
  if (row.missing_artifacts.length > 0) {
    parts.push(`!${row.missing_artifacts.join(",")}`);
  }
  return parts.length > 0 ? parts.join("·") : "—";
}

function formatNextCell(row: TasksDashboardRow): string {
  if (row.completed_at) return "—";
  if (!row.action_hint) return "—";
  return row.action_hint.replace(/^→\s*/, "");
}

function formatCostCell(row: TasksDashboardRow): string {
  const base = `$${row.display_cost_usd.toFixed(2)}`;
  return row.cost_from_usage ? `${base}*` : base;
}

function formatTableLine(columns: TableColumn[], row?: TasksDashboardRow): string {
  return columns.map((c) => padCell(row ? c.cell(row) : c.header, c.width)).join(COL_GAP);
}

function formatTable(sectionRows: TasksDashboardRow[]): string[] {
  if (sectionRows.length === 0) return [];
  return [
    formatTableLine(TABLE_COLUMNS),
    ...sectionRows.map((r) => formatTableLine(TABLE_COLUMNS, r)),
  ];
}

function formatFooter(input: DashboardFormatInput): string[] {
  const {
    rows,
    total_pending,
    total_pending_deviations,
    finish_ready_count,
    total_cost: totalCost,
  } = input;
  const lines: string[] = [
    "",
    "—",
    input.attention_summary,
    `${INDENT}${String(rows.length)} work item${rows.length === 1 ? "" : "s"} · $${totalCost.toFixed(2)} total`,
    `${INDENT}tasks: n/total · b blocked · ↑ in progress · p pending · * cost from usage log`,
  ];

  const hints: string[] = [];
  if (total_pending > 0 || total_pending_deviations > 0) {
    hints.push("/dev review");
  }
  if (finish_ready_count > 0) {
    hints.push("/dev finish <ID>");
  }
  hints.push("/dev resume <ID>");
  if (hints.length > 0) {
    lines.push(`${INDENT}${hints.join(" · ")}`);
  }

  return lines;
}

export function formatTasksDashboard(input: DashboardFormatInput): string {
  const { rows } = input;
  if (rows.length === 0) {
    return "No work items in `.tasks/`.";
  }

  const active = rows.filter((r) => !r.completed_at);
  const done = rows.filter((r) => r.completed_at);
  const counts =
    done.length > 0
      ? ` (${String(active.length)} active · ${String(done.length)} done)`
      : ` (${String(active.length)} active)`;

  const lines: string[] = [`Work items${counts}`, ""];

  if (active.length > 0) {
    if (done.length > 0) lines.push("Active");
    lines.push(...formatTable(active));
  }

  if (done.length > 0) {
    if (active.length > 0) {
      lines.push("");
      lines.push("Done");
    }
    lines.push(...formatTable(done));
  }

  lines.push(...formatFooter(input));
  return lines.join("\n");
}
