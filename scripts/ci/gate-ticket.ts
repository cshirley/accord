/**
 * AC-3 (TC-2): Jira-ticket completeness gate.
 *
 * Deterministic eight-check pass. Returns ALL failed checks (not first-fail-
 * only) so the Jira comment can list every issue. The workflow YAML
 * translates a `{ok: false}` result into a structured Jira comment +
 * ticket transition to `Needs Triage` (configurable). No LLM call.
 *
 * Spec reference: docs/dev/TICKET-TO-PR-1/spec.json#AC-3.
 */

export interface JiraIssue {
  readonly key: string;
  readonly fields: {
    readonly issuetype: { readonly name: string };
    readonly status: { readonly name: string };
    readonly summary: string;
    readonly description: string;
  };
}

export interface TicketGateConfig {
  readonly descriptionMinLength: number;
  readonly allowedIssueTypes: readonly string[];
  readonly triggerStatus: string;
  readonly transitionOnFailure: string;
}

export const DEFAULT_TICKET_GATE_CONFIG: TicketGateConfig = {
  descriptionMinLength: 200,
  allowedIssueTypes: ["Story", "Task", "Bug"],
  triggerStatus: "Ready for Autopilot",
  transitionOnFailure: "Needs Triage",
};

export type TicketGateCheckId =
  | "description_too_short"
  | "missing_acceptance_criteria"
  | "missing_problem_framing"
  | "missing_out_of_scope"
  | "missing_target_paths"
  | "blocking_question_or_tbd"
  | "issue_type_not_allowed"
  | "status_mismatch";

export interface TicketGateFailedCheck {
  readonly id: TicketGateCheckId;
  readonly field: string;
  readonly remediation: string;
}

export type TicketGateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly failedChecks: readonly TicketGateFailedCheck[];
      readonly transition: string;
    };

const AC_HEADING_RE = /^##\s+(acceptance criteria|acceptance criterion|ACs?)\s*$/im;
const OUT_OF_SCOPE_RE = /^##\s+out of scope\s*$/im;
const TARGET_PATHS_RE = /^##\s+(target paths|paths|areas?|target area)\s*$/im;
const LIST_ITEM_RE = /^[-*]\s+\S+/m;
const WHAT_RE = /\bWHAT\s*[:\-]|\bwhat\b.*\?|## problem/i;
const WHY_RE = /\bWHY\s*[:\-]|\bwhy\b.*\?|## (motivation|context|background)/i;
const BLOCKING_RE = /\bTBD\b|\?{2,}|\bTODO\(\?\)|<\?>|\bunclear\b.*\?/i;

function checkDescriptionLength(desc: string, cfg: TicketGateConfig): TicketGateFailedCheck | null {
  if (desc.length < cfg.descriptionMinLength) {
    return {
      id: "description_too_short",
      field: "description",
      remediation: `description is ${desc.length} chars; minimum is ${cfg.descriptionMinLength}. Add problem statement, motivation, ACs, scope.`,
    };
  }
  return null;
}

function checkAcceptanceCriteria(desc: string): TicketGateFailedCheck | null {
  const headingMatch = AC_HEADING_RE.exec(desc);
  if (!headingMatch) {
    return {
      id: "missing_acceptance_criteria",
      field: "description",
      remediation: "add an `## Acceptance criteria` heading with at least one list item.",
    };
  }
  const after = desc.slice(headingMatch.index + headingMatch[0].length);
  const nextHeading = /\n##\s+/.exec(after);
  const section = nextHeading ? after.slice(0, nextHeading.index) : after;
  if (!LIST_ITEM_RE.test(section)) {
    return {
      id: "missing_acceptance_criteria",
      field: "description",
      remediation: "`## Acceptance criteria` section has no list items — add at least one bullet.",
    };
  }
  return null;
}

function checkProblemFraming(desc: string): TicketGateFailedCheck | null {
  if (!WHAT_RE.test(desc) || !WHY_RE.test(desc)) {
    return {
      id: "missing_problem_framing",
      field: "description",
      remediation: "describe both WHAT is happening and WHY it matters (use explicit `WHAT:` / `WHY:` labels or `## Problem` framing).",
    };
  }
  return null;
}

function checkOutOfScope(desc: string): TicketGateFailedCheck | null {
  if (!OUT_OF_SCOPE_RE.test(desc)) {
    return {
      id: "missing_out_of_scope",
      field: "description",
      remediation: "add an `## Out of scope` section so the agent knows what NOT to touch.",
    };
  }
  return null;
}

function checkTargetPaths(desc: string): TicketGateFailedCheck | null {
  if (!TARGET_PATHS_RE.test(desc)) {
    return {
      id: "missing_target_paths",
      field: "description",
      remediation: "add a `## Target paths` (or `## Areas`) section pointing the agent at the relevant files.",
    };
  }
  return null;
}

function checkBlockingQuestions(desc: string): TicketGateFailedCheck | null {
  if (BLOCKING_RE.test(desc)) {
    return {
      id: "blocking_question_or_tbd",
      field: "description",
      remediation: "remove blocking markers (TBD / ??? / `<?>`) before triggering the autopipeline — resolve them with the team first.",
    };
  }
  return null;
}

function checkIssueType(issue: JiraIssue, cfg: TicketGateConfig): TicketGateFailedCheck | null {
  if (!cfg.allowedIssueTypes.includes(issue.fields.issuetype.name)) {
    return {
      id: "issue_type_not_allowed",
      field: "issuetype.name",
      remediation: `issue type "${issue.fields.issuetype.name}" is not in the allow-list [${cfg.allowedIssueTypes.join(", ")}]; convert the ticket or extend allowedIssueTypes in accord-config.json.`,
    };
  }
  return null;
}

function checkStatusMatches(issue: JiraIssue, cfg: TicketGateConfig): TicketGateFailedCheck | null {
  if (issue.fields.status.name !== cfg.triggerStatus) {
    return {
      id: "status_mismatch",
      field: "status.name",
      remediation: `status "${issue.fields.status.name}" ≠ trigger "${cfg.triggerStatus}"; only the configured trigger status should invoke the autopipeline.`,
    };
  }
  return null;
}

export function runTicketGate(issue: JiraIssue, cfg: TicketGateConfig): TicketGateResult {
  const desc = issue.fields.description ?? "";
  const checks: (TicketGateFailedCheck | null)[] = [
    checkDescriptionLength(desc, cfg),
    checkAcceptanceCriteria(desc),
    checkProblemFraming(desc),
    checkOutOfScope(desc),
    checkTargetPaths(desc),
    checkBlockingQuestions(desc),
    checkIssueType(issue, cfg),
    checkStatusMatches(issue, cfg),
  ];
  const failed = checks.filter((c): c is TicketGateFailedCheck => c !== null);
  if (failed.length === 0) return { ok: true };
  return {
    ok: false,
    failedChecks: failed,
    transition: cfg.transitionOnFailure,
  };
}
