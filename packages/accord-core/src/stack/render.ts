import type { AccordTrailer } from "../commit/commit-grammar.js";
import { qualifyAcRef } from "../evidence/qualify-ac.js";
import type { PrGroup, StackPlan, StackPlanTask } from "./types.js";

export interface PrBriefAc {
  /** Local id (`AC-6`) or already qualified. */
  id: string;
  text?: string;
  tests: string[];
}

export interface PrBriefInput {
  workItemId: string;
  /** sha-pinned permalink to the locked contract. */
  contractLink: string;
  acs: PrBriefAc[];
  /** One-line process summary. */
  summary: string;
  risks: string[];
  readingOrder: string[];
}

export interface StackMapEntry {
  pr: PrGroup;
  url: string;
  acs: string[];
}

export interface StackReportRow {
  pr: number;
  task: number;
  trailers: AccordTrailer[];
}

const BARE_REF = /(?<![A-Za-z0-9_/])(?:AC|TC)-\d+/g;

function qualifyText(workItemId: string, text: string): string {
  return text.replace(BARE_REF, (ref) => qualifyAcRef(workItemId, ref));
}

function uniqueQualified(workItemId: string, ids: string[]): string[] {
  return [...new Set(ids.map((id) => qualifyAcRef(workItemId, id)))];
}

function mdRow(cells: (string | number)[]): string {
  return `| ${cells.join(" | ")} |`;
}

function mdTable(header: string[], rows: (string | number)[][]): string {
  return [mdRow(header), mdRow(header.map(() => "---")), ...rows.map(mdRow)].join("\n");
}

export function renderPrBrief(input: PrBriefInput): string {
  const q = (text: string) => qualifyText(input.workItemId, text);
  const acLines = input.acs.flatMap((ac) => {
    const id = qualifyAcRef(input.workItemId, ac.id);
    return [
      `- **${id}**${ac.text ? ` — ${q(ac.text)}` : ""}`,
      ...ac.tests.map((test) => `  - ${q(test)}`),
    ];
  });
  const risks = input.risks.length > 0 ? input.risks.map((risk) => `- ${q(risk)}`) : ["- None"];
  const reading = input.readingOrder.map((path, index) => `${index + 1}. ${path}`);
  return [
    "## Contract",
    "",
    `[Locked contract](${input.contractLink})`,
    "",
    "## Acceptance criteria and proving tests",
    "",
    ...acLines,
    "",
    "## Process summary",
    "",
    q(input.summary),
    "",
    "## Accepted risks",
    "",
    ...risks,
    "",
    "## Reading order",
    "",
    ...reading,
    "",
  ].join("\n");
}

export function renderStackMap(workItemId: string, entries: StackMapEntry[]): string {
  const total = entries.length;
  const rows = entries.map((entry, position) => {
    const acs = uniqueQualified(workItemId, entry.acs);
    return mdRow([
      `${position + 1} / ${total}`,
      entry.pr.kind,
      entry.url,
      acs.length > 0 ? acs.join(", ") : "-",
    ]);
  });
  return [
    "## Stack map",
    "",
    mdRow(["Position", "Kind", "PR", "ACs"]),
    mdRow(["---", "---", "---", "---"]),
    ...rows,
    "",
  ].join("\n");
}

export function renderStackTable(
  workItemId: string,
  plan: StackPlan,
  tasks: StackPlanTask[],
): string {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rows = plan.prs.map((pr) => {
    const acs = uniqueQualified(
      workItemId,
      pr.tasks.flatMap((id) => byId.get(id)?.covers_ac ?? []),
    );
    const concern = pr.kind === "task" ? (pr.concern ?? "-") : pr.kind;
    return [
      pr.index,
      pr.tasks.length > 0 ? pr.tasks.join(", ") : "-",
      concern,
      acs.length > 0 ? acs.join(", ") : "-",
      pr.est_lines ?? "-",
      pr.depends_on_prs && pr.depends_on_prs.length > 0 ? pr.depends_on_prs.join(", ") : "-",
    ];
  });
  return `${mdTable(["PR", "Tasks", "Concern", "ACs", "Est. LOC", "Depends on"], rows)}\n`;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function renderStackReport(_workItemId: string, rows: StackReportRow[]): string {
  const groups = new Map<string, { pr: number; task: number; loop: string; t: AccordTrailer[] }>();
  for (const row of rows) {
    for (const trailer of row.trailers) {
      const key = `${row.pr}\u0000${row.task}\u0000${trailer.loop}`;
      const group = groups.get(key) ?? { pr: row.pr, task: row.task, loop: trailer.loop, t: [] };
      group.t.push(trailer);
      groups.set(key, group);
    }
  }
  const body = [...groups.values()].map((group) => {
    const rounds = Math.max(...group.t.map((t) => t.round));
    const findings = group.t.reduce((sum, t) => sum + num(t.crit) + num(t.warn) + num(t.sugg), 0);
    const tokens = group.t.reduce((sum, t) => sum + num(t.tok_in) + num(t.tok_out), 0);
    const cost = group.t.reduce((sum, t) => sum + num(t.usd_u), 0);
    const latest = group.t
      .filter((t) => typeof t.t_pass === "number" || typeof t.t_fail === "number")
      .sort((a, b) => b.round - a.round || b.seq - a.seq)[0];
    const tests = latest ? `${num(latest.t_pass)}/${num(latest.t_fail)}` : "-";
    return [group.pr, group.task, group.loop, rounds, findings, tests, tokens, `${cost} usd_u`];
  });
  return `${mdTable(["PR", "Task", "Loop", "Rounds", "Findings", "Tests", "Tokens", "Cost"], body)}\n`;
}
