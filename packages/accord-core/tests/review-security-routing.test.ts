/**
 * ASDLC-1/AC-8, ASDLC-1/TC-8: after phase-code, open or disputed gating review-security findings
 * route back to review-security (even when the fix touches no security-sensitive path).
 * ASDLC-1/AC-26: the default advisory gate leaves routing unchanged.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  applyPhaseCodePostResult,
  applyReviewCodePostResult,
  applyReviewSecurityPostResult,
} from "@clive.shirley/accord-core/orchestration/index.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import type { FindingState } from "@clive.shirley/accord-core/tasks/types.js";
import {
  allFindings,
  baseConfig,
  setPhase,
  setupTempWorkItem,
} from "./helpers/security-gate-fixture.js";
import { readTaskFixture } from "./helpers/task-fixture.js";

const ID = "SGR";
let env: { cleanup: () => void };

beforeEach(() => {
  env = setupTempWorkItem(ID, "accord-sg-route-");
  resetSpawnPreflightCheckForTests();
});
afterEach(() => env.cleanup());

const CLEAN = { verdict: "clean" as const, findings: [] };
const NON_SENSITIVE = "packages/widgets/src/format-label.ts";
const SENSITIVE = "packages/widgets/src/auth/login.ts";

function cfgFor(gate: string | undefined, stackEnabled = true) {
  return baseConfig({
    ...(stackEnabled ? { stack: { enabled: true } } : {}),
    ...(gate
      ? { orchestration: { review_loop: { review_security: { severity_gate: gate } } } }
      : {}),
  });
}

function one(severity: string, issue: string) {
  return { verdict: "issues" as const, findings: [{ severity, issue }] };
}

function codePacket(file: string, responses: Array<Record<string, unknown>>) {
  return {
    status: "done",
    changes: [{ file, action: "modify", kind: "code", ac_ids: ["AC-1"] }],
    review_responses: responses,
  };
}

/** security finding raised, review-code round sends the task to phase-code. */
function seedPhaseCode(severity: string, issue: string, cfg: ReturnType<typeof cfgFor>): string {
  applyReviewSecurityPostResult(ID, one(severity, issue), cfg);
  applyReviewCodePostResult(ID, CLEAN, cfg);
  return allFindings(ID).find((f) => f.issue === issue)?.id ?? "";
}

describe("ASDLC-1/AC-8 phase-code routes gating security findings to review-security", () => {
  for (const resolution of ["fixed", "disputed"]) {
    for (const file of [NON_SENSITIVE, SENSITIVE]) {
      test(`${resolution} gating security finding, change ${file}: next phase is review-security`, () => {
        const cfg = cfgFor(undefined);
        const findingId = seedPhaseCode("critical", "sec critical injection", cfg);
        expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
        const note = applyPhaseCodePostResult(
          ID,
          codePacket(file, [{ finding_id: findingId, resolution, note: "handled" }]),
          cfg,
        );
        const task = readTaskFixture(ID, 1);
        expect(task.control.phase).toBe("review-security");
        expect(task.control.status).toBe("pending");
        expect(note).toContain("review-security");
      });
    }
  }

  test("unanswered (still open) gating security finding: next phase is review-security", () => {
    const cfg = cfgFor("block");
    seedPhaseCode("critical", "sec critical open", cfg);
    applyPhaseCodePostResult(ID, codePacket(NON_SENSITIVE, []), cfg);
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
  });

  test("security + code findings fixed together: review-security first, then review-code", () => {
    const cfg = cfgFor(undefined);
    applyReviewSecurityPostResult(ID, one("critical", "sec critical injection"), cfg);
    applyReviewCodePostResult(ID, one("critical", "code critical off-by-one"), cfg);
    const ids = allFindings(ID).map((f) => f.id);
    expect(ids).toHaveLength(2);
    applyPhaseCodePostResult(
      ID,
      codePacket(
        NON_SENSITIVE,
        ids.map((finding_id) => ({ finding_id, resolution: "fixed", note: "fixed" })),
      ),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
    applyReviewSecurityPostResult(ID, CLEAN, cfg);
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
  });

  test("gating code-only finding fixed, no security findings: next phase is review-code", () => {
    const cfg = cfgFor(undefined);
    applyReviewSecurityPostResult(ID, CLEAN, cfg);
    applyReviewCodePostResult(ID, one("critical", "code critical only"), cfg);
    const findingId = allFindings(ID)[0]?.id ?? "";
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: findingId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
  });

  test("security-sensitive change with no security findings still goes to review-security", () => {
    const cfg = cfgFor(undefined);
    applyReviewSecurityPostResult(ID, CLEAN, cfg);
    applyReviewCodePostResult(ID, one("critical", "code critical only"), cfg);
    const findingId = allFindings(ID)[0]?.id ?? "";
    applyPhaseCodePostResult(
      ID,
      codePacket(SENSITIVE, [{ finding_id: findingId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
  });
});

describe("ASDLC-1/AC-8 severity gate decides which security findings route back", () => {
  // [label, gate, severity, routes to review-security]
  const TABLE: Array<[string, string | undefined, string, boolean]> = [
    ["unset(warn) critical", undefined, "critical", true],
    ["unset(warn) warning", undefined, "warning", true],
    ["unset(warn) suggestion", undefined, "suggestion", false],
    ["block critical", "block", "critical", true],
    ["block warning", "block", "warning", false],
    ["block suggestion", "block", "suggestion", false],
    ["warn warning", "warn", "warning", true],
    ["warn suggestion", "warn", "suggestion", false],
    ["none suggestion", "none", "suggestion", true],
    ["none warning", "none", "warning", true],
  ];
  for (const [label, gate, severity, routes] of TABLE) {
    test(`${label}: ${routes ? "review-security" : "review-code"} after phase-code`, () => {
      const cfg = cfgFor(gate);
      applyReviewSecurityPostResult(ID, one(severity, "sec subject abc"), cfg);
      // a code finding forces the round to phase-code regardless of the security finding
      applyReviewCodePostResult(ID, one("critical", "code critical other"), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
      const responses = allFindings(ID).map((f) => ({
        finding_id: f.id,
        resolution: "fixed",
        note: "fixed",
      }));
      applyPhaseCodePostResult(ID, codePacket(NON_SENSITIVE, responses), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe(routes ? "review-security" : "review-code");
    });
  }

  // ASDLC-1/AC-8: explicit gate without any stack config still gates.
  // [label, gate, stackEnabled, severity, routes to review-security]
  const STACK_OFF: Array<[string, string, boolean, string, boolean]> = [
    ["block, stack off, critical", "block", false, "critical", true],
    ["block, stack off, warning", "block", false, "warning", false],
    ["warn, stack off, warning", "warn", false, "warning", true],
    ["none, stack off, suggestion", "none", false, "suggestion", true],
  ];
  for (const [label, gate, stackEnabled, severity, routes] of STACK_OFF) {
    test(`${label}: ${routes ? "review-security" : "review-code"} after phase-code`, () => {
      const cfg = cfgFor(gate, stackEnabled);
      applyReviewSecurityPostResult(ID, one(severity, "sec subject abc"), cfg);
      applyReviewCodePostResult(ID, one("critical", "code critical other"), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
      const responses = allFindings(ID).map((f) => ({
        finding_id: f.id,
        resolution: "fixed",
        note: "fixed",
      }));
      applyPhaseCodePostResult(ID, codePacket(NON_SENSITIVE, responses), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe(routes ? "review-security" : "review-code");
    });
  }

  test("block, stack off: disputed critical security finding routes to review-security", () => {
    const cfg = cfgFor("block", false);
    const secId = seedPhaseCode("critical", "sec critical injection", cfg);
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: secId, resolution: "disputed", note: "no" }]),
      cfg,
    );
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("review-security");
    expect(task.control.status).toBe("pending");
  });

  for (const [label, secFindings, routes] of [
    [
      "suggestion + critical",
      [
        { severity: "suggestion", issue: "sec suggestion header" },
        { severity: "critical", issue: "sec critical injection" },
      ],
      true,
    ],
    [
      "suggestion + warning",
      [
        { severity: "suggestion", issue: "sec suggestion header" },
        { severity: "warning", issue: "sec warning cookie" },
      ],
      false,
    ],
  ] as const) {
    test(`block gate, mixed security findings (${label}): ${routes ? "review-security" : "review-code"}`, () => {
      const cfg = cfgFor("block");
      applyReviewSecurityPostResult(
        ID,
        { verdict: "issues", findings: secFindings.map((f) => ({ ...f })) },
        cfg,
      );
      applyReviewCodePostResult(ID, one("critical", "code critical other"), cfg);
      const responses = allFindings(ID).map((f) => ({
        finding_id: f.id,
        resolution: "fixed",
        note: "fixed",
      }));
      applyPhaseCodePostResult(ID, codePacket(NON_SENSITIVE, responses), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe(routes ? "review-security" : "review-code");
    });
  }

  test("RGR precedence: test_issue with a gating security finding goes to phase-test", () => {
    const cfg = cfgFor(undefined);
    seedPhaseCode("critical", "sec critical injection", cfg);
    applyPhaseCodePostResult(
      ID,
      { ...codePacket(NON_SENSITIVE, []), events: [{ type: "test_issue", issue: "x" }] },
      cfg,
    );
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.rgr.used).toBe(1);
  });

  test("RGR precedence: changed test file with a gating security finding goes to phase-test", () => {
    const cfg = cfgFor(undefined);
    seedPhaseCode("critical", "sec critical injection", cfg);
    applyPhaseCodePostResult(ID, codePacket("packages/widgets/src/format-label.test.ts", []), cfg);
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.rgr.used).toBe(1);
  });

  test("resolved (verified) security finding no longer routes back", () => {
    const cfg = cfgFor(undefined);
    const secId = seedPhaseCode("critical", "sec critical injection", cfg);
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: secId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
    setPhase(ID, "review-security");
    applyReviewSecurityPostResult(
      ID,
      { verdict: "clean", findings: [], rechecks: [{ finding_id: secId, outcome: "verified" }] },
      cfg,
    );
    expect(allFindings(ID)[0]?.state).toBe("verified");
    // later round: only a code finding is open
    applyReviewCodePostResult(ID, one("critical", "code critical later"), cfg);
    const codeId = allFindings(ID).find((f) => f.issue === "code critical later")?.id ?? "";
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: codeId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
  });
});

describe("ASDLC-1/AC-8 review-security owns closing its findings", () => {
  test("review-security reraised recheck reopens the finding and phase-code gets it again", () => {
    const cfg = cfgFor(undefined);
    const secId = seedPhaseCode("critical", "sec critical injection", cfg);
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: secId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
    setPhase(ID, "review-security");
    applyReviewSecurityPostResult(
      ID,
      {
        verdict: "issues",
        findings: [],
        rechecks: [{ finding_id: secId, outcome: "reraised", note: "still injectable" }],
      },
      cfg,
    );
    expect(allFindings(ID)[0]?.state).toBe("reraised");
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
    applyReviewCodePostResult(ID, CLEAN, cfg);
    expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
  });

  // [label, phase-code response, review-security recheck outcome | none, expected state, expected phase]
  const PARTITION: Array<
    [
      string,
      string | undefined,
      string | undefined,
      FindingState,
      "review-security" | "review-code",
    ]
  > = [
    ["wont_fix proposed", "wont_fix", undefined, "wont_fix_proposed", "review-security"],
    ["reraised left unanswered", "fixed", "reraised", "reraised", "review-security"],
    ["dispute upheld", "disputed", "dispute_upheld", "dispute_upheld", "review-code"],
    ["wont_fix accepted", "wont_fix", "wont_fix_accepted", "wont_fix_accepted", "review-code"],
  ];
  for (const [label, response, recheck, state, phase] of PARTITION) {
    test(`finding state partition: ${label}`, () => {
      const cfg = cfgFor(undefined);
      const secId = seedPhaseCode("critical", "sec critical injection", cfg);
      if (!recheck) {
        applyPhaseCodePostResult(
          ID,
          codePacket(NON_SENSITIVE, [{ finding_id: secId, resolution: response, note: "n" }]),
          cfg,
        );
      } else {
        applyPhaseCodePostResult(
          ID,
          codePacket(NON_SENSITIVE, [{ finding_id: secId, resolution: response, note: "n" }]),
          cfg,
        );
        expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
        setPhase(ID, "review-security");
        applyReviewSecurityPostResult(
          ID,
          {
            verdict: recheck === "reraised" ? "issues" : "clean",
            findings: [],
            rechecks: [{ finding_id: secId, outcome: recheck, note: "ruled" }],
          },
          cfg,
        );
        expect(allFindings(ID).find((f) => f.id === secId)?.state).toBe(state);
        if (recheck === "reraised") {
          applyReviewCodePostResult(ID, CLEAN, cfg);
          applyPhaseCodePostResult(ID, codePacket(NON_SENSITIVE, []), cfg);
        } else {
          applyReviewCodePostResult(ID, one("critical", "code critical later"), cfg);
          const codeId = allFindings(ID).find((f) => f.issue === "code critical later")?.id ?? "";
          applyPhaseCodePostResult(
            ID,
            codePacket(NON_SENSITIVE, [{ finding_id: codeId, resolution: "fixed", note: "ok" }]),
            cfg,
          );
        }
      }
      expect(allFindings(ID).find((f) => f.id === secId)?.state).toBe(state);
      expect(readTaskFixture(ID, 1).control.phase).toBe(phase);
    });
  }

  test("review-code with a clean packet never implicitly closes a security finding", () => {
    const cfg = cfgFor(undefined);
    const secId = seedPhaseCode("critical", "sec critical injection", cfg);
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: secId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    setPhase(ID, "review-code");
    applyReviewCodePostResult(ID, CLEAN, cfg);
    const finding = allFindings(ID).find((f) => f.id === secId);
    expect(finding?.state).toBe("addressed");
    expect(finding?.history.map((h) => h.outcome)).not.toContain("verified");
  });

  test("disputed gating security finding is seen by review-security, not looped to the cap", () => {
    const cfg = cfgFor(undefined);
    const secId = seedPhaseCode("critical", "sec critical injection", cfg);
    const usedBefore = readTaskFixture(ID, 1).control.retries.code_review.used;
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [
        { finding_id: secId, resolution: "disputed", note: "not exploitable" },
      ]),
      cfg,
    );
    const task = readTaskFixture(ID, 1);
    expect(allFindings(ID)[0]?.state).toBe("disputed");
    expect(task.control.phase).toBe("review-security");
    expect(task.control.retries.code_review.used).toBe(usedBefore);
    expect(task.control.status).toBe("pending");
    // review-security rules on the dispute, then the loop ends without consuming the cap
    setPhase(ID, "review-security");
    applyReviewSecurityPostResult(
      ID,
      {
        verdict: "clean",
        findings: [],
        rechecks: [{ finding_id: secId, outcome: "dispute_upheld", note: "agreed" }],
      },
      cfg,
    );
    const ruled = allFindings(ID).find((f) => f.id === secId);
    expect(ruled?.state).toBe("dispute_upheld");
    expect(ruled?.history.at(-1)?.by).toContain("review-security");
    applyReviewCodePostResult(ID, CLEAN, cfg);
    const done = readTaskFixture(ID, 1);
    expect(done.control.phase).toBe("phase-verify-task");
    expect(done.control.retries.code_review.used).toBe(usedBefore);
  });
});

describe("ASDLC-1/AC-26 default advisory gate leaves routing unchanged", () => {
  for (const [label, makeCfg] of [
    ["no stack config", () => cfgFor(undefined, false)],
    ["stack.enabled false", () => baseConfig({ stack: { enabled: false } })],
  ] as const) {
    test(`${label}: advisory security finding, non-sensitive fix goes to review-code`, () => {
      const cfg = makeCfg() as ReturnType<typeof cfgFor>;
      applyReviewSecurityPostResult(ID, one("critical", "sec critical injection"), cfg);
      applyReviewCodePostResult(ID, one("critical", "code critical other"), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe("phase-code");
      const responses = allFindings(ID)
        .filter((f) => f.advisory !== true)
        .map((f) => ({ finding_id: f.id, resolution: "fixed", note: "ok" }));
      applyPhaseCodePostResult(ID, codePacket(NON_SENSITIVE, responses), cfg);
      expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
    });
  }

  test("explicit advisory gate with stack.enabled: sensitive path still routes review-security", () => {
    const cfg = cfgFor("advisory", true);
    applyReviewSecurityPostResult(ID, CLEAN, cfg);
    applyReviewCodePostResult(ID, one("critical", "code critical other"), cfg);
    const codeId = allFindings(ID)[0]?.id ?? "";
    applyPhaseCodePostResult(
      ID,
      codePacket(SENSITIVE, [{ finding_id: codeId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-security");
  });

  test("advisory gate: security finding with non-sensitive fix goes to review-code", () => {
    const cfg = cfgFor("advisory", true);
    applyReviewSecurityPostResult(ID, one("critical", "sec critical injection"), cfg);
    applyReviewCodePostResult(ID, one("critical", "code critical other"), cfg);
    const codeId = allFindings(ID).find((f) => f.issue === "code critical other")?.id ?? "";
    applyPhaseCodePostResult(
      ID,
      codePacket(NON_SENSITIVE, [{ finding_id: codeId, resolution: "fixed", note: "ok" }]),
      cfg,
    );
    expect(readTaskFixture(ID, 1).control.phase).toBe("review-code");
  });
});
