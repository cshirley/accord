/**
 * Render a human-readable spec.md from a validated spec.json object.
 * spec.json remains the verification contract; spec.md is a derived view.
 */

export type SpecDiagramSection =
  | "overview"
  | "proposed_solution"
  | "scope"
  | "verification"
  | "security_topology"
  | "api_contract"
  | "deployment";

export interface SpecDiagram {
  section: SpecDiagramSection | string;
  caption?: string;
  mermaid: string;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function acBody(ac: Record<string, unknown>): string {
  const type = String(ac.type ?? "");
  if (type === "scenario" && typeof ac.scenario === "string") {
    return ac.scenario;
  }
  if (type === "architectural") {
    const criterion = typeof ac.criterion === "string" ? ac.criterion : "";
    const enforcement = typeof ac.enforcement === "string" ? ac.enforcement : "";
    return enforcement ? `${criterion} *(enforcement: ${enforcement})*` : criterion;
  }
  if (typeof ac.criterion === "string") {
    return ac.criterion;
  }
  return JSON.stringify(ac);
}

function diagramsForSection(
  diagrams: SpecDiagram[] | undefined,
  section: SpecDiagramSection,
): SpecDiagram[] {
  if (!diagrams?.length) return [];
  return diagrams.filter((d) => d.section === section);
}

function renderDiagramBlock(diagram: SpecDiagram): string[] {
  const lines: string[] = [];
  if (diagram.caption?.trim()) {
    lines.push(diagram.caption.trim());
    lines.push("");
  }
  lines.push("```mermaid");
  lines.push(diagram.mermaid.trim());
  lines.push("```");
  lines.push("");
  return lines;
}

function appendDiagrams(
  lines: string[],
  diagrams: SpecDiagram[] | undefined,
  section: SpecDiagramSection,
): void {
  for (const diagram of diagramsForSection(diagrams, section)) {
    lines.push(...renderDiagramBlock(diagram));
  }
}

function appendBulletStrings(lines: string[], items: unknown[] | undefined, heading: string): void {
  if (!items?.length) return;
  lines.push(`## ${heading}`);
  lines.push("");
  for (const item of items) {
    lines.push(`- ${typeof item === "string" ? item : oneLine(JSON.stringify(item))}`);
  }
  lines.push("");
}

export function renderSpecMarkdown(spec: Record<string, unknown>): string {
  const workItemId = String(spec.work_item_id ?? "");
  const title = String(spec.title ?? workItemId);
  const date = String(spec.date ?? "");
  const diagrams = Array.isArray(spec.diagrams)
    ? (spec.diagrams as SpecDiagram[]).filter(
        (d) => d && typeof d.mermaid === "string" && d.mermaid.trim().length > 0,
      )
    : undefined;

  const lines: string[] = [];
  lines.push(`# Spec: ${workItemId} — ${title}`);
  lines.push("");
  lines.push(
    `*Date: ${date}. **Authoritative contract:** \`spec.json\` in this directory (schema \`spec-schema.json\`). This file is generated from the JSON — edit the JSON, not this file.*`,
  );
  lines.push("");

  appendDiagrams(lines, diagrams, "overview");

  lines.push("## Problem Statement");
  lines.push("");
  lines.push(String(spec.problem_statement ?? ""));
  lines.push("");

  lines.push("## Proposed Solution");
  lines.push("");
  lines.push(String(spec.proposed_solution ?? ""));
  lines.push("");
  appendDiagrams(lines, diagrams, "proposed_solution");

  const criteria = (spec.acceptance_criteria as unknown[] | undefined) ?? [];
  lines.push("## Acceptance Criteria");
  lines.push("");
  for (const raw of criteria) {
    const ac = raw as Record<string, unknown>;
    const id = String(ac.id ?? "AC-?");
    const requirement = String(ac.requirement ?? "");
    const type = String(ac.type ?? "");
    lines.push(`### ${id} (${requirement}, ${type})`);
    lines.push("");
    lines.push(acBody(ac));
    lines.push("");
  }

  const scope = spec.scope as Record<string, unknown> | undefined;
  const scopeIn = (scope?.in as unknown[] | undefined) ?? [];
  const scopeOut = (scope?.out as unknown[] | undefined) ?? [];
  if (scopeIn.length || scopeOut.length) {
    lines.push("## Scope");
    lines.push("");
    if (scopeIn.length) {
      lines.push("### In");
      lines.push("");
      for (const item of scopeIn) {
        lines.push(`- ${typeof item === "string" ? item : oneLine(JSON.stringify(item))}`);
      }
      lines.push("");
    }
    if (scopeOut.length) {
      lines.push("### Out");
      lines.push("");
      for (const item of scopeOut) {
        const row = item as Record<string, unknown>;
        if (typeof item === "string") {
          lines.push(`- ${item}`);
        } else {
          lines.push(`- **${row.item}** — ${row.reason}`);
        }
      }
      lines.push("");
    }
    appendDiagrams(lines, diagrams, "scope");
  }

  const verification = spec.verification as Record<string, unknown> | undefined;
  const commands = (verification?.commands as string[] | undefined) ?? [];
  const testCases = (verification?.test_cases as unknown[] | undefined) ?? [];
  if (commands.length || testCases.length) {
    lines.push("## Verification");
    lines.push("");
    if (commands.length) {
      lines.push("### Commands");
      lines.push("");
      for (const cmd of commands) {
        lines.push(`- \`${cmd}\``);
      }
      lines.push("");
    }
    if (testCases.length) {
      lines.push("### Test Cases");
      lines.push("");
      for (const raw of testCases) {
        const tc = raw as Record<string, unknown>;
        const tier = tc.tier ? `, ${String(tc.tier)}` : "";
        lines.push(`- **${String(tc.id ?? "TC-?")}** → ${String(tc.covers ?? "?")}${tier}`);
        if (typeof tc.scenario === "string") {
          lines.push(`  - ${oneLine(tc.scenario)}`);
        }
      }
      lines.push("");
    }
    appendDiagrams(lines, diagrams, "verification");
  }

  const apiContract = (spec.api_contract as unknown[] | undefined) ?? [];
  if (apiContract.length) {
    lines.push("## API Contract");
    lines.push("");
    for (const raw of apiContract) {
      const row = raw as Record<string, unknown>;
      lines.push(`- **${String(row.symbol ?? "?")}** — ${String(row.description ?? "")}`);
    }
    lines.push("");
    appendDiagrams(lines, diagrams, "api_contract");
  }

  appendBulletStrings(lines, spec.constraints as string[] | undefined, "Constraints");
  appendBulletStrings(lines, spec.risks as string[] | undefined, "Risks");

  const rejected = (spec.rejected_alternatives as unknown[] | undefined) ?? [];
  if (rejected.length) {
    lines.push("## Rejected Alternatives");
    lines.push("");
    for (const raw of rejected) {
      const row = raw as Record<string, unknown>;
      lines.push(`- **${String(row.name ?? "?")}** — ${String(row.reason ?? "")}`);
    }
    lines.push("");
  }

  const resolved = (spec.resolved_questions as unknown[] | undefined) ?? [];
  if (resolved.length) {
    lines.push("## Resolved Questions");
    lines.push("");
    for (const raw of resolved) {
      const row = raw as Record<string, unknown>;
      lines.push(`- **${String(row.question ?? "?")}** — ${String(row.answer ?? "")}`);
    }
    lines.push("");
  }

  const security = spec.security_topology as Record<string, unknown> | undefined;
  if (security) {
    lines.push("## Security Topology");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(security, null, 2));
    lines.push("```");
    lines.push("");
    appendDiagrams(lines, diagrams, "security_topology");
  }

  const deployment = spec.deployment as Record<string, unknown> | undefined;
  if (deployment && Object.keys(deployment).length > 0) {
    lines.push("## Deployment");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(deployment, null, 2));
    lines.push("```");
    lines.push("");
    appendDiagrams(lines, diagrams, "deployment");
  }

  for (const { key, heading } of [
    { key: "infra_and_tooling", heading: "Infrastructure & Tooling" },
    { key: "dev_ergonomics", heading: "Dev Ergonomics" },
    { key: "test_topology", heading: "Test Topology" },
  ]) {
    const value = spec[key];
    if (value && typeof value === "object" && Object.keys(value as object).length > 0) {
      lines.push(`## ${heading}`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(value, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  const usedSections = new Set([
    "overview",
    "proposed_solution",
    "scope",
    "verification",
    "security_topology",
    "api_contract",
    "deployment",
  ]);
  const extra = (diagrams ?? []).filter((d) => !usedSections.has(String(d.section)));
  if (extra.length) {
    lines.push("## Diagrams");
    lines.push("");
    for (const diagram of extra) {
      lines.push(`### ${diagram.caption?.trim() || String(diagram.section)}`);
      lines.push("");
      lines.push(...renderDiagramBlock(diagram));
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
