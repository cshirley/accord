/**
 * AC-2 (TC-1): AGENTS.md presence + schema gate.
 *
 * Runs before any LLM call. Performs the three (well, four) sub-checks in
 * order and returns a discriminated union. The workflow translates a
 * `{ok: false}` result into a structured Jira comment + ticket transition;
 * no LLM is invoked on the failure path.
 *
 * Spec reference: docs/dev/TICKET-TO-PR-1/spec.json#AC-2.
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type AgentsMdSubCheck =
  | "missing file"
  | "missing section"
  | "malformed JSON"
  | "missing test.command";

export interface GateConfig {
  readonly transitionOnFailure: string;
}

export type AgentsMdGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly subCheck: AgentsMdSubCheck;
      readonly remediation: string;
      readonly transition: string;
    };

const SECTION_HEADER_RE = /^##\s+Dev\s+Harness\s*$/m;

function readAgentsMd(repoRoot: string): string | null {
  const path = join(repoRoot, "AGENTS.md");
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }
  return readFileSync(path, "utf8");
}

/**
 * Extract the slice of AGENTS.md that belongs to the `## Dev Harness` section
 * — bounded by the next `## ` heading or EOF. Returns null if the section
 * header isn't present at all.
 */
function extractDevHarnessSection(md: string): string | null {
  const match = SECTION_HEADER_RE.exec(md);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = md.slice(start);
  const nextHeading = /\n##\s+/.exec(rest);
  return nextHeading ? rest.slice(0, nextHeading.index) : rest;
}

const FIRST_JSON_FENCE_RE = /```json\s*\n([\s\S]*?)```/;

function extractFirstJsonBlock(section: string): string | null {
  const match = FIRST_JSON_FENCE_RE.exec(section);
  const cap = match?.[1];
  return cap ?? null;
}

export function runAgentsMdGate(repoRoot: string, cfg: GateConfig): AgentsMdGateResult {
  const md = readAgentsMd(repoRoot);
  if (md === null) {
    return {
      ok: false,
      subCheck: "missing file",
      remediation: "commit AGENTS.md at the repo root with a `## Dev Harness` JSON block.",
      transition: cfg.transitionOnFailure,
    };
  }

  const section = extractDevHarnessSection(md);
  if (section === null) {
    return {
      ok: false,
      subCheck: "missing section",
      remediation: "add a `## Dev Harness` section to AGENTS.md (literal heading, level 2).",
      transition: cfg.transitionOnFailure,
    };
  }

  const jsonBlock = extractFirstJsonBlock(section);
  if (jsonBlock === null) {
    return {
      ok: false,
      subCheck: "malformed JSON",
      remediation:
        "add a fenced ```json block inside the `## Dev Harness` section with the harness config.",
      transition: cfg.transitionOnFailure,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return {
      ok: false,
      subCheck: "malformed JSON",
      remediation:
        "the first ```json block inside `## Dev Harness` failed to parse — fix the JSON syntax.",
      transition: cfg.transitionOnFailure,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      ok: false,
      subCheck: "missing test.command",
      remediation: "the harness JSON must be an object with a `test.command` string.",
      transition: cfg.transitionOnFailure,
    };
  }

  const testSection = (parsed as Record<string, unknown>).test;
  if (typeof testSection !== "object" || testSection === null) {
    return {
      ok: false,
      subCheck: "missing test.command",
      remediation: "add a `test` object with a non-empty `command` string to the harness JSON.",
      transition: cfg.transitionOnFailure,
    };
  }

  const command = (testSection as Record<string, unknown>).command;
  if (typeof command !== "string" || command === "") {
    return {
      ok: false,
      subCheck: "missing test.command",
      remediation: "set `test.command` to a non-empty string (e.g. `bun test` or `npm test`).",
      transition: cfg.transitionOnFailure,
    };
  }

  return { ok: true };
}
