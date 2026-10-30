/**
 * ASDLC-1/AC-7, ASDLC-1/TC-7, ASDLC-1/AC-26: with severity_gate unset and stack disabled,
 * review-security findings stay advisory and no round is gated.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  applyReviewCodePostResult,
  applyReviewSecurityPostResult,
} from "@clive.shirley/accord-core/orchestration/index.js";
import { resetSpawnPreflightCheckForTests } from "@clive.shirley/accord-core/queries/subagent-preflight-shared.js";
import {
  allFindings,
  baseConfig,
  setPhase,
  setupTempWorkItem,
} from "./helpers/security-gate-fixture.js";
import { readTaskFixture } from "./helpers/task-fixture.js";

const ID = "SGA";
let env: { cleanup: () => void };

beforeEach(() => {
  env = setupTempWorkItem(ID, "accord-sg-adv-");
  resetSpawnPreflightCheckForTests();
});
afterEach(() => env.cleanup());

const ALL_SEVERITIES = {
  verdict: "issues" as const,
  findings: [
    { severity: "critical", issue: "sec critical injection" },
    { severity: "warning", issue: "sec warning weak hash" },
    { severity: "suggestion", issue: "sec suggestion header" },
  ],
};

const CONFIGS: Array<[string, Record<string, unknown>]> = [
  ["no stack, no orchestration", {}],
  ["stack.enabled false", { stack: { enabled: false } }],
  [
    "stack.enabled false, gate unset in review_loop",
    { orchestration: { review_loop: { review_security: {} } } },
  ],
  [
    "explicit advisory",
    { orchestration: { review_loop: { review_security: { severity_gate: "advisory" } } } },
  ],
  [
    "review-code gates set to none do not leak into security (stack disabled)",
    {
      orchestration: {
        review_loop: { severity_gate: "none", review_code: { severity_gate: "none" } },
      },
    },
  ],
  [
    "explicit advisory even with stack.enabled true",
    {
      stack: { enabled: true },
      orchestration: { review_loop: { review_security: { severity_gate: "advisory" } } },
    },
  ],
];

describe("ASDLC-1/AC-7 default review-security is advisory", () => {
  for (const [name, extra] of CONFIGS) {
    test(`${name}: critical, warning and suggestion are all advisory; no retry consumed; advances to review-code`, () => {
      const note = applyReviewSecurityPostResult(ID, ALL_SEVERITIES, baseConfig(extra));
      expect(note).toContain("review-code");
      const findings = allFindings(ID);
      expect(findings.map((f) => f.severity).sort()).toEqual(["critical", "suggestion", "warning"]);
      for (const finding of findings) expect(finding.advisory).toBe(true);
      const task = readTaskFixture(ID, 1);
      expect(task.control.phase).toBe("review-code");
      expect(task.control.status).toBe("pending");
      expect(task.control.retries.code_review.used).toBe(0);
      expect(task.control.retries.code_review.lifetime).toBe(0);
    });
  }

  test("ASDLC-1/AC-7 following clean review-code is not sent back to phase-code by advisory security findings", () => {
    applyReviewSecurityPostResult(ID, ALL_SEVERITIES, baseConfig());
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, baseConfig());
    const task = readTaskFixture(ID, 1);
    expect(task.control.phase).not.toBe("phase-code");
    expect(task.control.phase).toBe("phase-verify-task");
    expect(task.control.retries.code_review.used).toBe(0);
  });

  test("ASDLC-1/AC-7 repeated critical security findings never block under defaults", () => {
    for (let round = 1; round <= 4; round++) {
      const cfg = baseConfig();
      applyReviewSecurityPostResult(ID, ALL_SEVERITIES, cfg);
      applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, cfg);
      const task = readTaskFixture(ID, 1);
      expect(task.control.phase).toBe("phase-verify-task");
      expect(task.control.status).not.toBe("blocked");
      const findings = allFindings(ID);
      expect(findings).toHaveLength(3);
      for (const finding of findings) expect(finding.advisory).toBe(true);
      expect(task.control.retries.code_review.used).toBe(0);
      expect(task.control.retries.code_review.lifetime).toBe(0);
      setPhase(ID, "review-security");
    }
  });

  test("ASDLC-1/AC-7 default note reports advisory counts and no gating", () => {
    const note = applyReviewSecurityPostResult(ID, ALL_SEVERITIES, baseConfig());
    expect(note).toContain("3 advisory finding(s)");
    expect(note).not.toContain("gating");
  });
});

describe("ASDLC-1/AC-26 defaults leave existing flow unchanged", () => {
  test("ASDLC-1/AC-26 default security→review-code→verify cycle creates no stack or knowledge artifacts", () => {
    // Guard only; TC-27 runtime smoke is owned by the runtime-smoke task.
    applyReviewSecurityPostResult(ID, ALL_SEVERITIES, baseConfig());
    applyReviewCodePostResult(ID, { verdict: "clean", findings: [] }, baseConfig());
    expect(readTaskFixture(ID, 1).control.phase).toBe("phase-verify-task");
    expect(existsSync(`docs/dev/${ID}/state`)).toBe(false);
    expect(existsSync(`docs/dev/${ID}/evidence`)).toBe(false);
    expect(existsSync("docs/features")).toBe(false);
  });
});
