/**
 * Verify summary — parse report, count criterion statuses, list gaps.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { renderRiskTable } from "../artifacts/render-trace-markdown.js";
import {
  traceJsonPath,
  traceMarkdownPath,
  type WorkItemTrace,
  writeWorkItemTrace,
} from "../artifacts/trace-artifact.js";
import { validateArtifact } from "../artifacts/validation.js";
import { devPersistWorkflowCost } from "../artifacts/workflow-cost-artifact.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, readJson } from "../work-items/io.js";

export interface VerifySummary {
  verdict: string;
  verify_path: string;
  markdown_path: string;
  pass: number;
  fail: number;
  partial: number;
  not_verified: number;
  gaps: { ac_id: string; gap: string; suggested_action: string }[];
  /** Mismatches between the agent's verify.json and the harness trace (empty when none). */
  discrepancies: string[];
  /** `docs/dev/<ID>/trace.json` when the trace was (re)written. */
  trace_path: string | null;
  formatted: string;
}

const ACCEPTED_TRACE_STATUSES = new Set(["satisfied", "waived"]);

/**
 * Cross-check the independent acceptance verdict against the harness trace. Advisory: the
 * discrepancies are surfaced in verify.md, they do not change the verdict.
 */
export function findVerifyTraceDiscrepancies(
  criteria: unknown[],
  trace: WorkItemTrace | null,
): string[] {
  if (!trace || trace.tasks.length === 0) return [];
  const out: string[] = [];
  const traceByAc = new Map(trace.acceptance.map((entry) => [entry.ac_id, entry]));
  const verifyIds = new Set<string>();

  for (const criterion of criteria) {
    const row = criterion as Record<string, unknown>;
    const acId = String(row.ac_id ?? row.id ?? "");
    if (!acId) continue;
    verifyIds.add(acId);
    const traced = traceByAc.get(acId);
    if (!traced) {
      if (row.status === "pass") {
        out.push(`${acId}: verify says pass, but no task requirement covers it in the trace.`);
      }
      continue;
    }
    if (row.status === "pass" && !ACCEPTED_TRACE_STATUSES.has(traced.status)) {
      out.push(
        `${acId}: verify says pass, but the trace status is \`${traced.status}\` (tasks ${traced.tasks.map((entry) => String(entry.task)).join(", ")}).`,
      );
    }
  }
  for (const entry of trace.acceptance) {
    if (entry.ac_id.startsWith("AC-") && !verifyIds.has(entry.ac_id)) {
      out.push(`${entry.ac_id}: covered by the trace but missing from verify.json.`);
    }
  }
  for (const task of trace.tasks) {
    if (task.status !== "done") {
      out.push(`Task ${String(task.id)} is \`${task.status}\`, not done.`);
    } else if (task.commits.length === 0) {
      out.push(`Task ${String(task.id)} is done but has no harness commit recorded.`);
    }
  }
  for (const risk of trace.accepted_risks) {
    if (risk.kind !== "unresolved") continue;
    if (!risk.advisory) {
      out.push(
        `Task ${String(risk.task_id)} ${risk.finding_id ?? risk.requirement}: gating finding still \`${risk.state ?? "open"}\` — ${oneLine(risk.issue)}`,
      );
    } else if (risk.severity === "critical") {
      out.push(
        `Task ${String(risk.task_id)} ${risk.finding_id ?? risk.requirement} (${risk.requirement}): critical advisory finding still \`${risk.state ?? "open"}\` — ${oneLine(risk.issue)}`,
      );
    }
  }
  return out;
}

function renderTraceSections(trace: WorkItemTrace | null, discrepancies: string[]): string[] {
  if (!trace) return [];
  const lines: string[] = [];

  lines.push("## Tasks", "");
  if (trace.tasks.length === 0) {
    lines.push("_No task files._", "");
  } else {
    lines.push(
      "| Task | Title | Status | Commits | Rounds T/C/V | Findings |",
      "| ---: | --- | --- | --- | --- | ---: |",
    );
    for (const task of trace.tasks) {
      lines.push(
        `| ${String(task.id)} | ${oneLine(task.title).replace(/\|/g, "\\|")} | ${task.status} | ${task.commits.map((hash) => inlineCode(hash)).join(" ") || "—"} | ${String(task.rounds.T)}/${String(task.rounds.C)}/${String(task.rounds.V)} | ${String(task.findings.total)} |`,
      );
    }
    lines.push("");
  }

  const accepted = trace.accepted_risks.filter(
    (risk) => risk.kind !== "unresolved" || risk.severity !== "suggestion",
  );
  const minorCount = trace.accepted_risks.length - accepted.length;
  lines.push("## Accepted risks and unresolved findings", "");
  lines.push(...renderRiskTable(accepted));
  if (minorCount > 0) {
    lines.push(
      `${String(minorCount)} unresolved suggestion-level advisor${minorCount === 1 ? "y" : "ies"} not shown — see the trace.`,
      "",
    );
  }

  const decided = trace.decisions;
  const deviations = trace.deviations;
  if (decided.length > 0 || deviations.length > 0) {
    lines.push("## Decisions and deviations", "");
    for (const decision of decided) {
      lines.push(
        `- Decision ${inlineCode(decision.id)} (${decision.status}): ${oneLine(decision.question)}${decision.answer ? ` → ${oneLine(decision.answer)}` : ""}`,
      );
    }
    for (const deviation of deviations) {
      lines.push(
        `- Deviation, task ${String(deviation.task_id)} (${deviation.resolution ?? "pending"}): ${oneLine(deviation.description)}`,
      );
    }
    lines.push("");
  }

  lines.push("## Discrepancies (verify vs trace)", "");
  if (discrepancies.length === 0) {
    lines.push("_None._", "");
  } else {
    for (const item of discrepancies) lines.push(`- ⚠ ${item}`);
    lines.push("");
  }
  return lines;
}

function renderAcTrace(trace: WorkItemTrace | null, acId: string): string[] {
  const entry = trace?.acceptance.find((candidate) => candidate.ac_id === acId);
  if (!trace) return [];
  if (!entry) return ["Implementation: no task requirement covers this AC in the trace.", ""];
  const lines = [
    `Implementation: task${entry.tasks.length === 1 ? "" : "s"} ${entry.tasks.map((taskEntry) => `${String(taskEntry.task)} (${taskEntry.status})`).join(", ")}`,
  ];
  if (entry.files.length > 0) {
    lines.push(`- Files: ${entry.files.map((file) => inlineCode(file)).join(", ")}`);
  }
  lines.push(
    `- Task verification: ${String(entry.tests.length)} test(s) checked${entry.verified ? "" : " — not all covering tasks verified"}`,
  );
  lines.push("");
  return lines;
}

function inlineCode(value: unknown): string {
  return `\`${String(value ?? "").replace(/`/g, "\\`")}\``;
}

function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseStatus(value: unknown): string {
  return oneLine(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function markdownPathFor(verifyPath: string): string {
  return verifyPath.endsWith(".json")
    ? verifyPath.replace(/\.json$/, ".md")
    : path.join(path.dirname(verifyPath), "verify.md");
}

function formatEvidence(evidence: unknown): string {
  if (typeof evidence === "string") return oneLine(evidence);
  if (!evidence || typeof evidence !== "object") return "Unknown evidence";

  const ev = evidence as Record<string, unknown>;
  const type = oneLine(ev.type || "evidence");
  const name = oneLine(ev.name || ev.description || "unnamed evidence");
  const location = ev.file
    ? `${ev.file}${ev.line ? `:${ev.line}` : ev.line_range ? `:${ev.line_range}` : ""}`
    : "";
  const runLog = ev.run_log ? ` - ${oneLine(ev.run_log)}` : "";

  return `${type}: ${name}${location ? ` (${location})` : ""}${runLog}`;
}

function renderMarkdownReport(
  id: string,
  wi: Record<string, unknown>,
  report: Record<string, unknown>,
  verifyPath: string,
  summary: {
    pass: number;
    fail: number;
    partial: number;
    notVerified: number;
    gaps: VerifySummary["gaps"];
  },
  trace: WorkItemTrace | null = null,
  discrepancies: string[] = [],
): string {
  const defaultBase = path.join("docs", "dev", id);
  const specJsonPath =
    typeof wi.spec === "string" && wi.spec.trim()
      ? wi.spec.trim()
      : path.join(defaultBase, "spec.json");
  const workflowCostJson =
    typeof wi.workflow_cost === "string" && wi.workflow_cost.trim()
      ? wi.workflow_cost.trim()
      : path.join(defaultBase, "workflow-cost.json");
  const artifactPaths = [
    ["Brief", wi.brief || path.join(defaultBase, "brief.md")],
    ["Spec (JSON)", specJsonPath],
    ["Spec (readable)", path.join(path.dirname(specJsonPath), "spec.md")],
    ["Plan", wi?.plan || path.join(defaultBase, "plan.json")],
    ["Machine-readable verify", verifyPath],
    ["Workflow cost (JSON)", workflowCostJson],
    ["Workflow cost (readable)", path.join(path.dirname(workflowCostJson), "workflow-cost.md")],
    ...(trace
      ? [
          ["Implementation trace (JSON)", traceJsonPath(id)],
          ["Implementation trace (readable)", traceMarkdownPath(id)],
        ]
      : []),
  ];

  const lines: string[] = [
    `# Verification Report: ${id}`,
    "",
    `- Verdict: **${String(report.verdict || "unknown").toUpperCase()}**`,
    `- Date: ${oneLine(report.date || "unknown")}`,
    `- Acceptance criteria: ${summary.pass} pass, ${summary.fail} fail, ${summary.partial} partial, ${summary.notVerified} not verified`,
    "",
    "## Source Artifacts",
    "",
  ];

  for (const [label, artifactPath] of artifactPaths) {
    lines.push(`- ${label}: ${inlineCode(artifactPath)}`);
  }

  lines.push(
    "",
    "## Summary",
    "",
    "| Status | Count |",
    "| --- | ---: |",
    `| Pass | ${summary.pass} |`,
    `| Fail | ${summary.fail} |`,
    `| Partial | ${summary.partial} |`,
    `| Not verified | ${summary.notVerified} |`,
    "",
    "## Acceptance Criteria",
    "",
  );

  for (const criterion of (report.criteria as unknown[] | undefined) ?? []) {
    const c = criterion as Record<string, unknown>;
    const acId = oneLine(c.ac_id || c.id || "unknown");
    const status = oneLine(c.status || c.verdict || "unknown");
    lines.push(`### ${acId} - ${titleCaseStatus(status)}`, "");

    const evidence = Array.isArray(c.evidence) ? c.evidence : [];
    if (evidence.length > 0) {
      lines.push("Evidence:");
      for (const item of evidence) {
        lines.push(`- ${formatEvidence(item)}`);
      }
      lines.push("");
    } else {
      lines.push("Evidence: none recorded.", "");
    }

    if (status !== "pass") {
      lines.push(`Gap: ${oneLine(String(c.gap || "No gap recorded."))}`);
      lines.push(
        `Suggested action: ${oneLine(String(c.suggested_action || "No suggested action recorded."))}`,
      );
      lines.push("");
    }
    lines.push(...renderAcTrace(trace, acId));
  }

  if (summary.gaps.length > 0) {
    lines.push("## Gaps", "");
    for (const gap of summary.gaps) {
      lines.push(`- ${gap.ac_id}: ${oneLine(gap.gap)}`);
      if (gap.suggested_action) lines.push(`  Suggested action: ${oneLine(gap.suggested_action)}`);
    }
    lines.push("");
  }

  lines.push(...renderTraceSections(trace, discrepancies));

  lines.push(
    report.verdict === "pass" ? "Next: `/commit` then `/pr`." : `Next: \`/dev gaps ${id}\`.`,
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

/** First existing verify report path for the work item (work item field, then conventions). */
export function resolveVerifyReportPath(id: string): string | null {
  const wi = loadWorkItem(id);
  const candidates = [
    wi?.verify,
    path.join("docs", "dev", id, "verify.json"),
    path.join("docs", "verify", `${id}-verify.json`),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * Schema-validate the work item's verify.json. Subagents write it outside the host's
 * write/edit hooks, so the harness must check it before rendering or finalizing.
 */
export async function validateVerifyReport(id: string): Promise<Result<{ verify_path: string }>> {
  const verifyPath = resolveVerifyReportPath(id);
  if (!verifyPath) return err(`Verify report not found for ${id}.`);
  const result = await validateArtifact(verifyPath);
  if (!result.valid) {
    return err(
      [`${verifyPath} fails verify-schema.json:`, ...result.errors.map((e) => `  • ${e}`)].join(
        "\n",
      ),
    );
  }
  return ok({ verify_path: verifyPath });
}

export function devVerifySummary(id: string): Result<VerifySummary> {
  const wi = loadWorkItem(id);
  const candidates = [
    wi?.verify,
    path.join("docs", "dev", id, "verify.json"),
    // Legacy layout kept as a read-only fallback for older runs.
    path.join("docs", "verify", `${id}-verify.json`),
  ].filter((p): p is string => Boolean(p));

  const seen = new Set<string>();
  let verifyPath = "";
  let report: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!fs.existsSync(candidate)) continue;
    report = readJson<Record<string, unknown>>(candidate);
    if (report) {
      verifyPath = candidate;
      break;
    }
  }
  if (!report) return err(`Verify report not found. Tried: ${Array.from(seen).join(", ")}`);

  let pass = 0,
    fail = 0,
    partial = 0,
    notVerified = 0;
  const gaps: VerifySummary["gaps"] = [];

  for (const c of (report.criteria as unknown[] | undefined) ?? []) {
    const row = c as Record<string, unknown>;
    const status = row.status || row.verdict;
    switch (status) {
      case "pass":
        pass++;
        break;
      case "fail":
        fail++;
        break;
      case "partial":
        partial++;
        break;
      case "not_verified":
        notVerified++;
        break;
    }
    if (status !== "pass" && (row.gap || row.suggested_action)) {
      gaps.push({
        ac_id: String(row.ac_id || row.id || ""),
        gap: String(row.gap || ""),
        suggested_action: String(row.suggested_action || ""),
      });
    }
  }

  const lines: string[] = [
    `Verdict: ${String(report.verdict)}`,
    `Verify: ${verifyPath}`,
    `  pass=${pass}  fail=${fail}  partial=${partial}  not_verified=${notVerified}`,
  ];
  if (gaps.length > 0) {
    lines.push("\nGaps:");
    for (const g of gaps) {
      lines.push(`  ${g.ac_id}: ${g.gap}`);
      if (g.suggested_action) lines.push(`    → ${g.suggested_action}`);
    }
  }
  // Refresh the harness trace beside verify.json so verify.md is the single review document.
  let trace: WorkItemTrace | null = null;
  let tracePath: string | null = null;
  if (wi) {
    // Keep the committed cost rollup current: verify re-runs (`/dev check`, repeated finish)
    // are reported even when finalize does not run again.
    devPersistWorkflowCost(id);
    const written = writeWorkItemTrace(id);
    if (written.ok) {
      trace = written.value.trace;
      tracePath = written.value.json_path;
    }
  }
  const criteria = Array.isArray(report.criteria) ? (report.criteria as unknown[]) : [];
  const discrepancies = findVerifyTraceDiscrepancies(criteria, trace);
  if (discrepancies.length > 0) {
    lines.push("\nDiscrepancies (verify vs trace):");
    for (const item of discrepancies) lines.push(`  ⚠ ${item}`);
  }

  const markdownPath = markdownPathFor(verifyPath);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(
    markdownPath,
    renderMarkdownReport(
      id,
      (wi ?? {}) as Record<string, unknown>,
      report,
      verifyPath,
      {
        pass,
        fail,
        partial,
        notVerified,
        gaps,
      },
      trace,
      discrepancies,
    ),
  );

  lines.push(`Markdown: ${markdownPath}`);
  lines.push("", report.verdict === "pass" ? "Next: /commit → /pr" : `Next: /dev gaps ${id}`);

  return ok({
    verdict: String(report.verdict),
    verify_path: verifyPath,
    markdown_path: markdownPath,
    pass,
    fail,
    partial,
    not_verified: notVerified,
    gaps,
    discrepancies,
    trace_path: tracePath,
    formatted: lines.join("\n"),
  });
}
