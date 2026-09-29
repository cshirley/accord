/**
 * Per-task file v2 — requirement-centric trace + explicit loop control.
 *
 * Layout (read order = priority): header → `summary` (snapshot) → `control` (loop state for
 * recovery) → `requirements[]` (AC → changes → findings → history → verification) → `log[]`.
 *
 * Facts are written by post-result handlers through `src/tasks/model.ts`; snapshot fields
 * (`summary`, requirement `status`, finding `state`) are recomputed by `refreshTask` on every
 * write. See `docs/plans/task-trace-ledger-plan.md`.
 */

export const TASK_FILE_SCHEMA_VERSION = "2.0";

/** Loop a round belongs to: test (pre-impl), code, verify. */
export type LoopKind = "T" | "C" | "V";

export type TaskPipelinePhase =
  | "phase-test"
  | "review-test"
  | "phase-code"
  | "review-security"
  | "review-code"
  | "phase-verify-task";

export type TaskStatus = "pending" | "in_progress" | "blocked" | "done";

export type FindingSeverity = "critical" | "warning" | "suggestion";

export type FindingState =
  | "open"
  | "addressed"
  | "disputed"
  | "wont_fix_proposed"
  | "verified"
  | "reraised"
  | "dispute_upheld"
  | "wont_fix_accepted"
  | "waived"
  | "superseded";

/** History outcomes: fixer responses, reviewer rechecks, human decisions. */
export type HistoryOutcome =
  | "fixed"
  | "disputed"
  | "wont_fix"
  | "verified"
  | "reraised"
  | "dispute_upheld"
  | "wont_fix_accepted"
  | "waived"
  | "note";

export type RequirementStatus =
  | "pending"
  | "covered"
  | "open"
  | "implemented"
  | "satisfied"
  | "waived"
  | "n/a";

export type ChangeKind = "test" | "stub" | "fixture" | "config" | "code" | "dep";
export type ChangeAction = "add" | "modify" | "delete";

export interface Change {
  file: string;
  action: ChangeAction;
  kind: ChangeKind;
  /** Log refs of the agent runs that touched this file for this requirement, oldest first. */
  by: string[];
  tests?: string[];
  /** Set when the harness attributed the change (agent did not report `changes[]`). */
  inferred?: boolean;
}

export interface HistoryEntry {
  by: string;
  outcome: HistoryOutcome;
  note?: string;
  /** Severity change on re-raise. */
  severity?: FindingSeverity;
  /** `human` for `accord unblock` decisions. */
  actor?: "human";
}

export interface FindingDetail {
  category?: string;
  evidence?: string;
  recommendation?: string;
}

export interface Finding {
  id: string;
  /** Snapshot of the last history outcome (recomputed by `refreshTask`). */
  state: FindingState;
  severity: FindingSeverity;
  /** Loop that owns resolution: T → phase-test/review-test, C → phase-code/raiser, V → phase-code/phase-verify-task. */
  loop: LoopKind;
  /** Below the gate (or from review-security): shown, never blocks. */
  advisory?: boolean;
  tc?: string;
  also_affects?: string[];
  issue: string;
  file?: string;
  line?: number;
  detail?: FindingDetail;
  /** Log ref of the raising run (`T1/review-test`, `C2/phase-code`, `T2/harness`). */
  raised: string;
  history: HistoryEntry[];
}

export interface RequirementVerification {
  by: string;
  result: "pass" | "fail";
  tests: string[];
  command?: string;
}

export interface Requirement {
  /** `AC-n`, `QF` (quick fix), or `_task` (unattributed). */
  id: string;
  /** MUST / SHOULD / MAY when known from spec. */
  requirement?: string;
  text: string;
  test_cases: string[];
  status: RequirementStatus;
  changes: Change[];
  findings: Finding[];
  verification: RequirementVerification | null;
  waived?: { by: string; reason: string };
}

export type InFlightStage = "spawned" | "returned";

export interface InFlight {
  ref: string;
  agent: string;
  stage: InFlightStage;
  at: string;
}

export interface RetryCounter {
  used: number;
  lifetime: number;
}

export interface TaskRetries {
  test_review: RetryCounter;
  code_review: RetryCounter;
  rgr: RetryCounter;
  verify: RetryCounter;
  unblocks: number;
}

export type BlockKind = "cap" | "crash" | "manual" | "stuck";

export interface TaskBlock {
  kind: BlockKind;
  reason: string;
  /** Log ref where the block was decided. */
  ref: string;
  /** Retry loop that hit its cap (kind `cap`). */
  loop?: LoopKind | "rgr";
  /** Cap is a lifetime cap — `accord unblock` cannot reset it. */
  lifetime?: boolean;
  /** Working-tree fingerprint when blocked (blind-unblock guard). */
  fingerprint?: string;
}

export type RedKind = "behaviour" | "import_only" | "crash" | "unknown";

export interface LastTestRun {
  ref: string;
  red?: RedKind;
  confirmed?: boolean;
  /** Sidecar file name (relative to the task sidecar dir). */
  output?: string;
}

export interface QuickFixContract {
  plan: {
    summary: string;
    target_paths: string[];
    out_of_scope: string[];
    expected_finish: string;
  };
  test: {
    strategy: "existing_tests" | "new_red_test" | "no_test";
    command?: string;
    red_required: boolean;
    reason?: string;
  };
}

export interface TaskControl {
  owner_nonce: string;
  phase: TaskPipelinePhase;
  status: TaskStatus;
  pre_impl_gates: "pending" | "complete";
  /** Current round id, e.g. `T2`, `C1`, `V1`. */
  round: string;
  in_flight: InFlight | null;
  retries: TaskRetries;
  blocked: TaskBlock | null;
  test_files: string[];
  stub_files: string[];
  last_test_run: LastTestRun | null;
  quick_fix_contract?: QuickFixContract;
}

/** Agent-reported event (deviation, escalation, test_issue, request_review). */
export interface TaskEvent {
  type: string;
  [key: string]: unknown;
}

export interface LogEntry {
  ref: string;
  at: string;
  /** Agent status/verdict, or decision result (`advance`, `retry`, `blocked`, `done`, …). */
  result: string;
  note: string;
  actor?: "human";
  next_phase?: string;
  events?: TaskEvent[];
  warnings?: string[];
}

export interface SummaryBlocker {
  finding: string;
  ac: string;
  severity: FindingSeverity;
  state: FindingState;
  issue: string;
}

export interface TaskSummaryNext {
  who: "agent" | "human" | "harness" | "none";
  why: string;
  do: string[];
}

export interface TaskSummary {
  headline: string;
  updated: string;
  requirements: Partial<Record<RequirementStatus, number>>;
  next: TaskSummaryNext;
  blockers: SummaryBlocker[];
  advisories: SummaryBlocker[];
}

export interface TaskFileV2 {
  schema_version: typeof TASK_FILE_SCHEMA_VERSION;
  work_item: string;
  task: number;
  title: string;
  plan: string | null;
  spec: string | null;
  summary: TaskSummary;
  control: TaskControl;
  requirements: Requirement[];
  log: LogEntry[];
}

export const UNATTRIBUTED_REQUIREMENT_ID = "_task";
export const QUICK_FIX_REQUIREMENT_ID = "QF";
