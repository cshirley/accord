/**
 * Render `trace.md` from a {@link WorkItemTrace}.
 */

import type { TraceRisk, WorkItemTrace } from "./trace-artifact.js";

function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cell(value: unknown): string {
  return oneLine(value).replace(/\|/g, "\\|");
}

function location(risk: TraceRisk): string {
  if (!risk.file) return "";
  return risk.line ? `${risk.file}:${String(risk.line)}` : risk.file;
}

/** Markdown table of accepted / unresolved risks (shared with verify.md). */
export function renderRiskTable(risks: TraceRisk[]): string[] {
  if (risks.length === 0) return ["_None._", ""];
  const lines = [
    "| Task | Req | Finding | Kind | State | Severity | Issue | Location | Resolution |",
    "| ---: | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const risk of risks) {
    const resolution = risk.resolution
      ? `${risk.resolution.outcome} by ${risk.resolution.actor === "human" ? "human" : risk.resolution.by}${risk.resolution.note ? ` — ${risk.resolution.note}` : ""}`
      : "";
    lines.push(
      `| ${String(risk.task_id)} | ${cell(risk.requirement)} | ${cell(risk.finding_id ?? "—")} | ${cell(risk.kind)}${risk.advisory ? " (advisory)" : ""} | ${cell(risk.state ?? "waived")} | ${cell(risk.severity ?? "—")} | ${cell(risk.issue)} | ${cell(location(risk))} | ${cell(resolution)} |`,
    );
  }
  lines.push("");
  return lines;
}

function fence(text: string): string[] {
  return ["```text", text.replace(/```/g, "ʼʼʼ"), "```"];
}

export function renderTraceMarkdown(trace: WorkItemTrace): string {
  const lines: string[] = [
    `# Implementation trace: ${trace.work_item_id}`,
    "",
    `- Generated: ${trace.generated_at} (harness-generated from \`.tasks/\`; regenerate, don't edit)`,
    `- Pattern: ${trace.pattern}`,
  ];
  if (trace.outcome.terminal_outcome) {
    lines.push(`- Outcome: **${trace.outcome.terminal_outcome}**`);
  }
  if (trace.outcome.next_action) lines.push(`- Next action: ${oneLine(trace.outcome.next_action)}`);
  lines.push("");

  lines.push("## Tasks", "");
  if (trace.tasks.length === 0) {
    lines.push("_No task files._", "");
  } else {
    lines.push(
      "| Task | Title | Status | Commits | Rounds T/C/V | Findings | Unblocks |",
      "| ---: | --- | --- | --- | --- | --- | ---: |",
    );
    for (const task of trace.tasks) {
      const states = Object.entries(task.findings.by_state)
        .map(([state, count]) => `${state} ${String(count)}`)
        .join(", ");
      lines.push(
        `| ${String(task.id)} | ${cell(task.title)} | ${task.status} | ${task.commits.map((hash) => `\`${hash}\``).join(" ") || "—"} | ${String(task.rounds.T)}/${String(task.rounds.C)}/${String(task.rounds.V)} | ${String(task.findings.total)}${states ? ` (${states})` : ""} | ${String(task.unblocks)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Acceptance criteria", "");
  if (trace.acceptance.length === 0) lines.push("_No AC-attributed requirements._", "");
  for (const ac of trace.acceptance) {
    lines.push(`### ${ac.ac_id} — ${ac.status}${ac.verified ? "" : " (not verified)"}`, "");
    if (ac.text) lines.push(`> ${oneLine(ac.text)}`, "");
    lines.push(
      `- Tasks: ${ac.tasks.map((entry) => `${String(entry.task)} (${entry.status})`).join(", ")}`,
    );
    if (ac.files.length > 0) {
      lines.push(`- Files: ${ac.files.map((file) => `\`${file}\``).join(", ")}`);
    }
    if (ac.tests.length > 0) {
      lines.push(`- Tests verified (${String(ac.tests.length)}):`);
      for (const test of ac.tests) lines.push(`  - ${oneLine(test)}`);
    }
    lines.push("");
  }

  lines.push("## Accepted risks and unresolved findings", "");
  lines.push(...renderRiskTable(trace.accepted_risks));

  lines.push("## Decisions", "");
  if (trace.decisions.length === 0) lines.push("_None._", "");
  for (const decision of trace.decisions) {
    lines.push(
      `- **${decision.id}** (${decision.source}, ${decision.status}): ${oneLine(decision.question)}${decision.answer ? ` → ${oneLine(decision.answer)}` : ""}`,
    );
  }
  if (trace.decisions.length > 0) lines.push("");

  lines.push("## Deviations", "");
  if (trace.deviations.length === 0) lines.push("_None._", "");
  for (const deviation of trace.deviations) {
    lines.push(
      `- Task ${String(deviation.task_id)} (${deviation.resolution ?? "pending"}): ${oneLine(deviation.description)}${deviation.reason ? ` — ${oneLine(deviation.reason)}` : ""}`,
    );
  }
  if (trace.deviations.length > 0) lines.push("");

  lines.push("## Evidence by task", "");
  for (const task of trace.tasks) {
    lines.push(`### Task ${String(task.id)}: ${oneLine(task.title)}`, "");
    if (task.blocked)
      lines.push(`- Blocked (${task.blocked.kind}): ${oneLine(task.blocked.reason)}`);
    for (const action of task.human_actions) {
      lines.push(`- Human action \`${action.ref}\`: ${oneLine(action.note)}`);
    }
    if (task.quick_fix_contract) {
      lines.push(`- Quick-fix contract: ${oneLine(task.quick_fix_contract.plan.summary)}`);
    }
    if (task.red_evidence) {
      lines.push(
        "",
        `RED evidence (\`${task.red_evidence.ref}\`):`,
        "",
        ...fence(task.red_evidence.excerpt),
      );
    }
    if (task.final_verification) {
      lines.push(
        "",
        `Final verification (\`${task.final_verification.ref}\`):`,
        "",
        ...fence(task.final_verification.excerpt),
      );
    }
    lines.push("");
  }

  if (trace.outcome.shift_left_findings.length > 0) {
    lines.push("## Shift-left findings", "");
    for (const finding of trace.outcome.shift_left_findings) {
      lines.push(
        `- **${oneLine(finding.category)}**: ${oneLine(finding.evidence)} → ${oneLine(finding.recommendation)}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}
