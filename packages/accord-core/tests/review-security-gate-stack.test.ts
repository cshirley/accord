/**
 * ASDLC-1/AC-8, ASDLC-1/TC-8: review-security gates inside the existing C loop when the
 * effective gate is warn/block/none (stack.enabled defaults to warn).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  applyReviewCodePostResult,
  applyReviewSecurityPostResult,
} from "@clive.shirley/accord-core/orchestration/index.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import { renderFindingsBrief } from "@clive.shirley/accord-core/tasks/render.js";
import {
  allFindings,
  baseConfig,
  markFixed,
  setPhase,
  setupTempWorkItem,
} from "./helpers/security-gate-fixture.js";
import { readTaskFixture } from "./helpers/task-fixture.js";

const ID = "SGB";
let env: { cleanup: () => void };

beforeEach(() => {
  env = setupTempWorkItem(ID, "accord-sg-stack-");
  resetSpawnPreflightCheckForTests();
});
afterEach(() => env.cleanup());

const MIXED = {
  verdict: "issues" as const,
  findings: [
    { severity: "critical", issue: "sec critical injection" },
    { severity: "warning", issue: "sec warning weak hash" },
    { severity: "suggestion", issue: "sec suggestion header" },
  ],
};

function gateConfig(gate: string | undefined, stackEnabled: boolean) {
  return baseConfig({
    ...(stackEnabled ? { stack: { enabled: true } } : {}),
    ...(gate
      ? { orchestration: { review_loop: { review_security: { severity_gate: gate } } } }
      : {}),
  });
}

// [label, gate, stack.enabled, gating severities]
const TABLE: Array<[string, string | undefined, boolean, string[]]> = [
  ["stack.enabled + unset => warn", undefined, true, ["critical", "warning"]],
  ["block", "block", true, ["critical"]],
  ["warn", "warn", true, ["critical", "warning"]],
  ["none", "none", true, ["critical", "warning", "suggestion"]],
  ["block without stack.enabled", "block", false, ["critical"]],
  ["warn without stack.enabled", "warn", false, ["critical", "warning"]],
  ["none without stack.enabled", "none", false, ["critical", "warning", "suggestion"]],
];

describe("ASDLC-1/AC-8 gate severity table", () => {
  for (const [label, gate, stackEnabled, gating] of TABLE) {
    test(`${label}: gating=${gating.join("+")}, rest advisory; still advances to review-code`, () => {
      const note = applyReviewSecurityPostResult(ID, MIXED, gateConfig(gate, stackEnabled));
      expect(note).toContain(`${String(gating.length)} gating`);
      expect(note).toContain(`${String(3 - gating.length)} advisory`);
      const findings = allFindings(ID);
      expect(findings).toHaveLength(3);
      for (const finding of findings) {
        expect(finding.advisory === true).toBe(!gating.includes(finding.severity));
      }
      const task = readTaskFixture(ID, 1);
      expect(task.control.phase).toBe("review-code");
      expect(task.control.status).toBe("pending");
      // security itself never consumes a retry; the C round decision happens in review-code
      expect(task.control.retries.code_review.used).toBe(0);
    });
  }

  test("ASDLC-1/AC-8 suggestions only: nothing gates under warn or block", () => {
    const suggestionOnly = {
      verdict: "issues" as const,
      findings: [{ severity: "suggestion", issue: "sec suggestion only" }],
    };
    for (const gate of ["warn", "block"]) {
      applyReviewSecurityPostResult(ID, suggestionOnly, gateConfig(gate, true));
      applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, gateConfig(gate, true));
      expect(readTaskFixture(ID, 1).control.phase).toBe("phase-verify-task");
      expect(readTaskFixture(ID, 1).control.retries.code_review.used).toBe(0);
      setPhase(ID, "review-security");
    }
  });

  test("ASDLC-1/AC-8 warning gates under warn but not under block (round routing)", () => {
    const warningOnly = {
      verdict: "issues" as const,
      findings: [{ severity: "warning", issue: "sec warning only" }],
    };
    applyReviewSecurityPostResult(ID, warningOnly, gateConfig("block", true));
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, gateConfig("block", true));
    expect(readTaskFixture(ID, 1).control.phase).toBe("phase-verify-task");

    setPhase(ID, "review-security");
    applyReviewSecurityPostResult(ID, warningOnly, gateConfig("warn", true));
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, gateConfig("warn", true));
    expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
  });
});

describe("ASDLC-1/AC-8 security fix flows through the C loop", () => {
  const SEC = {
    verdict: "issues" as const,
    findings: [{ severity: "critical", issue: "sec critical injection" }],
  };
  const CODE = {
    verdict: "issues" as const,
    findings: [{ severity: "critical", issue: "code critical off-by-one" }],
  };

  test("next C round goes to phase-code with security and code findings together", () => {
    const cfg = gateConfig(undefined, true);
    applyReviewSecurityPostResult(ID, SEC, cfg);
    const note = applyReviewCodePostResult(ID, CODE, cfg);
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.code_review.used).toBe(1);
    const open = allFindings(ID).filter((f) => f.advisory !== true);
    expect(open.map((f) => f.issue).sort()).toEqual([
      "code critical off-by-one",
      "sec critical injection",
    ]);
    for (const finding of open) expect(note).toContain(finding.id);
    const brief = renderFindingsBrief(readTaskFixture(ID, 1), "phase-code");
    for (const finding of open) expect(brief).toContain(finding.id);
  });

  test("security-only gating finding still sends the task to phase-code via review-code", () => {
    const cfg = gateConfig("block", true);
    applyReviewSecurityPostResult(ID, SEC, cfg);
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.code_review.used).toBe(1);
  });

  test("review-code re-reviews the fix: verified recheck clears the gate and advances", () => {
    const cfg = gateConfig(undefined, true);
    applyReviewSecurityPostResult(ID, SEC, cfg);
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
    const securityFinding = allFindings(ID).find((f) => f.issue === "sec critical injection");
    expect(securityFinding).toBeDefined();
    const findingId = securityFinding?.id ?? "";

    // phase-code fixed it; harness reaches review-code again (via review-security).
    setPhase(ID, "review-security");
    applyReviewSecurityPostResult(ID, { verdict: "clean", findings: [] }, cfg);
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
    applyReviewCodePostResult(
      ID,
      {
        verdict: "clean",
        findings: [],
        rechecks: [{ finding_id: findingId, outcome: "verified", note: "fixed" }],
      },
      cfg,
    );
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("phase-verify-task");
    expect(task.control.retries.code_review.used).toBe(1);
  });

  test("review-code re-raising the security finding keeps the loop in phase-code", () => {
    const cfg = gateConfig(undefined, true);
    applyReviewSecurityPostResult(ID, SEC, cfg);
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
    const findingId = allFindings(ID)[0]?.id ?? "";
    setPhase(ID, "review-code");
    applyReviewCodePostResult(
      ID,
      {
        verdict: "issues",
        findings: [],
        rechecks: [{ finding_id: findingId, outcome: "reraised", note: "still injectable" }],
      },
      cfg,
    );
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.code_review.used).toBe(2);
    const finding = allFindings(ID).find((f) => f.id === findingId);
    expect(finding?.state).toBe("reraised");
    expect(finding?.history.at(-1)?.by).toContain("review-code");
  });

  test("at the code_review retry cap the task blocks for a human (shared counter, no new loop)", () => {
    const cfg = gateConfig(undefined, true);
    for (let attempt = 1; attempt <= 3; attempt++) {
      applyReviewSecurityPostResult(ID, SEC, cfg);
      applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
      const task = readTaskFixture(ID, 1);
      expect(task.control.phase).toBe("phase-code");
      expect(task.control.retries.code_review.used).toBe(attempt);
      setPhase(ID, "review-security");
    }
    applyReviewSecurityPostResult(ID, SEC, cfg);
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
    const blocked = readTaskFixture(ID, 1);
    expect(blocked.control.status).toBe("blocked");
    expect(blocked.control.blocked?.kind).toBe("cap");
    expect(blocked.control.blocked?.loop).toBe("C");
  });
});

describe("ASDLC-1/AC-8 re-raising an addressed security finding keeps it gating", () => {
  const one = (severity: string, issue: string) => ({
    verdict: "issues" as const,
    findings: [{ severity, issue }],
  });
  const clean = { verdict: "clean" as const, findings: [] };

  // [label, reraiser, how, gate, stack, severity, expectGating]
  const ROWS: Array<
    [
      string,
      "review-code" | "review-security",
      "recheck" | "similar",
      string | undefined,
      boolean,
      string,
      boolean,
    ]
  > = [
    [
      "review-code recheck, warn, warning",
      "review-code",
      "recheck",
      undefined,
      true,
      "warning",
      true,
    ],
    [
      "review-code similar issue, warn, warning",
      "review-code",
      "similar",
      undefined,
      true,
      "warning",
      true,
    ],
    [
      "review-code recheck, none, suggestion",
      "review-code",
      "recheck",
      "none",
      true,
      "suggestion",
      true,
    ],
    [
      "review-security recheck, warn, warning",
      "review-security",
      "recheck",
      undefined,
      true,
      "warning",
      true,
    ],
    [
      "review-security recheck, default config, critical",
      "review-security",
      "recheck",
      undefined,
      false,
      "critical",
      false,
    ],
  ];

  for (const [label, reraiser, how, gate, stackEnabled, severity, gating] of ROWS) {
    test(`${label}`, () => {
      const cfg = gateConfig(gate, stackEnabled);
      const issue = "sec reraise subject xyz";
      applyReviewSecurityPostResult(ID, one(severity, issue), cfg);
      applyReviewCodePostResult(ID, clean, cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe(
        gating ? "phase-code" : "phase-verify-task",
      );
      const findingId = allFindings(ID)[0]?.id ?? "";
      markFixed(ID, findingId);
      expect(allFindings(ID)[0]?.state).toBe("addressed");

      if (reraiser === "review-code") {
        setPhase(ID, "review-code");
        const packet =
          how === "recheck"
            ? {
                verdict: "issues" as const,
                findings: [],
                rechecks: [{ finding_id: findingId, outcome: "reraised", note: "still broken" }],
              }
            : one(severity, issue);
        applyReviewCodePostResult(ID, packet, cfg);
      } else {
        setPhase(ID, "review-security");
        applyReviewSecurityPostResult(
          ID,
          {
            verdict: "issues" as const,
            findings: [],
            rechecks: [{ finding_id: findingId, outcome: "reraised", note: "still broken" }],
          },
          cfg,
        );
        applyReviewCodePostResult(ID, clean, cfg);
      }

      const findings = allFindings(ID);
      expect(findings).toHaveLength(1); // re-raised, not a new id
      expect(findings[0]?.id).toBe(findingId);
      expect(findings[0]?.state).toBe("reraised");
      expect(findings[0]?.advisory).toBe(gating ? undefined : true);
      const task = readTaskFixture(ID, 1);
      expect(task.control.phase).toBe(gating ? "phase-code" : "phase-verify-task");
      expect(task.control.retries.code_review.used).toBe(gating ? 2 : 0);
    });
  }
});

describe("ASDLC-1/AC-8 configured code_review cap governs security-driven rounds", () => {
  test("max_retries 1: second security→review-code round blocks and lists the security finding", () => {
    const cfg = baseConfig({
      stack: { enabled: true },
      orchestration: { review_loop: { review_code: { max_retries: 1 } } },
    });
    const sec = {
      verdict: "issues" as const,
      findings: [{ severity: "critical", issue: "sec critical injection" }],
    };
    applyReviewSecurityPostResult(ID, sec, cfg);
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
    expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
    expect(readTaskFixture(ID, 1).control.retries.code_review.used).toBe(1);
    setPhase(ID, "review-security");
    applyReviewSecurityPostResult(ID, sec, cfg);
    const note = applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
    const task = readTaskFixture(ID, 1);
    expect(task.control.status).toBe("blocked");
    expect(task.control.blocked?.loop).toBe("C");
    expect(task.control.blocked?.reason).toContain("retry cap reached (1)");
    const securityId = allFindings(ID)[0]?.id ?? "";
    expect(note).toContain("Blocking findings");
    expect(note).toContain(securityId);
  });
});
