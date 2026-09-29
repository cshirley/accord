/**
 * After validated **phase-test** return — records the run on the v2 task file and advances the
 * primary task to **review-test** (pre-impl adversarial review).
 *
 * Harness guards before spending a review-test spawn:
 * - test-runner crash → task `blocked` (kind `crash`)
 * - import-only RED → harness-raised T finding, consumes a test_review retry, back to phase-test
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { createLogger } from "../../logging.js";
import { resolvePlanTaskProfile } from "../../plan/load-task-profile.js";
import { bumpRetry, capForKey, decideLoop } from "../../tasks/decide.js";
import { allocateRef, appendLog, applyReviewFindings, owedFindings } from "../../tasks/model.js";
import { claimRef, clearInFlight, logDecision, recordPhaseTest } from "../../tasks/record.js";
import { sidecarName, writeTaskSidecar } from "../../tasks/store.js";
import type { TaskFileV2 } from "../../tasks/types.js";
import { loadWorkItem } from "../../work-items/io.js";
import { detectTestRunnerCrash } from "../test-crash-detection.js";
import { detectImportOnlyRed, type ImportOnlyRedSignal } from "../test-red-classification.js";
import { applyPhaseVerifyTaskPostResult } from "./phase-verify-task.js";
import {
  analysisFrom,
  footer,
  type PostResultContext,
  pipelineLabel,
  traceHint,
} from "./pipeline.js";
import { advancePrimaryTask, resolveActivePrimaryTaskId } from "./primary-task.js";

const log = createLogger("orchestration:phase-test");

/** Harness Check 0 finding for import-only RED (raised by `<round>/harness`). */
export function importOnlyRedFinding(
  signal: ImportOnlyRedSignal,
  testFiles: readonly string[],
): Record<string, unknown> {
  const missingList =
    signal.missing.length > 0 ? signal.missing.map((m) => `\`${m}\``).join(", ") : "(see evidence)";
  return {
    severity: "critical",
    category: "import_only_red",
    issue: `Check 0: import-only RED — unresolved ${missingList}. No assertion ran against the system under test.`,
    ...(testFiles[0] ? { file: testFiles[0] } : {}),
    evidence: signal.matched.join("\n"),
    recommendation:
      `phase-test Step 3: for each unresolved module/symbol (${missingList}) create the minimal ` +
      "unimplemented declaration (exact exported name + signature the test calls; body only " +
      "throws `not implemented: <symbol>`), report it as a `stub` change, re-run the suite, and " +
      "confirm tests fail on assertions or the stub's not-implemented error. Do NOT mock the " +
      "module under test, delete tests, or weaken assertions to get past the import.",
  };
}

function isPhaseTestDonePacket(packet: unknown): packet is Record<string, unknown> {
  if (!packet || typeof packet !== "object") return false;
  const record = packet as Record<string, unknown>;
  if (record.status !== "done" || typeof record.hypothesis_id === "string") return false;
  const hasChanges = Array.isArray(record.changes) && record.changes.length > 0;
  const hasTests = Array.isArray(record.test_files) && record.test_files.length > 0;
  return hasChanges || hasTests;
}

/** Close open harness import-only findings once phase-test produced a non-import RED. */
function closeHarnessImportFindings(task: TaskFileV2, by: string): void {
  for (const req of task.requirements) {
    for (const finding of req.findings) {
      if (finding.detail?.category !== "import_only_red") continue;
      if (finding.state !== "open" && finding.state !== "reraised" && finding.state !== "addressed")
        continue;
      finding.history.push({ by, outcome: "verified", note: "RED no longer import-only" });
    }
  }
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseTestPostResult(
  workItemId: string,
  packet: unknown,
  devConfig?: DevHarnessConfig | null,
  context?: PostResultContext,
): string {
  const wi = loadWorkItem(workItemId);
  if (wi) {
    const taskId = resolveActivePrimaryTaskId(wi);
    if (taskId !== null) {
      const resolved = resolvePlanTaskProfile(workItemId, taskId);
      if (resolved?.profile.verifyOnly) {
        const verifyFooter = applyPhaseVerifyTaskPostResult(workItemId, packet, devConfig, context);
        if (verifyFooter) return verifyFooter;
      }
    }
  }

  if (!isPhaseTestDonePacket(packet)) return "";

  let out = "";
  const applied = advancePrimaryTask(workItemId, ({ workItem, task, timestamp }) => {
    if (task.control.phase !== "phase-test") {
      log.warn(
        `guard no-op for ${workItemId}: task phase=${task.control.phase} (expected "phase-test") — phase-test packet NOT applied.`,
      );
      return false;
    }
    const label = pipelineLabel(workItem);
    if (!label) return false;
    const ref = claimRef(task, "phase-test");
    if (!ref) return false;

    const owedBefore = owedFindings(task, ["T"]).filter(({ finding }) => !finding.advisory).length;
    const testOutput = typeof packet.test_output === "string" ? packet.test_output : "";
    const outputSidecar = testOutput ? sidecarName(ref, "output.txt") : undefined;
    if (outputSidecar) writeTaskSidecar(workItemId, task.task, outputSidecar, testOutput);

    const rec = recordPhaseTest(task, ref, packet, timestamp, {
      analysis: analysisFrom(packet, context),
      outputSidecar,
    });
    clearInFlight(task, "phase-test");
    const lastRun = task.control.last_test_run ?? { ref };

    // Self-reported `red_confirmed` is not trustworthy on its own — scan the output for a
    // crashed run before believing it.
    const crash = detectTestRunnerCrash(testOutput);
    if (crash) {
      lastRun.red = "crash";
      lastRun.confirmed = false;
      task.control.last_test_run = lastRun;
      const decisionRef = logDecision(task, timestamp, {
        result: "blocked",
        note: `Test-runner crash: ${crash.reason} (matched \`${crash.matched}\`)`,
      });
      task.control.status = "blocked";
      task.control.blocked = { kind: "crash", reason: crash.reason, ref: decisionRef };
      out = footer([
        `**${label} (phase-test):** test-runner CRASH detected — not a valid RED signal.`,
        "",
        `- ${crash.reason}. Matched: \`${crash.matched}\``,
        "- Task `blocked`; phase left at `phase-test`.",
        "",
        "Fix the crash, re-run locally, then `accord unblock` and `accord resume`.",
        traceHint(task),
      ]);
      return true;
    }

    // Import-only RED: never spend a review-test spawn; bounce with a harness finding.
    const strategy = task.control.quick_fix_contract?.test.strategy;
    const importRed = strategy === "existing_tests" ? null : detectImportOnlyRed(testOutput);
    if (importRed) {
      lastRun.red = "import_only";
      lastRun.confirmed = false;
      task.control.last_test_run = lastRun;
      const harnessRef = allocateRef(task, "harness");
      const raise = applyReviewFindings(task, [importOnlyRedFinding(importRed, rec.testFiles)], {
        by: harnessRef,
        loop: "T",
        gate: "none",
      });
      appendLog(task, {
        ref: harnessRef,
        at: timestamp,
        result: "issues",
        note: `Check 0: ${importRed.reason}`,
      });
      const cap = capForKey("test_review", devConfig, workItem.pattern);
      const decision = decideLoop(task, "T", cap);
      if (decision.kind === "blocked") {
        const decisionRef = logDecision(task, timestamp, {
          result: "blocked",
          note: `Import-only RED again; ${decision.reason}`,
        });
        task.control.status = "blocked";
        task.control.blocked = {
          kind: "cap",
          reason: decision.reason,
          ref: decisionRef,
          loop: "T",
          lifetime: decision.lifetime,
        };
        out = footer([
          `**${label} (phase-test):** import-only RED again and the review-test retry cap is exhausted.`,
          "",
          `- ${importRed.reason}.`,
          `- ${decision.reason}`,
          "",
          "Task `blocked`. Declare the missing symbols or clarify the interface, then `accord unblock` and `accord resume`.",
          traceHint(task),
        ]);
        return true;
      }
      const counter = bumpRetry(task, "test_review");
      logDecision(
        task,
        timestamp,
        {
          result: "retry",
          note: `Import-only RED (${[...raise.raised, ...raise.reraised].join(", ")}) → phase-test (test_review ${String(counter.used)}/${String(cap.maxRetries)})`,
          next_phase: "phase-test",
        },
        "T",
      );
      task.control.phase = "phase-test";
      task.control.status = "pending";
      out = footer([
        `**${label} (phase-test):** import-only RED — not a valid RED signal; **review-test skipped**.`,
        "",
        `- ${importRed.reason}.`,
        `- Consumed a review-test retry slot (${String(counter.used)}/${String(cap.maxRetries)}).`,
        "",
        "Run `/dev resume` to respawn **phase-test** with the Check 0 finding in the brief.",
      ]);
      return true;
    }

    closeHarnessImportFindings(task, ref);
    lastRun.red = rec.testFiles.length && packet.red_confirmed === true ? "behaviour" : "unknown";
    lastRun.confirmed = packet.red_confirmed === true;
    task.control.last_test_run = lastRun;
    task.control.phase = "review-test";
    task.control.status = "pending";

    const responsesMissing = owedBefore > 0 && rec.responded.length === 0;
    if (responsesMissing) {
      const entry = task.log.find((candidate) => candidate.ref === ref);
      if (entry) {
        entry.warnings = [
          ...(entry.warnings ?? []),
          `no review_responses for ${String(owedBefore)} owed finding(s) — review-test will re-check them`,
        ];
      }
    }

    out = footer([
      `**${label} (phase-test):** recorded \`${ref}\`; task phase → \`review-test\`.`,
      rec.stubFiles.length
        ? `- Stub skeletons (phase-code must replace): ${rec.stubFiles.map((f) => `\`${f}\``).join(", ")}`
        : undefined,
      rec.responded.length ? `- Responded to: ${rec.responded.join(", ")}` : undefined,
      rec.unlinked.length
        ? `- ⚠ ${String(rec.unlinked.length)} review_response(s) could not be linked to a finding`
        : undefined,
      responsesMissing
        ? `- ⚠ Retry round but no \`review_responses\` for ${String(owedBefore)} owed finding(s).`
        : undefined,
      "",
      "Run `/dev resume` to spawn **review-test** (pre-impl) before **phase-code**.",
    ]);
    return true;
  });

  return applied ? out : "";
}
