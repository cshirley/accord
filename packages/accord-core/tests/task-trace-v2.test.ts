/**
 * Task file v2: full adversarial flow across test / code / RGR / verify loops, recovery, unblock,
 * briefs, and schema conformance.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  applyPhaseCodePostResult,
  applyPhaseTestPostResult,
  applyPhaseVerifyTaskPostResult,
  applyReviewCodePostResult,
  applyReviewSecurityPostResult,
  applyReviewTestPostResult,
} from "@clive.shirley/accord-core/orchestration/post-result/index.js";
import { recoverReturnedInFlight } from "@clive.shirley/accord-core/orchestration/recover-task-packet.js";
import {
  markTaskAgentSpawned,
  recordTaskAgentReturn,
} from "@clive.shirley/accord-core/orchestration/task-agent-audit.js";
import { devTaskTrace } from "@clive.shirley/accord-core/queries/task-trace.js";
import {
  parseUnblockArgs,
  tokenizeArgs,
  unblockTask,
} from "@clive.shirley/accord-core/queries/unblock-task.js";
import {
  findFinding,
  gatingFindings,
  refreshTask,
  stateFromHistory,
} from "@clive.shirley/accord-core/tasks/model.js";
import { renderFindingsBrief } from "@clive.shirley/accord-core/tasks/render.js";
import { seedTaskFromDisk } from "@clive.shirley/accord-core/tasks/seed.js";
import { writeTaskV2 } from "@clive.shirley/accord-core/tasks/store.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import Ajv from "ajv";
import { readTaskFixture } from "./helpers/task-fixture.js";

const WI = "TRACE-1";
const here = dirname(fileURLToPath(import.meta.url));
const taskSchema = JSON.parse(
  readFileSync(join(here, "..", "schemas", "task-schema.json"), "utf8"),
);
const EXAMPLE_PATH = join(here, "..", "schemas", "task-file.example.json");

function devConfig(orchestration?: DevHarnessConfig["orchestration"]): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: ["bun test"],
    ...(orchestration ? { orchestration } : {}),
  };
}

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-trace-"));
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
  mkdirSync(join("docs", "dev", WI), { recursive: true });
  writeFileSync(
    join("docs", "dev", WI, "spec.json"),
    JSON.stringify({
      schema_version: "1.0",
      acceptance_criteria: [
        { id: "AC-1", requirement: "MUST", type: "scenario", scenario: "Then login succeeds" },
        { id: "AC-2", requirement: "MUST", type: "scenario", scenario: "Then totals prorate" },
      ],
      verification: {
        commands: ["bun test"],
        test_cases: [
          { id: "TC-1", covers: "AC-1" },
          { id: "TC-2", covers: "AC-2" },
        ],
      },
    }),
  );
  writeFileSync(
    join("docs", "dev", WI, "plan.json"),
    JSON.stringify({
      schema_version: "1.0",
      tasks: [
        {
          id: 1,
          title: "login + proration",
          covers_ac: ["AC-1", "AC-2"],
          files: [],
          steps: [
            { tag: "test", description: "red" },
            { tag: "impl", description: "green" },
          ],
        },
      ],
    }),
  );
  writeFileSync(
    join(".tasks", `${WI}.json`),
    JSON.stringify({
      schema_version: "1.0",
      id: WI,
      title: "trace",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "implementing",
      task_ids: [1],
      spec: `docs/dev/${WI}/spec.json`,
      plan: `docs/dev/${WI}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  writeTaskV2(seedTaskFromDisk({ workItemId: WI, taskId: 1, ownerNonce: "abcdef" }));
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

const read = (): TaskFileV2 => readTaskFixture(WI, 1);
const refs = (): string[] => read().log.map((entry) => entry.ref);
const state = (id: string): string => {
  const hit = findFinding(read(), id);
  if (!hit) throw new Error(`missing ${id}`);
  return stateFromHistory(hit.finding.history);
};

const RED = "FAIL tests/a.test.ts\n  Expected: 1\n  Received: 2\n\n0 pass\n2 fail\n";
const config = devConfig();

function validateSchema(task: TaskFileV2): void {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(taskSchema);
  const valid = validate(task);
  if (!valid) throw new Error(JSON.stringify(validate.errors, null, 2));
}

describe("task file v2 — full adversarial flow", () => {
  test("T1→T2→C1(security+code)→C2→T3(RGR)→C3→V1(fail)→C4→V2", () => {
    // T1: phase-test writes tests + stub.
    expect(
      applyPhaseTestPostResult(
        WI,
        {
          status: "done",
          changes: [
            { file: "tests/a.test.ts", action: "add", kind: "test", ac_ids: ["AC-1", "AC-2"] },
            { file: "src/a.ts", action: "add", kind: "stub", ac_ids: ["AC-2"] },
          ],
          red_confirmed: true,
          test_output: RED,
          events: [
            { type: "deviation", at: "2020-01-01", description: "reused file", reason: "x" },
          ],
        },
        config,
      ),
    ).toContain("review-test");
    let task = read();
    expect(task.control.phase).toBe("review-test");
    expect(task.control.test_files).toEqual(["tests/a.test.ts"]);
    expect(task.control.stub_files).toEqual(["src/a.ts"]);
    expect(task.control.last_test_run?.output).toBe("T1-phase-test.output.txt");
    expect(task.log[0].events?.[0]).not.toHaveProperty("at");

    // T1 review-test: one critical (gating), one warning (advisory at gate `block`).
    applyReviewTestPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            ac_id: "AC-1",
            file: "tests/a.test.ts",
            issue: "AC-1 negative path untested",
          },
          { severity: "warning", tc_id: "TC-2", issue: "TC-2 fixture shares state" },
        ],
      },
      config,
    );
    task = read();
    expect(task.control.round).toBe("T2");
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.test_review).toEqual({ used: 1, lifetime: 1 });
    expect(findFinding(task, "F-001")?.req.id).toBe("AC-1");
    expect(findFinding(task, "F-002")?.req.id).toBe("AC-2");
    expect(findFinding(task, "F-002")?.finding.advisory).toBe(true);
    expect(task.summary.blockers.map((b) => b.finding)).toEqual(["F-001"]);
    expect(renderFindingsBrief(task, "phase-test")).toContain("F-001");

    // T2: phase-test answers F-001; review-test silent on it → implicit verify; advance to C1.
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        changes: [{ file: "tests/a.test.ts", action: "modify", kind: "test", ac_ids: ["AC-1"] }],
        red_confirmed: true,
        test_output: RED,
        review_responses: [
          { finding_id: "F-001", resolution: "fixed", note: "added negative path" },
        ],
      },
      config,
    );
    expect(state("F-001")).toBe("addressed");
    expect(renderFindingsBrief(read(), "review-test")).toContain("F-001");
    applyReviewTestPostResult(WI, { verdict: "clean", findings: [] }, config);
    task = read();
    expect(state("F-001")).toBe("verified");
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.round).toBe("C1");
    expect(task.control.pre_impl_gates).toBe("complete");

    // C1: phase-code touches a security-sensitive path → review-security → review-code.
    applyPhaseCodePostResult(
      WI,
      {
        status: "done",
        tests_passing: true,
        changes: [
          { file: "src/auth/session.ts", action: "add", kind: "code", ac_ids: ["AC-1"] },
          { file: "src/a.ts", action: "modify", kind: "code", ac_ids: ["AC-2"] },
        ],
      },
      config,
    );
    expect(read().control.phase).toBe("review-security");
    applyReviewSecurityPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            file: "src/auth/session.ts",
            issue: "A01 session not rotated",
            category: "A01",
          },
        ],
      },
      config,
    );
    task = read();
    expect(findFinding(task, "F-003")?.req.id).toBe("AC-1"); // inferred from changes
    expect(findFinding(task, "F-003")?.finding.advisory).toBe(true);
    expect(task.control.phase).toBe("review-code");
    applyReviewCodePostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          { severity: "critical", ac_id: "AC-2", file: "src/a.ts", issue: "proration rounds down" },
        ],
      },
      config,
    );
    task = read();
    expect(task.control.round).toBe("C2");
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.code_review.used).toBe(1);
    expect(gatingFindings(task).map(({ finding }) => finding.id)).toEqual(["F-004"]);
    const codeBrief = renderFindingsBrief(task, "phase-code");
    expect(codeBrief).toContain("F-003");
    expect(codeBrief).toContain("F-004");

    // C2: phase-code fixes F-004, proposes wont_fix on advisory F-003, reports a test issue → RGR.
    applyPhaseCodePostResult(
      WI,
      {
        status: "done",
        tests_passing: true,
        changes: [{ file: "src/a.ts", action: "modify", kind: "code", ac_ids: ["AC-2"] }],
        review_responses: [
          { finding_id: "F-004", resolution: "fixed", note: "round half-up" },
          { finding_id: "F-003", resolution: "wont_fix", note: "rotation handled by gateway" },
        ],
        events: [
          {
            type: "test_issue",
            test_file: "tests/a.test.ts",
            issue: "AC-2 test expects 10.00 but spec says 10.01",
            ac_id: "AC-2",
            recommendation: "fix_test",
          },
        ],
      },
      config,
    );
    task = read();
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.round).toBe("T3");
    expect(task.control.pre_impl_gates).toBe("pending");
    expect(task.control.retries.rgr.used).toBe(1);
    const rgrFinding = findFinding(task, "F-005");
    expect(rgrFinding?.finding.loop).toBe("T");
    expect(rgrFinding?.finding.raised).toBe("C2/phase-code");
    expect(state("F-003")).toBe("wont_fix_proposed");
    expect(task.summary.advisories.map((a) => a.finding)).toContain("F-003");

    // T3: phase-test fixes the test issue; review-test clean → C3.
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        changes: [{ file: "tests/a.test.ts", action: "modify", kind: "test", ac_ids: ["AC-2"] }],
        red_confirmed: true,
        test_output: RED,
        review_responses: [{ finding_id: "F-005", resolution: "fixed", note: "expects 10.01" }],
      },
      config,
    );
    applyReviewTestPostResult(WI, { verdict: "clean", findings: [] }, config);
    expect(state("F-005")).toBe("verified");
    expect(read().control.round).toBe("C3");

    // C3: review-code rechecks F-004 → advance to V1.
    applyPhaseCodePostResult(
      WI,
      {
        status: "done",
        tests_passing: true,
        changes: [{ file: "src/a.ts", action: "modify", kind: "code", ac_ids: ["AC-2"] }],
      },
      config,
    );
    expect(read().control.phase).toBe("review-code");
    applyReviewCodePostResult(
      WI,
      {
        verdict: "clean",
        findings: [],
        rechecks: [{ finding_id: "F-004", outcome: "verified" }],
      },
      config,
    );
    task = read();
    expect(state("F-004")).toBe("verified");
    expect(task.control.phase).toBe("phase-verify-task");
    expect(task.control.round).toBe("V1");

    // V1: AC-2 fails → V finding → C4.
    applyPhaseVerifyTaskPostResult(
      WI,
      {
        status: "done",
        evidence: [
          { ac_id: "AC-1", result: "pass", tests: ["login works"] },
          { ac_id: "AC-2", result: "fail", tests: ["prorates"], note: "Expected 10.01" },
        ],
        verify_output: "1 pass\n1 fail\n",
      },
      config,
    );
    task = read();
    expect(task.control.round).toBe("C4");
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.retries.verify.used).toBe(1);
    expect(findFinding(task, "F-006")?.finding.loop).toBe("V");
    expect(renderFindingsBrief(task, "phase-code")).toContain("F-006");

    // C4 → V2 pass → done.
    applyPhaseCodePostResult(
      WI,
      {
        status: "done",
        tests_passing: true,
        changes: [{ file: "src/a.ts", action: "modify", kind: "code", ac_ids: ["AC-2"] }],
        review_responses: [{ finding_id: "F-006", resolution: "fixed", note: "fixed rounding" }],
      },
      config,
    );
    applyReviewCodePostResult(WI, { verdict: "clean", findings: [] }, config);
    applyPhaseVerifyTaskPostResult(
      WI,
      {
        status: "done",
        evidence: [
          { ac_id: "AC-1", result: "pass", tests: ["login works"] },
          { ac_id: "AC-2", result: "pass", tests: ["prorates"] },
        ],
      },
      config,
    );
    task = read();
    expect(task.control.status).toBe("done");
    expect(state("F-006")).toBe("verified");
    expect(task.requirements.filter((r) => r.id !== "_task").map((r) => r.status)).toEqual([
      "satisfied",
      "satisfied",
    ]);
    expect(task.summary.headline).toStartWith("DONE: 2/2 requirements satisfied");
    // advisory findings stay visible (never block): security wont_fix proposal + unanswered warning
    expect(task.summary.advisories.map((a) => a.finding)).toEqual(["F-003", "F-002"]);
    expect(refs()).toEqual([
      "T1/phase-test",
      "T1/review-test",
      "T1/decision",
      "T2/phase-test",
      "T2/review-test",
      "T2/decision",
      "C1/phase-code",
      "C1/review-security",
      "C1/review-code",
      "C1/decision",
      "C2/phase-code",
      "C2/decision",
      "T3/phase-test",
      "T3/review-test",
      "T3/decision",
      "C3/phase-code",
      "C3/review-code",
      "C3/decision",
      "V1/phase-verify-task",
      "V1/decision",
      "C4/phase-code",
      "C4/review-code",
      "C4/decision",
      "V2/phase-verify-task",
      "V2/decision",
    ]);
    validateSchema(task);
    if (process.env.ACCORD_WRITE_TASK_EXAMPLE === "1") {
      writeFileSync(EXAMPLE_PATH, `${JSON.stringify(task, null, 2)}\n`);
    }
    // refresh is idempotent
    const again = structuredClone(task);
    refreshTask(again, task.summary.updated);
    expect(again).toEqual(task);

    const trace = devTaskTrace(WI, { taskId: 1 });
    expect(trace.ok && trace.value.formatted).toContain("AC-2");
  });
});

describe("task file v2 — schema example", () => {
  test("committed example (regenerate: ACCORD_WRITE_TASK_EXAMPLE=1) validates against task-schema.json", () => {
    validateSchema(JSON.parse(readFileSync(EXAMPLE_PATH, "utf8")) as TaskFileV2);
  });
});

describe("task file v2 — loop caps and human unblock", () => {
  function rejectRound(): void {
    applyPhaseTestPostResult(
      WI,
      {
        status: "done",
        changes: [{ file: "tests/a.test.ts", action: "add", kind: "test", ac_ids: ["AC-1"] }],
        red_confirmed: true,
        test_output: RED,
      },
      config,
    );
    applyReviewTestPostResult(
      WI,
      {
        verdict: "issues",
        findings: [
          {
            severity: "critical",
            ac_id: "AC-1",
            file: "tests/a.test.ts",
            issue: "AC-1 negative path untested",
          },
        ],
      },
      config,
    );
  }

  test("re-raised finding keeps its id; cap blocks; blind unblock refused; note → retry round", () => {
    for (let round = 0; round < 4; round += 1) rejectRound();
    let task = read();
    expect(task.control.status).toBe("blocked");
    expect(task.control.blocked?.kind).toBe("cap");
    expect(task.control.blocked?.loop).toBe("T");
    // similarity matching re-raised the same root cause instead of opening F-002…F-004
    expect(task.requirements.find((r) => r.id === "AC-1")?.findings.map((f) => f.id)).toEqual([
      "F-001",
    ]);
    expect(task.summary.next.who).toBe("human");
    task.control.blocked = {
      ...(task.control.blocked as NonNullable<typeof task.control.blocked>),
      fingerprint: "same",
    };
    writeFileSync(join(".tasks", `${WI}-task-1.json`), JSON.stringify(task));

    const blind = unblockTask(WI, 1, { fingerprint: () => "same" });
    expect(blind.ok).toBe(false);
    if (!blind.ok) expect(blind.error).toContain("Blind unblock refused");

    const parsed = parseUnblockArgs(
      tokenizeArgs(`${WI} --task 1 --note F-001 "use a table-driven negative case"`),
    );
    expect(parsed.decisions).toEqual([
      { target: "F-001", action: "note", reason: "use a table-driven negative case" },
    ]);
    const result = unblockTask(WI, 1, { decisions: parsed.decisions, fingerprint: () => "same" });
    expect(result.ok).toBe(true);
    task = read();
    expect(task.control.status).toBe("pending");
    expect(task.control.phase).toBe("phase-test");
    expect(task.control.retries.test_review.used).toBe(0);
    expect(task.control.retries.test_review.lifetime).toBe(3);
    expect(task.control.retries.unblocks).toBe(1);
    const brief = renderFindingsBrief(task, "phase-test");
    expect(brief).toContain("use a table-driven negative case");
    expect(brief).toContain("(human)");
  });

  test("accepting every blocker advances past the gate without using unblock budget", () => {
    for (let round = 0; round < 4; round += 1) rejectRound();
    const result = unblockTask(WI, 1, {
      decisions: [{ target: "F-001", action: "accept", reason: "covered by e2e" }],
    });
    expect(result.ok).toBe(true);
    const task = read();
    expect(task.control.phase).toBe("phase-code");
    expect(task.control.round).toBe("C1");
    expect(task.control.retries.unblocks).toBe(0);
    expect(state("F-001")).toBe("wont_fix_accepted");
  });

  test("human --fixed on every blocker routes straight to the reviewer's recheck", () => {
    for (let round = 0; round < 4; round += 1) rejectRound();
    const result = unblockTask(WI, 1, {
      decisions: [{ target: "F-001", action: "fixed", reason: "I added the case" }],
    });
    expect(result.ok).toBe(true);
    expect(read().control.phase).toBe("review-test");
  });

  test("verify loop blocks for a human after 3 bounces", () => {
    const failing = {
      status: "done",
      evidence: [{ ac_id: "AC-1", result: "fail", tests: ["login"] }],
    };
    const cfg = devConfig({ verify_loop: { max_retries: 3 } });
    const toVerify = () => {
      const task = read();
      task.control.phase = "phase-verify-task";
      task.control.pre_impl_gates = "complete";
      writeFileSync(join(".tasks", `${WI}-task-1.json`), JSON.stringify(task));
    };
    for (let bounce = 0; bounce < 4; bounce += 1) {
      toVerify();
      applyPhaseVerifyTaskPostResult(WI, failing, cfg);
    }
    const task = read();
    expect(task.control.status).toBe("blocked");
    expect(task.control.blocked?.loop).toBe("V");
    expect(task.control.retries.verify.used).toBe(3);
    // one V finding, re-raised each round
    expect(task.requirements.find((r) => r.id === "AC-1")?.findings).toHaveLength(1);
  });
});

describe("task file v2 — recovery", () => {
  test("returned-but-unapplied packet is re-applied once from the sidecar", () => {
    expect(markTaskAgentSpawned(WI, "phase-test", 1)).toBe("T1/phase-test");
    expect(read().control.in_flight?.stage).toBe("spawned");
    expect(read().summary.next.who).toBe("harness");
    // respawn after a crash reuses the ref
    expect(markTaskAgentSpawned(WI, "phase-test", 1)).toBe("T1/phase-test");
    const packet = {
      status: "done",
      changes: [{ file: "tests/a.test.ts", action: "add", kind: "test", ac_ids: ["AC-1"] }],
      red_confirmed: true,
      test_output: RED,
    };
    expect(recordTaskAgentReturn(WI, "phase-test", packet, "All RED.")).toBe("T1/phase-test");
    expect(read().control.in_flight?.stage).toBe("returned");
    expect(readFileSync(join(".tasks", `${WI}-task-1`, "T1-phase-test.json"), "utf8")).toContain(
      "All RED.",
    );

    const recovered = recoverReturnedInFlight(WI, config);
    expect(recovered).toContain("Recovered **T1/phase-test**");
    const task = read();
    expect(task.control.in_flight).toBeNull();
    expect(task.control.phase).toBe("review-test");
    expect(task.log.map((e) => e.ref)).toEqual(["T1/phase-test"]);
    expect(task.log[0].note).toBe("All RED.");
    expect(recoverReturnedInFlight(WI, config)).toBe("");
  });
});
