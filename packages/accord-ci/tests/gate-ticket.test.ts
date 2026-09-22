import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_TICKET_GATE_CONFIG,
  type JiraIssue,
  runTicketGate,
  type TicketGateConfig,
} from "../src/gate-ticket.js";

const PASSING: JiraIssue = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/jira/gate-passing.json"), "utf8"),
);

const CFG: TicketGateConfig = {
  ...DEFAULT_TICKET_GATE_CONFIG,
  triggerStatus: "Ready for Autopilot",
  allowedIssueTypes: ["Story", "Task", "Bug"],
};

function makeIssue(patch: Partial<JiraIssue["fields"]>): JiraIssue {
  return {
    ...PASSING,
    fields: { ...PASSING.fields, ...patch },
  };
}

describe("runTicketGate — passing fixture", () => {
  test("canonical passing payload returns ok=true", () => {
    const r = runTicketGate(PASSING, CFG);
    expect(r.ok).toBe(true);
  });
});

describe("runTicketGate — eight sub-checks (AC-3)", () => {
  test("sub-check 1: description below threshold → failure 'description too short'", () => {
    const issue = makeIssue({ description: "Too short." });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const subs = r.failedChecks.map((c) => c.id);
      expect(subs).toContain("description_too_short");
    }
  });

  test("sub-check 2: missing AC block → failure 'missing acceptance criteria'", () => {
    const issue = makeIssue({
      description: PASSING.fields.description.replace(
        /## Acceptance criteria[\s\S]*?(?=\n## |$)/i,
        "",
      ),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("missing_acceptance_criteria");
    }
  });

  test("sub-check 2b: AC heading present but zero list items → failure 'missing acceptance criteria'", () => {
    const issue = makeIssue({
      description:
        "## Problem\n\nWHAT: x. WHY: y." +
        "\n\n## Acceptance criteria\n\n(no items)" +
        "\n\n## Out of scope\n- nope" +
        "\n\n## Target paths\n- foo/" +
        "\n\nLong padding ".repeat(50),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("missing_acceptance_criteria");
    }
  });

  test("sub-check 3: problem framing missing 'why' → failure 'missing_problem_framing'", () => {
    const issue = makeIssue({
      description: PASSING.fields.description.replace(/WHY:[\s\S]*?(?=\n\n|##)/i, ""),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("missing_problem_framing");
    }
  });

  test("sub-check 4: missing out-of-scope section → failure 'missing_out_of_scope'", () => {
    const issue = makeIssue({
      description: PASSING.fields.description.replace(/## Out of scope[\s\S]*?(?=\n## |$)/i, ""),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("missing_out_of_scope");
    }
  });

  test("sub-check 5: missing target paths → failure 'missing_target_paths'", () => {
    const issue = makeIssue({
      description: PASSING.fields.description.replace(/## Target paths[\s\S]*$/i, ""),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("missing_target_paths");
    }
  });

  test("sub-check 6: contains TBD → failure 'blocking_question_or_tbd'", () => {
    const issue = makeIssue({
      description: `${PASSING.fields.description}\n\nNote: rate threshold TBD with security team.`,
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("blocking_question_or_tbd");
    }
  });

  test("sub-check 6b: contains `???` → failure 'blocking_question_or_tbd'", () => {
    const issue = makeIssue({
      description: `${PASSING.fields.description}\n\nNote: spec is unclear ??? please confirm.`,
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("blocking_question_or_tbd");
    }
  });

  test("sub-check 7: issue type Epic (not in allow-list) → failure 'issue_type_not_allowed'", () => {
    const issue = makeIssue({ issuetype: { name: "Epic" } });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("issue_type_not_allowed");
    }
  });

  test("sub-check 8: status not equal to triggerStatus → failure 'status_mismatch'", () => {
    const issue = makeIssue({ status: { name: "In Progress" } });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("status_mismatch");
    }
  });
});

describe("runTicketGate — adversary: list ALL failures (AC-3)", () => {
  test("ticket failing 3 sub-checks reports all 3, not just the first", () => {
    const issue = makeIssue({
      description: "Way too short — clearly missing everything.",
      issuetype: { name: "Epic" },
      status: { name: "Backlog" },
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const ids = r.failedChecks.map((c) => c.id);
      expect(ids).toContain("description_too_short");
      expect(ids).toContain("issue_type_not_allowed");
      expect(ids).toContain("status_mismatch");
      // Implies missing_acceptance_criteria + missing_problem_framing + missing_out_of_scope
      // + missing_target_paths are also detected.
      expect(r.failedChecks.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("each failed check exposes a one-line remediation", () => {
    const issue = makeIssue({ status: { name: "Backlog" } });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      for (const c of r.failedChecks) {
        expect(typeof c.remediation).toBe("string");
        expect(c.remediation.length).toBeGreaterThan(0);
        expect(c.remediation.includes("\n")).toBe(false);
      }
    }
  });

  test("each failed check exposes the field it inspected (for jira-comment formatting)", () => {
    const issue = makeIssue({ issuetype: { name: "Epic" }, status: { name: "Backlog" } });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issueTypeCheck = r.failedChecks.find((c) => c.id === "issue_type_not_allowed");
      expect(issueTypeCheck?.field).toBe("issuetype.name");
      const statusCheck = r.failedChecks.find((c) => c.id === "status_mismatch");
      expect(statusCheck?.field).toBe("status.name");
    }
  });

  test("transition target is 'Needs Triage' on any failure", () => {
    const issue = makeIssue({ status: { name: "Backlog" } });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.transition).toBe("Needs Triage");
    }
  });
});

describe("runTicketGate — adversary: configurability", () => {
  test("description threshold is configurable (lowering it lets the short fixture pass)", () => {
    const issue = makeIssue({
      description:
        "## Problem\n\nWHAT: x. WHY: y." +
        "\n\n## Acceptance criteria\n- AC1: foo" +
        "\n\n## Out of scope\n- nope" +
        "\n\n## Target paths\n- foo/",
    });
    const longEnough = runTicketGate(issue, { ...CFG, descriptionMinLength: 1 });
    const tooShort = runTicketGate(issue, { ...CFG, descriptionMinLength: 9999 });
    expect(tooShort.ok).toBe(false);
    expect(longEnough.ok).toBe(true);
  });

  test("allowedIssueTypes is configurable (Epic accepted when listed)", () => {
    const issue = makeIssue({ issuetype: { name: "Epic" } });
    const r = runTicketGate(issue, { ...CFG, allowedIssueTypes: ["Epic"] });
    expect(r.ok).toBe(true);
  });

  test("triggerStatus is configurable", () => {
    const issue = makeIssue({ status: { name: "Custom Trigger" } });
    const r = runTicketGate(issue, { ...CFG, triggerStatus: "Custom Trigger" });
    expect(r.ok).toBe(true);
  });

  test("transitionOnFailure can be overridden in config", () => {
    const issue = makeIssue({ status: { name: "Backlog" } });
    const r = runTicketGate(issue, { ...CFG, transitionOnFailure: "Custom Triage Lane" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.transition).toBe("Custom Triage Lane");
    }
  });
});

describe("runTicketGate — no LLM call (AC-3, TC-2)", () => {
  test("gate is synchronous (not a Promise)", () => {
    const r = runTicketGate(PASSING, CFG);
    expect(r).not.toBeInstanceOf(Promise);
  });
});

describe("runTicketGate — adversary: false-positive guards", () => {
  test("ticket with only a `## Problem` heading but no WHY content fails 'missing_problem_framing'", () => {
    const issue = makeIssue({
      description:
        "## Problem\n\nSomething is wrong somewhere." +
        "\n\n## Acceptance criteria\n- AC1: foo" +
        "\n\n## Out of scope\n- nope" +
        "\n\n## Target paths\n- foo/" +
        "\n\n" +
        "padding ".repeat(50),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("missing_problem_framing");
    }
  });

  test("AC heading `## Acceptance Criterion` (singular) is accepted", () => {
    const issue = makeIssue({
      description: PASSING.fields.description.replace(
        /## Acceptance criteria/i,
        "## Acceptance Criterion",
      ),
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(true);
  });

  test("issue type allow-list is case-sensitive (defensive — Jira API returns canonical casing)", () => {
    const issue = makeIssue({ issuetype: { name: "story" } });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failedChecks.map((c) => c.id)).toContain("issue_type_not_allowed");
    }
  });

  test("blocking-question regex does NOT match plain `?` (single question marks are fine)", () => {
    const issue = makeIssue({
      description: `${PASSING.fields.description}\n\nIs this a question? Yes it is.`,
    });
    const r = runTicketGate(issue, CFG);
    expect(r.ok).toBe(true);
  });
});
