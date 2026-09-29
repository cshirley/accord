/**
 * Record validated agent returns on a v2 task file (pure — callers persist).
 *
 * Each `record*` appends the agent's log entry (`<round>/<agent>`) and applies its facts:
 * changes, responses, findings, rechecks, evidence. Routing decisions stay in post-result
 * handlers, which append `<round>/decision` entries.
 */

import {
  allocateRef,
  appendLog,
  applyChanges,
  applyRechecks,
  applyResponses,
  applyReviewFindings,
  applyVerifyEvidence,
  type ChangeInput,
  type EvidenceInput,
  ensureRoundForActor,
  hasLogRef,
  loopForPhase,
  openRound,
  type RecheckInput,
  type ResponseInput,
  type ReviewFindingInput,
  resolveAttribution,
  type SeverityGate,
} from "./model.js";
import type { LogEntry, LoopKind, TaskEvent, TaskFileV2 } from "./types.js";

// ── In-flight protocol ──────────────────────────────────────────────

/** Before spawn: record the run we are about to start (idempotent for a crash respawn). */
export function markSpawned(task: TaskFileV2, agent: string, at: string): string {
  const inFlight = task.control.in_flight;
  if (inFlight && inFlight.agent === agent && !hasLogRef(task, inFlight.ref)) {
    inFlight.stage = "spawned";
    inFlight.at = at;
    task.control.status = "in_progress";
    return inFlight.ref;
  }
  ensureRoundForActor(task, agent);
  const ref = allocateRef(task, agent);
  task.control.in_flight = { ref, agent, stage: "spawned", at };
  task.control.status = "in_progress";
  return ref;
}

/** After a return packet is received (before post-result): pin the ref, stage `returned`. */
export function markReturned(task: TaskFileV2, agent: string, at: string): string {
  const inFlight = task.control.in_flight;
  if (inFlight && inFlight.agent === agent && !hasLogRef(task, inFlight.ref)) {
    inFlight.stage = "returned";
    inFlight.at = at;
    return inFlight.ref;
  }
  ensureRoundForActor(task, agent);
  const ref = allocateRef(task, agent);
  task.control.in_flight = { ref, agent, stage: "returned", at };
  return ref;
}

/**
 * Ref to record `agent`'s return under, or `null` when that return is already in the log
 * (idempotent re-apply during recovery).
 */
export function claimRef(task: TaskFileV2, agent: string): string | null {
  const inFlight = task.control.in_flight;
  if (inFlight && inFlight.agent === agent) {
    return hasLogRef(task, inFlight.ref) ? null : inFlight.ref;
  }
  ensureRoundForActor(task, agent);
  return allocateRef(task, agent);
}

export function clearInFlight(task: TaskFileV2, agent?: string): void {
  if (!agent || task.control.in_flight?.agent === agent) {
    task.control.in_flight = null;
  }
}

// ── Decisions ───────────────────────────────────────────────────────

/** Append `<round>/decision`; optionally open the next round of `nextLoop`. */
export function logDecision(
  task: TaskFileV2,
  at: string,
  decision: { result: string; note: string; next_phase?: string; warnings?: string[] },
  nextLoop?: LoopKind,
): string {
  const ref = allocateRef(task, "decision");
  appendLog(task, {
    ref,
    at,
    result: decision.result,
    note: decision.note,
    ...(decision.next_phase ? { next_phase: decision.next_phase } : {}),
    ...(decision.warnings?.length ? { warnings: decision.warnings } : {}),
  });
  if (nextLoop) openRound(task, nextLoop);
  return ref;
}

// ── Helpers ─────────────────────────────────────────────────────────

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function objectArray<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter((v) => v !== null && typeof v === "object") as T[])
    : [];
}

/** Agent events without self-reported timestamps (the log entry carries harness time). */
export function packetEvents(packet: Record<string, unknown>): TaskEvent[] {
  return objectArray<Record<string, unknown>>(packet.events)
    .filter((event) => typeof event.type === "string")
    .map((event) => {
      const { at: _reportedAt, ...rest } = event;
      return rest as TaskEvent;
    });
}

export function firstSentence(text: string | undefined, max = 200): string {
  const trimmed = (text ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(trimmed)?.[1] ?? trimmed;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function pushAgentLog(
  task: TaskFileV2,
  ref: string,
  at: string,
  result: string,
  note: string,
  packet: Record<string, unknown>,
  warnings: string[],
): LogEntry {
  const events = packetEvents(packet);
  const entry: LogEntry = {
    ref,
    at,
    result,
    note,
    ...(events.length ? { events } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
  appendLog(task, entry);
  return entry;
}

function acIdsFromChanges(changes: ReadonlyArray<ChangeInput>): string[] {
  const out = new Set<string>();
  for (const change of changes) for (const id of stringArray(change.ac_ids)) out.add(id);
  return [...out];
}

// ── phase-test ──────────────────────────────────────────────────────

export interface RecordPhaseTestResult {
  ref: string;
  testFiles: string[];
  stubFiles: string[];
  acCovered: string[];
  responded: string[];
  unlinked: string[];
}

export function recordPhaseTest(
  task: TaskFileV2,
  ref: string,
  packet: Record<string, unknown>,
  at: string,
  options: { analysis?: string; outputSidecar?: string },
): RecordPhaseTestResult {
  const warnings: string[] = [];
  let changes = objectArray<ChangeInput>(packet.changes);
  const legacyTests = stringArray(packet.test_files);
  const legacyStubs = stringArray(packet.stub_files);
  const acCoveredReported = stringArray(packet.ac_covered);
  if (changes.length === 0 && (legacyTests.length || legacyStubs.length)) {
    changes = [
      ...legacyTests.map((file) => ({
        file,
        action: "add",
        kind: "test",
        ac_ids: acCoveredReported,
      })),
      ...legacyStubs.map((file) => ({
        file,
        action: "add",
        kind: "stub",
        ac_ids: acCoveredReported,
      })),
    ];
    applyChanges(task, changes, ref, "test", { inferred: true });
    warnings.push("changes[] missing — inferred from test_files/stub_files + ac_covered");
  } else {
    applyChanges(task, changes, ref, "test");
  }

  const testFiles = new Set(task.control.test_files);
  const stubFiles = new Set(task.control.stub_files);
  for (const change of changes) {
    if (typeof change.file !== "string") continue;
    const kind = typeof change.kind === "string" ? change.kind : "test";
    if (change.action === "delete") {
      testFiles.delete(change.file);
      stubFiles.delete(change.file);
    } else if (kind === "stub") stubFiles.add(change.file);
    else if (kind === "test" || kind === "fixture") testFiles.add(change.file);
  }
  for (const file of legacyTests) testFiles.add(file);
  for (const file of legacyStubs) stubFiles.add(file);
  task.control.test_files = [...testFiles];
  task.control.stub_files = [...stubFiles];

  const { responded, unlinked } = applyResponses(
    task,
    objectArray<ResponseInput>(packet.review_responses),
    { by: ref, loops: ["T"] },
  );
  for (const label of unlinked) warnings.push(`unlinked review_response: ${label}`);

  const red = packet.red_confirmed === true;
  const note =
    firstSentence(options.analysis) ||
    `${String(testFiles.size)} test file(s); red_confirmed=${String(red)}`;
  pushAgentLog(task, ref, at, String(packet.status ?? "done"), note, packet, warnings);

  task.control.last_test_run = {
    ref,
    confirmed: red,
    ...(options.outputSidecar ? { output: options.outputSidecar } : {}),
  };

  const acCovered = acCoveredReported.length ? acCoveredReported : acIdsFromChanges(changes);
  return {
    ref,
    testFiles: task.control.test_files,
    stubFiles: task.control.stub_files,
    acCovered,
    responded,
    unlinked,
  };
}

// ── Reviews (review-test / review-code / review-security) ───────────

export interface RecordReviewResult {
  ref: string;
  raised: string[];
  reraised: string[];
  rechecked: string[];
  implicit: string[];
  warnings: string[];
}

export function recordReview(
  task: TaskFileV2,
  ref: string,
  agent: "review-test" | "review-code" | "review-security",
  packet: Record<string, unknown>,
  at: string,
  options: { gate: SeverityGate; analysis?: string },
): RecordReviewResult {
  const loop: LoopKind = agent === "review-test" ? "T" : "C";
  const advisoryAll = agent === "review-security";
  const raise = applyReviewFindings(task, objectArray<ReviewFindingInput>(packet.findings), {
    by: ref,
    loop,
    gate: options.gate,
    advisoryAll,
  });
  const recheck = applyRechecks(task, objectArray<RecheckInput>(packet.rechecks), {
    by: ref,
    // review-test also rechecks harness guard findings and phase-code test_issue findings (T loop).
    loops: [loop],
    reviewerActor: agent === "review-test" ? "*" : agent,
    gate: options.gate,
    advisoryAll,
    reraisedThisRun: raise.reraised,
  });
  const warnings = [...raise.warnings, ...recheck.warnings];
  const verdict = String(packet.verdict ?? "issues");
  const analysis =
    typeof packet.analysis === "string" && packet.analysis.trim()
      ? packet.analysis
      : options.analysis;
  const counts = `${String(raise.raised.length)} new, ${String(raise.reraised.length)} re-raised, ${String(recheck.rechecked.length + recheck.implicit.length)} rechecked`;
  const note = [firstSentence(analysis), counts].filter(Boolean).join(" — ");
  pushAgentLog(task, ref, at, verdict, note, packet, warnings);
  return {
    ref,
    raised: raise.raised,
    reraised: raise.reraised,
    rechecked: recheck.rechecked,
    implicit: recheck.implicit,
    warnings,
  };
}

// ── phase-code ──────────────────────────────────────────────────────

export interface RecordPhaseCodeResult {
  ref: string;
  filesChanged: string[];
  testIssueFindings: string[];
  responded: string[];
}

export function recordPhaseCode(
  task: TaskFileV2,
  ref: string,
  packet: Record<string, unknown>,
  at: string,
  options: { analysis?: string; isTestFile: (file: string) => boolean },
): RecordPhaseCodeResult {
  const warnings: string[] = [];
  let changes = objectArray<ChangeInput>(packet.changes);
  const legacyFiles = stringArray(packet.files_changed);
  const acCovered = stringArray(packet.ac_covered);
  if (changes.length === 0 && legacyFiles.length) {
    changes = legacyFiles.map((file) => ({
      file,
      action: "modify",
      kind: "code",
      ac_ids: acCovered,
    }));
    applyChanges(task, changes, ref, "code", { inferred: true });
    warnings.push("changes[] missing — inferred from files_changed + ac_covered");
  } else {
    applyChanges(task, changes, ref, "code");
  }
  const filesChanged = [
    ...new Set([
      ...changes.map((change) => change.file).filter((f): f is string => typeof f === "string"),
      ...legacyFiles,
    ]),
  ];

  const { responded, unlinked } = applyResponses(
    task,
    objectArray<ResponseInput>(packet.review_responses),
    { by: ref, loops: ["C", "V"] },
  );
  for (const label of unlinked) warnings.push(`unlinked review_response: ${label}`);

  // RGR: test_issue events (and test files touched) become T-loop findings for phase-test.
  const testIssues = packetEvents(packet).filter((event) => event.type === "test_issue");
  const findingInputs: ReviewFindingInput[] = testIssues.map((event) => ({
    severity: "critical",
    issue:
      typeof event.issue === "string" && event.issue
        ? event.issue
        : `Test issue in ${String(event.test_file ?? "tests")}`,
    file: typeof event.test_file === "string" ? event.test_file : undefined,
    ac_id: typeof event.ac_id === "string" ? event.ac_id : undefined,
    category: "test_issue",
    recommendation: typeof event.recommendation === "string" ? event.recommendation : undefined,
  }));
  for (const file of filesChanged.filter(options.isTestFile)) {
    findingInputs.push({
      severity: "critical",
      issue: `phase-code modified test file ${file} (tests are owned by phase-test)`,
      file,
      category: "test_issue",
      recommendation: "phase-test must own this change; revert or re-apply it in phase-test.",
    });
  }
  const raise = applyReviewFindings(task, findingInputs, {
    by: ref,
    loop: "T",
    gate: "none",
    matchPriorLoops: ["T"],
  });

  const note =
    firstSentence(options.analysis) ||
    `${String(filesChanged.length)} file(s) changed; tests_passing=${String(packet.tests_passing === true)}`;
  pushAgentLog(task, ref, at, String(packet.status ?? "done"), note, packet, [
    ...warnings,
    ...raise.warnings,
  ]);
  return {
    ref,
    filesChanged,
    testIssueFindings: [...raise.raised, ...raise.reraised],
    responded,
  };
}

// ── phase-verify-task ───────────────────────────────────────────────

export interface RecordVerifyResult {
  ref: string;
  passed: string[];
  failed: string[];
  raised: string[];
}

export function recordVerify(
  task: TaskFileV2,
  ref: string,
  packet: Record<string, unknown>,
  at: string,
  options: { analysis?: string },
): RecordVerifyResult {
  const warnings: string[] = [];
  let evidence = objectArray<EvidenceInput>(packet.evidence);
  if (evidence.length === 0) {
    // Legacy verify packets: `status: done` + `ac_covered` = pass for each covered AC.
    const covered = stringArray(packet.ac_covered);
    const targets = covered.length
      ? covered
      : task.requirements.filter((req) => req.id !== "_task").map((req) => req.id);
    evidence = targets.map((acId) => ({
      ac_id: acId,
      result: packet.status === "done" ? "pass" : "fail",
      tests: [],
    }));
    if (targets.length) warnings.push("evidence[] missing — inferred from status + ac_covered");
  }
  const applied = applyVerifyEvidence(task, evidence, ref);
  const note =
    firstSentence(options.analysis) ||
    `${String(applied.passed.length)} AC(s) pass, ${String(applied.failed.length)} fail`;
  pushAgentLog(
    task,
    ref,
    at,
    applied.failed.length ? "fail" : String(packet.status ?? "done"),
    note,
    packet,
    warnings,
  );
  return { ref, ...applied };
}

// ── Generic (stuck / unhandled returns) ─────────────────────────────

export function recordGeneric(
  task: TaskFileV2,
  ref: string,
  packet: Record<string, unknown>,
  at: string,
  options: { analysis?: string },
): void {
  const result = String(packet.status ?? packet.verdict ?? "returned");
  const question = typeof packet.question === "string" ? packet.question : "";
  const note = question ? `stuck: ${firstSentence(question)}` : firstSentence(options.analysis);
  pushAgentLog(task, ref, at, result, note || result, packet, []);
}

/** Attribute an event's `ac_id` for display (not persisted separately). */
export function eventRequirement(task: TaskFileV2, event: TaskEvent): string {
  return resolveAttribution(task, { ac_id: event.ac_id, file: event.test_file }).requirementId;
}

export { loopForPhase };
