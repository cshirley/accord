import { parseAccordTrailer } from "../commit/commit-grammar";
import { git } from "../git/helpers";

const COUNT_KEYS = [
  "crit",
  "warn",
  "sugg",
  "addressed",
  "disputed",
  "wont_fix",
  "ac_pass",
  "ac_fail",
  "t_pass",
  "t_fail",
] as const;

const COLUMNS = [
  "ref",
  "task",
  "agent",
  "loop",
  "round",
  "outcome",
  ...COUNT_KEYS,
  "model",
  "tok_in",
  "tok_out",
  "usd_u",
];

const RECORD_SEPARATOR = "\x1e";

export interface TimelineRow {
  ref: string;
  task: number;
  agent: string;
  loop: string;
  round: number;
  outcome: string;
  model?: string;
  counts: Record<string, number>;
  tokens: Record<string, number>;
  cost: Record<string, number>;
}

export interface TimelineOptions {
  task?: number;
  cwd?: string;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toRow(trailer: Record<string, unknown>): TimelineRow {
  const counts: Record<string, number> = {};
  for (const key of COUNT_KEYS) {
    const value = numberField(trailer[key]);
    if (value !== undefined) counts[key] = value;
  }
  const tokens: Record<string, number> = {};
  const tokIn = numberField(trailer.tok_in);
  const tokOut = numberField(trailer.tok_out);
  if (tokIn !== undefined) tokens.in = tokIn;
  if (tokOut !== undefined) tokens.out = tokOut;
  const cost: Record<string, number> = {};
  const usd = numberField(trailer.usd_u);
  if (usd !== undefined) cost.usd_u = usd;
  const row: TimelineRow = {
    ref: String(trailer.ref),
    task: Number(trailer.task),
    agent: String(trailer.agent),
    loop: String(trailer.loop),
    round: Number(trailer.round),
    outcome: String(trailer.outcome),
    counts,
    tokens,
    cost,
  };
  if (typeof trailer.model === "string") row.model = trailer.model;
  return row;
}

export async function readTimeline(
  workItemId: string,
  options: TimelineOptions,
): Promise<TimelineRow[]> {
  const cwd = options.cwd ?? process.cwd();
  let out: string;
  try {
    out = await git(
      ["log", "--reverse", `--format=%x1e%(trailers:key=Accord,valueonly,unfold)`],
      cwd,
    );
  } catch {
    return [];
  }
  const rows: TimelineRow[] = [];
  for (const chunk of out.split(RECORD_SEPARATOR)) {
    const text = chunk.trim();
    if (text === "") continue;
    let trailer: Record<string, unknown> | null;
    try {
      trailer = parseAccordTrailer(text) as Record<string, unknown> | null;
    } catch {
      continue;
    }
    if (!trailer || trailer.id !== workItemId) continue;
    if (options.task !== undefined && trailer.task !== options.task) continue;
    rows.push(toRow(trailer));
  }
  return rows;
}

function cells(row: TimelineRow): string[] {
  const text = (value: number | string | undefined): string =>
    value === undefined ? "" : String(value);
  return [
    row.ref,
    String(row.task),
    row.agent,
    row.loop,
    String(row.round),
    row.outcome,
    ...COUNT_KEYS.map((key) => text(row.counts[key])),
    text(row.model),
    text(row.tokens.in),
    text(row.tokens.out),
    text(row.cost.usd_u),
  ];
}

export function renderTimelineMarkdown(rows: TimelineRow[]): string {
  const lines = [
    `| ${COLUMNS.join(" | ")} |`,
    `| ${COLUMNS.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${cells(row).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}

export function renderTimelineTsv(rows: TimelineRow[]): string {
  const lines = [COLUMNS.join("\t"), ...rows.map((row) => cells(row).join("\t"))];
  return `${lines.join("\n")}\n`;
}
