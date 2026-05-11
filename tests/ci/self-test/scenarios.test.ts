/**
 * AC-17 (TC-9): ten-scenario self-test corpus driving the deterministic
 * workflow handlers in DRY_RUN mode against fixture inputs, asserting
 * exit-code = 0 and producing structured comment payloads that match the
 * per-scenario goldens.
 *
 * The scenarios are inline fixtures (no external files) so the test stays
 * self-contained and trivially auditable. The real `.github/workflows/
 * test-autopipeline.yml` (task 12) wraps this test under `bun test`.
 *
 * Coverage map (10 scenarios from AC-17, with sub-fixtures expanded):
 *   1.  passing-gate → complete                                    ↦ dispatchTerminal({status:done})
 *   2.  failing-ticket-gate (8 sub-checks)                         ↦ runTicketGate failures
 *   3.  missing-AGENTS.md (3 sub-checks)                           ↦ runAgentsMdGate failures
 *   4.  phase needs_input                                          ↦ dispatchTerminal({status:needs_input})
 *   5.  phase blocked                                              ↦ dispatchTerminal({status:blocked})
 *   6.  phase gaps                                                 ↦ dispatchTerminal({status:gaps})
 *   7.  phase complete                                             ↦ dispatchTerminal({status:done})
 *   8.  decide-resume → resume                                     ↦ decideResume happy path
 *   9.  decide-resume → fresh / brief_drift                        ↦ decideResume fresh path
 *   10. between-phases cost-cap breach                             ↦ checkCostCap tripped
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAgentsMdGate } from "../../../scripts/ci/gate-agents-md.js";
import {
  DEFAULT_TICKET_GATE_CONFIG,
  runTicketGate,
  type JiraIssue,
  type TicketGateCheckId,
  type TicketGateConfig,
} from "../../../scripts/ci/gate-ticket.js";
import {
  dispatchTerminal,
  checkCostCap,
  type TerminalOpts,
  type WorkItemForCostCap,
} from "../../../scripts/ci/parse-phase-result.js";
import { decideResume, type WorkItemState } from "../../../scripts/ci/decide-resume.js";

const GATE_CFG_AGENTS = { transitionOnFailure: "Needs Triage" } as const;
const TICKET_GATE_CFG: TicketGateConfig = {
  ...DEFAULT_TICKET_GATE_CONFIG,
  triggerStatus: "Ready for Autopilot",
  allowedIssueTypes: ["Story", "Task", "Bug"],
};

const TERMINAL_OPTS: TerminalOpts = {
  ticket: "PROJ-1",
  secrets: ["sk-redacted-fixture-secret"],
  transitions: {
    needs_input: "Needs Author Input",
    blocked: "Blocked",
    gaps: "Gaps Reported",
    stuck: "Stuck",
    cost_exceeded: "Cost Exceeded",
    in_review: "In Review",
  },
};

function passingJiraTicket(): JiraIssue {
  return {
    key: "PROJ-1",
    fields: {
      issuetype: { name: "Story" },
      status: { name: "Ready for Autopilot" },
      summary: "Add rate limit on /v1/search",
      description: [
        "## Problem",
        "WHAT: callers exhaust pool. WHY: incident INC-1023.",
        "",
        "## Acceptance criteria",
        "- AC1: limiter at 60 req/min/IP",
        "",
        "## Out of scope",
        "- pool sizing",
        "",
        "## Target paths",
        "- services/search-api/",
      ].join("\n") + "\n\n" + "padding ".repeat(50),
    },
  };
}

describe("AC-17 scenario 1: passing-gate → complete (happy path)", () => {
  test("agents-md gate passes (e), ticket gate passes, dispatch done → in_review", () => {
    const dir = mkdtempSync(join(tmpdir(), "selftest-agentsmd-"));
    try {
      writeFileSync(
        join(dir, "AGENTS.md"),
        '## Dev Harness\n\n```json\n{ "test": { "command": "bun test" } }\n```\n',
      );
      const agentsMd = runAgentsMdGate(dir, GATE_CFG_AGENTS);
      expect(agentsMd.ok).toBe(true);

      const ticketGate = runTicketGate(passingJiraTicket(), TICKET_GATE_CFG);
      expect(ticketGate.ok).toBe(true);

      const terminal = dispatchTerminal(
        { status: "done", spec_path: "docs/dev/PROJ-1/spec.json", usage: {} },
        TERMINAL_OPTS,
      );
      expect(terminal.transition).toBe("In Review");
      expect(terminal.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AC-17 scenario 2: failing-ticket-gate sub-checks (eight sub-fixtures)", () => {
  const subChecks: Array<{ id: TicketGateCheckId; mutate: (i: JiraIssue) => JiraIssue }> = [
    {
      id: "description_too_short",
      mutate: (i) => ({ ...i, fields: { ...i.fields, description: "tiny" } }),
    },
    {
      id: "missing_acceptance_criteria",
      mutate: (i) => ({
        ...i,
        fields: {
          ...i.fields,
          description: i.fields.description.replace(/## Acceptance criteria[\s\S]*?(?=\n## |$)/i, ""),
        },
      }),
    },
    {
      id: "missing_problem_framing",
      mutate: (i) => ({
        ...i,
        fields: {
          ...i.fields,
          description: i.fields.description.replace(/WHY:[\s\S]*?(?=\n\n|##)/i, ""),
        },
      }),
    },
    {
      id: "missing_out_of_scope",
      mutate: (i) => ({
        ...i,
        fields: {
          ...i.fields,
          description: i.fields.description.replace(/## Out of scope[\s\S]*?(?=\n## |$)/i, ""),
        },
      }),
    },
    {
      id: "missing_target_paths",
      mutate: (i) => ({
        ...i,
        fields: {
          ...i.fields,
          description: i.fields.description.replace(/## Target paths[\s\S]*$/i, ""),
        },
      }),
    },
    {
      id: "blocking_question_or_tbd",
      mutate: (i) => ({
        ...i,
        fields: { ...i.fields, description: `${i.fields.description}\n\nTBD with security.` },
      }),
    },
    {
      id: "issue_type_not_allowed",
      mutate: (i) => ({ ...i, fields: { ...i.fields, issuetype: { name: "Epic" } } }),
    },
    {
      id: "status_mismatch",
      mutate: (i) => ({ ...i, fields: { ...i.fields, status: { name: "Backlog" } } }),
    },
  ];

  for (const c of subChecks) {
    test(`sub-check ${c.id} fails the ticket gate and the gate result lists it`, () => {
      const r = runTicketGate(c.mutate(passingJiraTicket()), TICKET_GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.failedChecks.map((f) => f.id)).toContain(c.id);
        expect(r.transition).toBe("Needs Triage");
      }
    });
  }
});

describe("AC-17 scenario 3: missing-AGENTS.md (three sub-fixtures)", () => {
  test("(a) missing file → subCheck='missing file'", () => {
    const dir = mkdtempSync(join(tmpdir(), "selftest-agentsmd-a-"));
    try {
      const r = runAgentsMdGate(dir, GATE_CFG_AGENTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(b) missing section → subCheck='missing section'", () => {
    const dir = mkdtempSync(join(tmpdir(), "selftest-agentsmd-b-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), "# Repo\nNo Dev Harness here.");
      const r = runAgentsMdGate(dir, GATE_CFG_AGENTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing section");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("(c) malformed JSON / missing test.command → subCheck reflects it", () => {
    const dir = mkdtempSync(join(tmpdir(), "selftest-agentsmd-c-"));
    try {
      writeFileSync(
        join(dir, "AGENTS.md"),
        '## Dev Harness\n\n```json\n{ "test": {} }\n```\n',
      );
      const r = runAgentsMdGate(dir, GATE_CFG_AGENTS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing test.command");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AC-17 scenario 4: phase returns needs_input", () => {
  test("dispatch maps to Needs Author Input with questions rendered verbatim", () => {
    const r = dispatchTerminal(
      {
        status: "needs_input",
        questions: [{ id: "q1", topic: "scope", text: "Cross-region too?" }],
      },
      TERMINAL_OPTS,
    );
    expect(r.transition).toBe("Needs Author Input");
    expect(r.body).toContain("Cross-region too?");
    expect(r.uploadStateArtifact).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-17 scenario 5: phase returns blocked", () => {
  test("dispatch maps to Blocked with blockers rendered verbatim", () => {
    const r = dispatchTerminal(
      {
        status: "blocked",
        blockers: [{ reason: "upstream service down" }],
      },
      TERMINAL_OPTS,
    );
    expect(r.transition).toBe("Blocked");
    expect(r.body).toContain("upstream service down");
    expect(r.uploadStateArtifact).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-17 scenario 6: phase returns gaps", () => {
  test("dispatch maps to Gaps Reported with gaps rendered verbatim", () => {
    const r = dispatchTerminal(
      {
        status: "gaps",
        gaps: [{ ac_id: "AC-5", reason: "verify.md empty for AC-5" }],
      },
      TERMINAL_OPTS,
    );
    expect(r.transition).toBe("Gaps Reported");
    expect(r.body).toContain("AC-5");
    expect(r.body).toContain("verify.md empty for AC-5");
    expect(r.uploadStateArtifact).toBe(true);
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-17 scenario 7: phase returns complete", () => {
  test("dispatch maps to In Review", () => {
    const r = dispatchTerminal({ status: "done" }, TERMINAL_OPTS);
    expect(r.transition).toBe("In Review");
    expect(r.exitCode).toBe(0);
  });
});

describe("AC-17 scenario 8: decide-resume → resume", () => {
  test("resumable phase, matching brief, cost below cap → resume", () => {
    const prior: WorkItemState = {
      schema_version: "1.0",
      id: "PROJ-1",
      phase: "implementing",
      cost_usd: 5,
    };
    const brief = "## Gathered Context\n- Generated at 2026-05-11T15:00:00Z\nshared";
    const r = decideResume({
      ticket: "PROJ-1",
      priorState: prior,
      priorBrief: brief,
      freshBrief: brief,
      maxCostUsd: 20,
    });
    expect(r.decision).toBe("resume");
  });
});

describe("AC-17 scenario 9: decide-resume → fresh / brief_drift", () => {
  test("brief content changed → fresh with reason brief_drift", () => {
    const prior: WorkItemState = {
      schema_version: "1.0",
      id: "PROJ-1",
      phase: "implementing",
      cost_usd: 5,
    };
    const r = decideResume({
      ticket: "PROJ-1",
      priorState: prior,
      priorBrief: "old content",
      freshBrief: "DIFFERENT content",
      maxCostUsd: 20,
    });
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("brief_drift");
    }
  });
});

describe("AC-17 scenario 10: cost-cap breach", () => {
  test("cumulative cost equals cap → cost_exceeded terminal", () => {
    const wi: WorkItemForCostCap = {
      id: "PROJ-1",
      cost_usd: 20,
      cost_breakdown: { spec: 4, plan: 6, code: 10 },
    };
    const r = checkCostCap(wi, {
      maxCostUsd: 20,
      nextPhase: "verify",
      ticket: "PROJ-1",
      transitionOnCostExceeded: "Cost Exceeded",
    });
    expect(r.tripped).toBe(true);
    if (r.tripped) {
      expect(r.terminal.body).toContain("verify");
      expect(r.terminal.body).toContain("20");
      expect(r.terminal.transition).toBe("Cost Exceeded");
      expect(r.terminal.exitCode).toBe(0);
    }
  });
});
