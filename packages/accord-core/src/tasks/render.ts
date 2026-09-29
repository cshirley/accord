/**
 * Render v2 task files for briefs (per dispatch agent) and humans (`accord trace`).
 */

import { refActor, stateFromHistory } from "./model.js";
import type {
  Finding,
  FindingState,
  HistoryEntry,
  LoopKind,
  Requirement,
  TaskFileV2,
} from "./types.js";
import { UNATTRIBUTED_REQUIREMENT_ID } from "./types.js";

const HISTORY_CAP = 3;

function historyLine(entry: HistoryEntry): string {
  const who = entry.actor === "human" ? `${entry.by} (human)` : entry.by;
  const severity = entry.severity ? ` [${entry.severity}]` : "";
  const note = entry.note ? `: ${entry.note.replace(/\s+/g, " ").slice(0, 240)}` : "";
  return `${who} ${entry.outcome}${severity}${note}`;
}

function findingLines(finding: Finding, indent = ""): string[] {
  const tags = [
    finding.severity,
    finding.detail?.category,
    finding.advisory ? "advisory" : undefined,
    finding.tc,
  ].filter(Boolean);
  const where = finding.file
    ? ` · ${finding.file}${finding.line ? `:${String(finding.line)}` : ""}`
    : "";
  const lines = [
    `${indent}- **${finding.id}** (${finding.state}) ${tags.join(" · ")}${where} — raised ${finding.raised}`,
    `${indent}  ${finding.issue.replace(/\s+/g, " ")}`,
  ];
  if (finding.detail?.recommendation) {
    lines.push(`${indent}  Recommendation: ${finding.detail.recommendation.replace(/\s+/g, " ")}`);
  }
  if (finding.also_affects?.length) {
    lines.push(`${indent}  Also affects: ${finding.also_affects.join(", ")}`);
  }
  const history = finding.history;
  const shown = history.slice(-HISTORY_CAP);
  if (history.length > shown.length) {
    lines.push(`${indent}  … ${String(history.length - shown.length)} earlier history entr(ies)`);
  }
  for (const entry of shown) lines.push(`${indent}  - ${historyLine(entry)}`);
  return lines;
}

function requirementHeading(req: Requirement): string {
  const level = req.requirement ? `${req.requirement} · ` : "";
  const tcs = req.test_cases.length ? ` · ${req.test_cases.join(", ")}` : "";
  return `### ${req.id} (${level}${req.status}${tcs})${req.text ? ` — ${req.text}` : ""}`;
}

function changeSummary(req: Requirement): string | null {
  if (!req.changes.length) return null;
  const byFile = new Map<string, string[]>();
  for (const change of req.changes) {
    const list = byFile.get(change.file) ?? [];
    list.push(`${change.kind} ${change.by.join(", ")}`);
    byFile.set(change.file, list);
  }
  return `Changes: ${[...byFile].map(([file, uses]) => `${file} (${uses.join(", ")})`).join("; ")}`;
}

interface BriefSpec {
  loops: LoopKind[];
  /** States to show in full. */
  show: ReadonlySet<FindingState>;
  /** Restrict to findings raised by this actor ("*" = any). */
  raisedBy?: string;
  title: string;
  instructions: string[];
}

const OWED: ReadonlySet<FindingState> = new Set(["open", "reraised"]);
const TO_RECHECK: ReadonlySet<FindingState> = new Set([
  "open",
  "reraised",
  "addressed",
  "disputed",
  "wont_fix_proposed",
]);

function briefSpecFor(agent: string): BriefSpec | null {
  switch (agent) {
    case "phase-test":
      return {
        loops: ["T"],
        show: OWED,
        title: "Open test findings (harness ledger)",
        instructions: [
          "**Required on this retry:** edit the existing test files (and report stub skeletons for any unresolved import) — do not start over.",
          "Return `review_responses[]` with one entry per finding above: `{finding_id, resolution: fixed|disputed|wont_fix, note}`. `disputed` needs concrete evidence; `wont_fix` needs a reason a reviewer or human can accept.",
          "Report every file you touched in `changes[]` with the ACs it serves (`ac_ids`).",
        ],
      };
    case "review-test":
      return {
        loops: ["T"],
        show: TO_RECHECK,
        raisedBy: "*",
        title: "Prior test findings to recheck (harness ledger)",
        instructions: [
          "For **every** finding above return a `rechecks[]` entry: `{finding_id, outcome: verified|reraised|dispute_upheld|wont_fix_accepted, note}`.",
          "Re-raise by ID (outcome `reraised`) — do not open a new finding for the same root cause. New findings are allowed; include `ac_id` (infer it from the requirement map's `changes`) and `tc_id` when known.",
        ],
      };
    case "phase-code":
      return {
        loops: ["C", "V"],
        show: OWED,
        title: "Open code / verification findings (harness ledger)",
        instructions: [
          "Return `review_responses[]` with one entry per finding above: `{finding_id, resolution: fixed|disputed|wont_fix, note}`. Advisory (security) findings expect a response but never block.",
          "Report every file you touched in `changes[]` with the ACs it serves (`ac_ids`). Never edit tests — report a `test_issue` event instead.",
        ],
      };
    case "review-code":
      return {
        loops: ["C"],
        show: TO_RECHECK,
        raisedBy: "review-code",
        title: "Prior code findings to recheck (harness ledger)",
        instructions: [
          "For **every** finding above return a `rechecks[]` entry: `{finding_id, outcome: verified|reraised|dispute_upheld|wont_fix_accepted, note}`.",
          "New findings: include `ac_id` — infer it from which requirement's `changes` include the file.",
        ],
      };
    case "review-security":
      return {
        loops: ["C"],
        show: TO_RECHECK,
        raisedBy: "review-security",
        title: "Prior security findings to recheck (advisory)",
        instructions: [
          "Recheck each finding above by ID in `rechecks[]`. Security findings are advisory — they never block the loop.",
        ],
      };
    case "phase-verify-task":
      return {
        loops: ["V"],
        show: TO_RECHECK,
        title: "Prior verification failures (harness ledger)",
        instructions: [
          "Re-run the failing tests first. Return `evidence[]` with one entry per covered AC: `{ac_id, result: pass|fail, tests[], command}`.",
        ],
      };
    default:
      return null;
  }
}

/** Markdown ledger for the next spawn of `agent`, or `""` when nothing is owed/to recheck. */
export function renderFindingsBrief(task: TaskFileV2, agent: string): string {
  const spec = briefSpecFor(agent);
  if (!spec) return "";
  const sections: string[] = [];
  const collapsed: string[] = [];
  let shown = 0;
  for (const req of task.requirements) {
    if (req.waived) continue;
    const relevant = req.findings.filter(
      (finding) =>
        spec.loops.includes(finding.loop) &&
        (!spec.raisedBy || spec.raisedBy === "*" || refActor(finding.raised) === spec.raisedBy),
    );
    const full = relevant.filter((finding) => spec.show.has(stateFromHistory(finding.history)));
    for (const finding of relevant) {
      if (!full.includes(finding)) collapsed.push(`${finding.id} ${finding.state}`);
    }
    if (full.length === 0) continue;
    shown += full.length;
    const lines = [requirementHeading(req)];
    const changes = changeSummary(req);
    if (changes) lines.push(changes);
    for (const finding of full) lines.push(...findingLines(finding));
    sections.push(lines.join("\n"));
  }
  if (shown === 0) return "";
  const { retries, round } = task.control;
  const header = [
    "",
    `## ${spec.title}`,
    "",
    `Round ${round} · retries: test_review ${String(retries.test_review.used)}, code_review ${String(retries.code_review.used)}, verify ${String(retries.verify.used)}, rgr ${String(retries.rgr.used)}.`,
    "",
  ];
  const footerLines = [
    ...(collapsed.length ? ["", `Resolved / not owed: ${collapsed.join(", ")}`] : []),
    "",
    ...spec.instructions,
    "",
  ];
  return [...header, sections.join("\n\n"), ...footerLines].join("\n");
}

/** Compact requirement → changes map for reviewer AC inference. */
export function requirementMap(task: TaskFileV2): Array<Record<string, unknown>> {
  return task.requirements
    .filter((req) => req.id !== UNATTRIBUTED_REQUIREMENT_ID || req.changes.length > 0)
    .map((req) => ({
      id: req.id,
      ...(req.requirement ? { requirement: req.requirement } : {}),
      text: req.text,
      status: req.status,
      ...(req.test_cases.length ? { test_cases: req.test_cases } : {}),
      changes: req.changes.map((change) => ({
        file: change.file,
        kind: change.kind,
        by: change.by,
        ...(change.tests?.length ? { tests: change.tests } : {}),
      })),
    }));
}

// ── Human trace (accord trace) ──────────────────────────────────────

export function renderTaskTrace(task: TaskFileV2, options?: { openOnly?: boolean }): string {
  const out: string[] = [];
  const { summary, control } = task;
  out.push(`# ${task.work_item} · task ${String(task.task)} — ${task.title}`);
  out.push("");
  out.push(`**${summary.headline}**`);
  out.push("");
  out.push(
    `Phase \`${control.phase}\` · status \`${control.status}\` · round ${control.round} · retries test ${String(control.retries.test_review.used)}/${String(control.retries.test_review.lifetime)}L, code ${String(control.retries.code_review.used)}/${String(control.retries.code_review.lifetime)}L, verify ${String(control.retries.verify.used)}/${String(control.retries.verify.lifetime)}L, rgr ${String(control.retries.rgr.used)} · unblocks ${String(control.retries.unblocks)}`,
  );
  out.push("");
  out.push(`**Next (${summary.next.who}):** ${summary.next.why}`);
  for (const step of summary.next.do) out.push(`- \`${step}\``);
  if (summary.blockers.length) {
    out.push("");
    out.push("**Blockers**");
    for (const blocker of summary.blockers) {
      out.push(
        `- ${blocker.finding} ${blocker.severity} (${blocker.ac}, ${blocker.state}): ${blocker.issue}`,
      );
    }
  }
  if (summary.advisories.length) {
    out.push("");
    out.push("**Advisories**");
    for (const item of summary.advisories) {
      out.push(`- ${item.finding} ${item.severity} (${item.ac}, ${item.state}): ${item.issue}`);
    }
  }
  out.push("");
  out.push("## Requirements");
  for (const req of task.requirements) {
    const findings = options?.openOnly
      ? req.findings.filter(
          (finding) =>
            !["verified", "dispute_upheld", "wont_fix_accepted", "waived", "superseded"].includes(
              finding.state,
            ),
        )
      : req.findings;
    if (req.id === UNATTRIBUTED_REQUIREMENT_ID && !req.changes.length && !findings.length) continue;
    if (options?.openOnly && findings.length === 0) continue;
    out.push("");
    out.push(requirementHeading(req));
    if (req.waived) out.push(`Waived by ${req.waived.by}: ${req.waived.reason}`);
    const changes = changeSummary(req);
    if (changes) out.push(changes);
    if (req.verification) {
      out.push(
        `Verification: ${req.verification.result} (${req.verification.by})${req.verification.tests.length ? ` — ${req.verification.tests.join(", ")}` : ""}`,
      );
    }
    for (const finding of findings) out.push(...findingLines(finding));
  }
  out.push("");
  out.push("## Log");
  for (const entry of task.log) {
    const human = entry.actor === "human" ? " (human)" : "";
    out.push(`- \`${entry.ref}\`${human} ${entry.result} — ${entry.note}`);
    for (const event of entry.events ?? []) {
      const text = [event.description, event.question, event.issue].find(
        (value): value is string => typeof value === "string",
      );
      out.push(
        `  - event ${event.type}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 200)}` : ""}`,
      );
    }
    for (const warning of entry.warnings ?? []) out.push(`  - ⚠ ${warning}`);
  }
  if (control.in_flight) {
    out.push(`- \`${control.in_flight.ref}\` ${control.in_flight.stage} (in flight)`);
  }
  return out.join("\n");
}
