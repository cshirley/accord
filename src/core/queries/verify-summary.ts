/**
 * Verify summary — parse report, count criterion statuses, list gaps.
 */

import * as fs from "node:fs";
import * as path from "node:path";
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
  formatted: string;
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

function formatEvidence(evidence: any): string {
  if (typeof evidence === "string") return oneLine(evidence);
  if (!evidence || typeof evidence !== "object") return "Unknown evidence";

  const type = oneLine(evidence.type || "evidence");
  const name = oneLine(evidence.name || evidence.description || "unnamed evidence");
  const location = evidence.file
    ? `${evidence.file}${evidence.line ? `:${evidence.line}` : evidence.line_range ? `:${evidence.line_range}` : ""}`
    : "";
  const runLog = evidence.run_log ? ` - ${oneLine(evidence.run_log)}` : "";

  return `${type}: ${name}${location ? ` (${location})` : ""}${runLog}`;
}

function renderMarkdownReport(
  id: string,
  wi: any,
  report: any,
  verifyPath: string,
  summary: {
    pass: number;
    fail: number;
    partial: number;
    notVerified: number;
    gaps: VerifySummary["gaps"];
  },
): string {
  const defaultBase = path.join("docs", "dev", id);
  const artifactPaths = [
    ["Brief", wi?.brief || path.join(defaultBase, "brief.md")],
    ["Spec", wi?.spec || path.join(defaultBase, "spec.json")],
    ["Plan", wi?.plan || path.join(defaultBase, "plan.json")],
    ["Machine-readable verify", verifyPath],
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

  for (const criterion of report.criteria || []) {
    const acId = oneLine(criterion.ac_id || criterion.id || "unknown");
    const status = oneLine(criterion.status || criterion.verdict || "unknown");
    lines.push(`### ${acId} - ${titleCaseStatus(status)}`, "");

    const evidence = Array.isArray(criterion.evidence) ? criterion.evidence : [];
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
      lines.push(`Gap: ${oneLine(criterion.gap || "No gap recorded.")}`);
      lines.push(
        `Suggested action: ${oneLine(criterion.suggested_action || "No suggested action recorded.")}`,
      );
      lines.push("");
    }
  }

  if (summary.gaps.length > 0) {
    lines.push("## Gaps", "");
    for (const gap of summary.gaps) {
      lines.push(`- ${gap.ac_id}: ${oneLine(gap.gap)}`);
      if (gap.suggested_action) lines.push(`  Suggested action: ${oneLine(gap.suggested_action)}`);
    }
    lines.push("");
  }

  lines.push(
    report.verdict === "pass" ? "Next: `/commit` then `/pr`." : `Next: \`/dev gaps ${id}\`.`,
  );
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function devVerifySummary(id: string): VerifySummary | { error: string } {
  const wi = loadWorkItem(id);
  const candidates = [
    wi?.verify,
    path.join("docs", "dev", id, "verify.json"),
    // Legacy layout kept as a read-only fallback for older runs.
    path.join("docs", "verify", `${id}-verify.json`),
  ].filter((p): p is string => Boolean(p));

  const seen = new Set<string>();
  let verifyPath = "";
  let report: any = null;
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!fs.existsSync(candidate)) continue;
    report = readJson<any>(candidate);
    if (report) {
      verifyPath = candidate;
      break;
    }
  }
  if (!report) return { error: `Verify report not found. Tried: ${Array.from(seen).join(", ")}` };

  let pass = 0,
    fail = 0,
    partial = 0,
    notVerified = 0;
  const gaps: VerifySummary["gaps"] = [];

  for (const c of report.criteria || []) {
    const status = c.status || c.verdict;
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
    if (status !== "pass" && (c.gap || c.suggested_action)) {
      gaps.push({
        ac_id: c.ac_id || c.id,
        gap: c.gap || "",
        suggested_action: c.suggested_action || "",
      });
    }
  }

  const lines: string[] = [
    `Verdict: ${report.verdict}`,
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
  const markdownPath = markdownPathFor(verifyPath);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(
    markdownPath,
    renderMarkdownReport(id, wi, report, verifyPath, {
      pass,
      fail,
      partial,
      notVerified,
      gaps,
    }),
  );

  lines.push(`Markdown: ${markdownPath}`);
  lines.push("", report.verdict === "pass" ? "Next: /commit → /pr" : `Next: /dev gaps ${id}`);

  return {
    verdict: report.verdict,
    verify_path: verifyPath,
    markdown_path: markdownPath,
    pass,
    fail,
    partial,
    not_verified: notVerified,
    gaps,
    formatted: lines.join("\n"),
  };
}
