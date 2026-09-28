/**
 * After validated **phase-test** return — advances the primary task to **review-test** when the
 * pipeline calls for a pre-impl review pass.
 *
 * Applies to:
 * - `quick_fix` + `fixing`: all strategies (RGR — tests before code).
 * - `implement` + `implementing`: standard pipeline (same done packet shape).
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { createLogger } from "../../logging.js";
import { resolvePlanTaskProfile } from "../../plan/load-task-profile.js";
import { loadWorkItem } from "../../work-items/io.js";
import {
  decideAfterReviewTest,
  persistLastReviewFeedback,
  type ReviewReturnPacket,
  readLastReviewFeedback,
  readReviewLoopCounters,
  writeReviewLoopCounters,
} from "../review-feedback.js";
import { detectTestRunnerCrash } from "../test-crash-detection.js";
import { detectImportOnlyRed, type ImportOnlyRedSignal } from "../test-red-classification.js";
import { applyPhaseVerifyTaskPostResult } from "./phase-verify-task.js";
import { advancePrimaryTask, resolveActivePrimaryTaskId } from "./primary-task.js";

const log = createLogger("orchestration:phase-test");

interface PhaseTestDonePacket {
  status: "done";
  test_files: string[];
  red_confirmed?: boolean;
  test_output?: string;
  ac_covered?: string[];
  stub_files?: string[];
  review_responses?: PhaseTestReviewResponse[];
}

/** phase-test's per-finding answer to prior `review-test` feedback (retry rounds). */
export interface PhaseTestReviewResponse {
  issue: string;
  resolution: "fixed" | "disputed";
  note: string;
  ref?: string;
  file?: string;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function reviewResponses(value: unknown): PhaseTestReviewResponse[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is PhaseTestReviewResponse => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as Record<string, unknown>;
    return (
      typeof record.issue === "string" &&
      (record.resolution === "fixed" || record.resolution === "disputed") &&
      typeof record.note === "string"
    );
  });
}

/**
 * Synthetic review-test packet for import-only RED — persisted as `last_review_feedback` so the
 * standard resume path appends it to the phase-test retry brief as `## Prior review feedback`.
 */
export function importOnlyRedFeedbackPacket(
  signal: ImportOnlyRedSignal,
  testFiles: readonly string[],
): ReviewReturnPacket {
  const missingList =
    signal.missing.length > 0 ? signal.missing.map((m) => `\`${m}\``).join(", ") : "(see evidence)";
  return {
    verdict: "issues",
    analysis:
      "Harness Check 0 (deterministic): the RED run died on module/symbol resolution, so no " +
      "assertion executed. This is not a valid RED state and review-test was not spawned. " +
      "Fix it in phase-test via Step 3 (unimplemented declarations), re-run, and return " +
      "behaviour RED.",
    findings: [
      {
        severity: "critical",
        category: "import_only_red",
        issue: `Check 0: import-only RED — unresolved ${missingList}. No assertion ran against the system under test.`,
        ...(testFiles[0] ? { file: testFiles[0] } : {}),
        evidence: signal.matched.join("\n"),
        recommendation:
          `phase-test Step 3: for each unresolved module/symbol (${missingList}) create the minimal ` +
          "unimplemented declaration (exact exported name + signature the test calls; body only " +
          "throws `not implemented: <symbol>`), list it in `stub_files`, re-run the suite, and " +
          "confirm tests fail on assertions or the stub's not-implemented error. Do NOT mock the " +
          "module under test, delete tests, or weaken assertions to get past the import.",
      },
    ],
  };
}

function isPhaseTestImplementDonePacket(packet: unknown): packet is PhaseTestDonePacket {
  if (!packet || typeof packet !== "object") {
    return false;
  }
  const record = packet as Record<string, unknown>;
  if (record.status !== "done") {
    return false;
  }
  if (typeof record.hypothesis_id === "string") {
    return false;
  }
  const files = record.test_files;
  if (!Array.isArray(files) || files.length === 0) {
    return false;
  }
  return files.every((item) => typeof item === "string");
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseTestPostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
): string {
  const wi = loadWorkItem(workItemId);
  if (wi) {
    const taskId = resolveActivePrimaryTaskId(wi);
    if (taskId !== null) {
      const resolved = resolvePlanTaskProfile(workItemId, taskId);
      if (resolved?.profile.verifyOnly) {
        const verifyFooter = applyPhaseVerifyTaskPostResult(workItemId, packet);
        if (verifyFooter) {
          return verifyFooter;
        }
      }
    }
  }

  if (!isPhaseTestImplementDonePacket(packet)) {
    return "";
  }

  let footerLines: string[] = [];

  const applied = advancePrimaryTask(workItemId, ({ workItem: wi, task, timestamp }) => {
    if (task.phase !== "phase-test") {
      // See the matching guard in `review-test.ts` — a silent no-op here leaves task.phase
      // wherever it was (often still "review-test"), which then desyncs from whatever routed
      // this phase-test spawn in the first place and can mask a lost counter/phase update.
      log.warn(
        `guard no-op for ${workItemId}: task.phase=${String(task.phase)} (expected "phase-test") — phase-test packet NOT applied.`,
      );
      return false;
    }

    let label: "Quick-fix" | "Implement";
    let eventTypeBase: "quick_fix_phase_test" | "implement_phase_test";
    if (wi.pattern === "quick_fix" && wi.phase === "fixing") {
      label = "Quick-fix";
      eventTypeBase = "quick_fix_phase_test";
    } else if (wi.pattern === "implement" && wi.phase === "implementing") {
      label = "Implement";
      eventTypeBase = "implement_phase_test";
    } else {
      return false;
    }

    task.test_files = packet.test_files;
    if (typeof packet.test_output === "string" && packet.test_output.length > 0) {
      task.test_output = packet.test_output;
    }
    if (
      Array.isArray(packet.ac_covered) &&
      packet.ac_covered.every((id) => typeof id === "string")
    ) {
      task.ac_covered = packet.ac_covered;
    }
    const stubFiles = stringArray(packet.stub_files);
    if (stubFiles !== undefined) {
      task.stub_files = stubFiles;
    }

    // Did this spawn owe answers to gating review-test findings? (retry round)
    const priorFeedback = readLastReviewFeedback(task);
    const owedResponses =
      priorFeedback?.agent === "review-test" && priorFeedback.verdict === "issues"
        ? priorFeedback.findings.length
        : 0;
    const responses = reviewResponses(packet.review_responses);
    // Always replace: stale responses from an earlier round must not reach review-test.
    if (responses !== undefined && responses.length > 0) {
      task.review_responses = responses;
    } else {
      task.review_responses = undefined;
    }
    const responsesMissing = owedResponses > 0 && (responses?.length ?? 0) === 0;

    const previousPhase = typeof task.phase === "string" ? task.phase : "phase-test";

    // Self-reported `red_confirmed: true` is not trustworthy on its own — a subagent can
    // report it after a test run that never actually finished (uncaught exception, crashed
    // worker, unmocked real network listener, ...). Scan the reported `test_output` for crash
    // signatures before believing it and advancing to review-test.
    const crash = detectTestRunnerCrash(packet.test_output);
    if (crash) {
      task.red_confirmed = false;
      task.status = "blocked";
      task.test_runner_crash = { reason: crash.reason, matched: crash.matched, at: timestamp };
      footerLines = [
        `**${label} (phase-test):** test-runner CRASH detected in \`test_output\` — not a valid RED signal.`,
        "",
        `- ${crash.reason}.`,
        `- Matched: \`${crash.matched}\``,
        "- Task `status` is `blocked`; `phase` left at `phase-test` (not advanced to review-test).",
        "",
        "Fix the crash (usually an unmocked side effect escaping into a real network/process call), " +
          "re-run the tests locally to confirm a normal pass/fail summary, then `/dev unblock` and " +
          "`/dev resume`.",
      ];
      return {
        event: {
          type: `${eventTypeBase}_crash_detected`,
          previous_phase: previousPhase,
          reason: crash.reason,
        },
      };
    }

    // Import-only RED: the suite never loaded the system under test. Do not spend a review-test
    // spawn on it — bounce straight back to phase-test with a concrete, actionable finding.
    // Consumes a review-test retry slot so a phase-test that cannot fix it still hits the cap.
    // `existing_tests` quick fixes are exempt: they may legitimately run a pre-existing suite.
    const strategy = (task.quick_fix_contract as { test?: { strategy?: string } } | undefined)?.test
      ?.strategy;
    const importRed =
      strategy === "existing_tests" ? null : detectImportOnlyRed(packet.test_output);
    if (importRed) {
      task.red_confirmed = false;
      const syntheticPacket = importOnlyRedFeedbackPacket(importRed, packet.test_files);
      persistLastReviewFeedback(task, "review-test", syntheticPacket, timestamp, {
        packet: { ...syntheticPacket, source: "harness:import-only-red-guard" },
      });
      const counters = readReviewLoopCounters(task);
      const decision = decideAfterReviewTest(counters, syntheticPacket, devConfig, wi.pattern);
      if ("blocked" in decision) {
        task.status = "blocked";
        footerLines = [
          `**${label} (phase-test):** import-only RED detected again and the review-test retry cap is exhausted.`,
          "",
          `- ${importRed.reason}.`,
          `- ${decision.reason}`,
          "",
          "Task `status` is `blocked`. Declare the missing symbols (phase-test Step 3) or clarify " +
            "the interface in the spec, then `/dev unblock` and `/dev resume`.",
        ];
        return {
          event: {
            type: `${eventTypeBase}_import_only_red_blocked`,
            previous_phase: previousPhase,
            missing: importRed.missing,
            reason: decision.reason,
          },
        };
      }
      writeReviewLoopCounters(task, {
        ...counters,
        test_review_retries_used: counters.test_review_retries_used + 1,
        lifetime_test_review_cycles: counters.lifetime_test_review_cycles + 1,
      });
      task.phase = "phase-test";
      if (task.status === "blocked") {
        task.status = "pending";
      }
      footerLines = [
        `**${label} (phase-test):** import-only RED — not a valid RED signal; **review-test skipped**.`,
        "",
        `- ${importRed.reason}.`,
        `- Missing: ${importRed.missing.length > 0 ? importRed.missing.map((m) => `\`${m}\``).join(", ") : "(see `last_review_feedback`)"}`,
        `- Consumed a review-test retry slot (used ${String(counters.test_review_retries_used + 1)}).`,
        "",
        "Run `/dev resume` to respawn **phase-test** with a Step 3 stub-skeleton finding in the brief.",
      ];
      return {
        event: {
          type: `${eventTypeBase}_import_only_red`,
          previous_phase: previousPhase,
          next_phase: "phase-test",
          missing: importRed.missing,
        },
      };
    }

    if (typeof packet.red_confirmed === "boolean") {
      task.red_confirmed = packet.red_confirmed;
    }
    task.phase = "review-test";

    footerLines = [
      `**${label} (phase-test):** persisted \`test_files\` / \`red_confirmed\` and set task \`phase\` to \`review-test\`.`,
      ...(stubFiles && stubFiles.length > 0
        ? [
            `- Stub skeletons (phase-code must replace): ${stubFiles.map((f) => `\`${f}\``).join(", ")}`,
          ]
        : []),
      ...(responsesMissing
        ? [
            `- ⚠ Retry round but no \`review_responses\` returned for ${String(owedResponses)} prior review-test finding(s) — review-test will re-check them.`,
          ]
        : []),
      "",
      "Run `/dev resume` to spawn **review-test** (pre-impl) before **phase-code**.",
    ];

    return {
      event: {
        type: `${eventTypeBase}_applied`,
        previous_phase: previousPhase,
        next_phase: "review-test",
        ...(responsesMissing ? { review_responses_missing: true } : {}),
      },
    };
  });

  if (!applied) {
    return "";
  }
  return ["", "", ...footerLines].join("\n");
}
