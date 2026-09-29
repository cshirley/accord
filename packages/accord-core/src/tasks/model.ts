/**
 * Pure task-file v2 model: refs, seeding, attribution, findings ledger, gating, refresh.
 *
 * No I/O. Post-result handlers load the task file, call these functions, then persist via
 * `advancePrimaryTask` (which runs `refreshTask` inside the same locked write).
 */

import {
  type Change,
  type ChangeAction,
  type ChangeKind,
  type Finding,
  type FindingSeverity,
  type FindingState,
  type HistoryEntry,
  type HistoryOutcome,
  type LogEntry,
  type LoopKind,
  QUICK_FIX_REQUIREMENT_ID,
  type QuickFixContract,
  type Requirement,
  type RequirementStatus,
  type SummaryBlocker,
  TASK_FILE_SCHEMA_VERSION,
  type TaskControl,
  type TaskFileV2,
  type TaskPipelinePhase,
  type TaskRetries,
  type TaskSummary,
  type TaskSummaryNext,
  UNATTRIBUTED_REQUIREMENT_ID,
} from "./types.js";

// ── Refs & rounds ───────────────────────────────────────────────────

const ROUND_RE = /^([TCV])(\d+)$/;
const REF_RE = /^([TCV]\d+)\/([a-z-]+)(?:\.(\d+))?$/;

export function parseRound(round: string): { loop: LoopKind; n: number } | null {
  const match = ROUND_RE.exec(round);
  if (!match) return null;
  return { loop: match[1] as LoopKind, n: Number(match[2]) };
}

export function parseRef(ref: string): { round: string; actor: string; attempt: number } | null {
  const match = REF_RE.exec(ref);
  if (!match) return null;
  return { round: match[1], actor: match[2], attempt: match[3] ? Number(match[3]) : 1 };
}

export function loopForPhase(phase: string): LoopKind {
  if (phase === "phase-test" || phase === "review-test") return "T";
  if (phase === "phase-verify-task") return "V";
  return "C";
}

export function headPhaseForLoop(loop: LoopKind): TaskPipelinePhase {
  if (loop === "T") return "phase-test";
  if (loop === "V") return "phase-verify-task";
  return "phase-code";
}

/** Agent that answers findings owned by `loop`. */
export function respondentForLoop(loop: LoopKind): "phase-test" | "phase-code" {
  return loop === "T" ? "phase-test" : "phase-code";
}

function maxRoundNumber(task: TaskFileV2, loop: LoopKind): number {
  let max = 0;
  const consider = (round: string | undefined) => {
    const parsed = round ? parseRound(round) : null;
    if (parsed && parsed.loop === loop && parsed.n > max) max = parsed.n;
  };
  consider(task.control.round);
  for (const entry of task.log) consider(parseRef(entry.ref)?.round);
  return max;
}

/** Open the next round of `loop` and make it current. Returns the new round id. */
export function openRound(task: TaskFileV2, loop: LoopKind): string {
  const round = `${loop}${String(maxRoundNumber(task, loop) + 1)}`;
  task.control.round = round;
  return round;
}

/**
 * Ensure the current round belongs to `actor`'s loop (rounds are otherwise opened explicitly by
 * harness decisions). A re-run within the same round gets an attempt suffix via `allocateRef`.
 */
export function ensureRoundForActor(task: TaskFileV2, actor: string): string {
  const loop = loopForPhase(actor);
  const current = parseRound(task.control.round);
  if (!current || current.loop !== loop) {
    return openRound(task, loop);
  }
  return task.control.round;
}

/** `<round>/<actor>`, suffixed `.n` when the actor already ran in this round. */
export function allocateRef(task: TaskFileV2, actor: string): string {
  const base = `${task.control.round}/${actor}`;
  const taken = new Set(task.log.map((entry) => entry.ref));
  if (!taken.has(base)) return base;
  let attempt = 2;
  while (taken.has(`${base}.${String(attempt)}`)) attempt += 1;
  return `${base}.${String(attempt)}`;
}

export function refActor(ref: string): string {
  return parseRef(ref)?.actor ?? "";
}

export function refLoop(ref: string): LoopKind | null {
  const round = parseRef(ref)?.round;
  return round ? (parseRound(round)?.loop ?? null) : null;
}

export function hasLogRef(task: TaskFileV2, ref: string): boolean {
  return task.log.some((entry) => entry.ref === ref);
}

export function appendLog(task: TaskFileV2, entry: LogEntry): void {
  task.log.push(entry);
}

// ── Seeding ─────────────────────────────────────────────────────────

export interface SpecAcceptanceCriterion {
  id?: unknown;
  requirement?: unknown;
  type?: unknown;
  scenario?: unknown;
  criterion?: unknown;
}

export interface SpecTestCase {
  id?: unknown;
  covers?: unknown;
}

export interface SeedTaskInput {
  workItemId: string;
  taskId: number;
  title: string;
  planPath: string | null;
  specPath: string | null;
  coversAc: string[];
  acceptanceCriteria: SpecAcceptanceCriterion[];
  testCases: SpecTestCase[];
  ownerNonce: string;
  initialPhase: TaskPipelinePhase;
  preImplGates: "pending" | "complete";
  quickFixContract?: QuickFixContract;
  at: string;
}

/** First line of an AC's scenario/criterion text, trimmed to one readable line. */
export function acOneLine(ac: SpecAcceptanceCriterion): string {
  const raw =
    typeof ac.criterion === "string" && ac.criterion.trim()
      ? ac.criterion
      : typeof ac.scenario === "string" && ac.scenario.trim()
        ? ac.scenario
        : "";
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const thenLine = lines.find((line) => /^then\b/i.test(line));
  const chosen = thenLine ?? lines[0] ?? "";
  return chosen.length > 220 ? `${chosen.slice(0, 217)}…` : chosen;
}

export function emptyRetries(): TaskRetries {
  return {
    test_review: { used: 0, lifetime: 0 },
    code_review: { used: 0, lifetime: 0 },
    rgr: { used: 0, lifetime: 0 },
    verify: { used: 0, lifetime: 0 },
    unblocks: 0,
  };
}

function emptySummary(at: string): TaskSummary {
  return {
    headline: "",
    updated: at,
    requirements: {},
    next: { who: "agent", why: "", do: [] },
    blockers: [],
    advisories: [],
  };
}

function newRequirement(id: string, text: string, extra?: Partial<Requirement>): Requirement {
  return {
    id,
    text,
    test_cases: [],
    status: id === UNATTRIBUTED_REQUIREMENT_ID ? "n/a" : "pending",
    changes: [],
    findings: [],
    verification: null,
    ...extra,
  };
}

export function seedTaskFile(input: SeedTaskInput): TaskFileV2 {
  const requirements: Requirement[] = [];
  if (input.quickFixContract) {
    requirements.push(
      newRequirement(QUICK_FIX_REQUIREMENT_ID, input.quickFixContract.plan.expected_finish, {
        requirement: "MUST",
      }),
    );
  }
  for (const acId of input.coversAc) {
    if (requirements.some((req) => req.id === acId)) continue;
    const ac = input.acceptanceCriteria.find((candidate) => String(candidate.id) === acId);
    const testCases = input.testCases
      .filter((tc) => tc.covers === acId && typeof tc.id === "string")
      .map((tc) => String(tc.id));
    requirements.push(
      newRequirement(acId, ac ? acOneLine(ac) : "(not found in spec)", {
        ...(typeof ac?.requirement === "string" ? { requirement: ac.requirement } : {}),
        test_cases: testCases,
      }),
    );
  }
  requirements.push(
    newRequirement(UNATTRIBUTED_REQUIREMENT_ID, "Changes/findings not attributable to one AC"),
  );

  const control: TaskControl = {
    owner_nonce: input.ownerNonce,
    phase: input.initialPhase,
    status: "pending",
    pre_impl_gates: input.preImplGates,
    round: `${loopForPhase(input.initialPhase)}1`,
    in_flight: null,
    retries: emptyRetries(),
    blocked: null,
    test_files: [],
    stub_files: [],
    last_test_run: null,
    ...(input.quickFixContract ? { quick_fix_contract: input.quickFixContract } : {}),
  };

  const task: TaskFileV2 = {
    schema_version: TASK_FILE_SCHEMA_VERSION,
    work_item: input.workItemId,
    task: input.taskId,
    title: input.title,
    plan: input.planPath,
    spec: input.specPath,
    summary: emptySummary(input.at),
    control,
    requirements,
    log: [],
  };
  refreshTask(task, input.at);
  return task;
}

export function isTaskFileV2(value: unknown): value is TaskFileV2 {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema_version === TASK_FILE_SCHEMA_VERSION &&
    typeof record.control === "object" &&
    record.control !== null &&
    Array.isArray(record.requirements) &&
    Array.isArray(record.log)
  );
}

// ── Requirements & attribution ──────────────────────────────────────

export function unattributed(task: TaskFileV2): Requirement {
  let req = task.requirements.find((candidate) => candidate.id === UNATTRIBUTED_REQUIREMENT_ID);
  if (!req) {
    req = newRequirement(
      UNATTRIBUTED_REQUIREMENT_ID,
      "Changes/findings not attributable to one AC",
    );
    task.requirements.push(req);
  }
  return req;
}

export function findRequirement(task: TaskFileV2, id: string): Requirement | undefined {
  return task.requirements.find((req) => req.id === id);
}

function attributableRequirementIds(task: TaskFileV2): string[] {
  return task.requirements
    .filter((req) => req.id !== UNATTRIBUTED_REQUIREMENT_ID)
    .map((req) => req.id);
}

export function tcToAcMap(task: TaskFileV2): Map<string, string> {
  const map = new Map<string, string>();
  for (const req of task.requirements) {
    for (const tc of req.test_cases) map.set(tc, req.id);
  }
  return map;
}

/** file → requirement ids whose `changes[]` touch it. */
export function fileToAcMap(task: TaskFileV2): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const req of task.requirements) {
    if (req.id === UNATTRIBUTED_REQUIREMENT_ID) continue;
    for (const change of req.changes) {
      const key = normalisePath(change.file);
      const set = map.get(key) ?? new Set<string>();
      set.add(req.id);
      map.set(key, set);
    }
  }
  return map;
}

function normalisePath(file: string): string {
  return file.replace(/^\.\//, "").trim();
}

function filesMatch(left: string, right: string): boolean {
  const a = normalisePath(left);
  const b = normalisePath(right);
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

export interface AttributionInput {
  ac_id?: unknown;
  tc_id?: unknown;
  ref?: unknown;
  file?: unknown;
  also_affects?: unknown;
}

export interface Attribution {
  requirementId: string;
  tc?: string;
  alsoAffects: string[];
  warning?: string;
}

/** Resolve the primary requirement for a finding / event using ac_id → ref → tc → file map. */
export function resolveAttribution(task: TaskFileV2, input: AttributionInput): Attribution {
  const known = new Set(attributableRequirementIds(task));
  const tcMap = tcToAcMap(task);
  const alsoAffects = Array.isArray(input.also_affects)
    ? input.also_affects.filter((id): id is string => typeof id === "string" && known.has(id))
    : [];
  let tc = typeof input.tc_id === "string" ? input.tc_id : undefined;
  const ref = typeof input.ref === "string" ? input.ref.trim() : "";
  if (!tc && /^TC-\d+$/.test(ref)) tc = ref;

  const candidates: string[] = [];
  if (typeof input.ac_id === "string") candidates.push(input.ac_id);
  if (/^AC-\d+$/.test(ref)) candidates.push(ref);
  if (tc && tcMap.has(tc)) candidates.push(tcMap.get(tc) as string);
  const quickFix = known.has(QUICK_FIX_REQUIREMENT_ID) ? QUICK_FIX_REQUIREMENT_ID : null;

  for (const candidate of candidates) {
    if (known.has(candidate)) {
      return {
        requirementId: candidate,
        ...(tc ? { tc } : {}),
        alsoAffects: alsoAffects.filter((id) => id !== candidate),
      };
    }
  }

  if (typeof input.file === "string" && input.file.trim()) {
    const map = fileToAcMap(task);
    const hits = new Set<string>();
    for (const [file, ids] of map) {
      if (filesMatch(file, input.file)) for (const id of ids) hits.add(id);
    }
    if (hits.size === 1) {
      const [only] = [...hits];
      return { requirementId: only, ...(tc ? { tc } : {}), alsoAffects };
    }
    if (hits.size > 1) {
      return {
        requirementId: UNATTRIBUTED_REQUIREMENT_ID,
        ...(tc ? { tc } : {}),
        alsoAffects: [...hits],
        warning: `${input.file} serves ${[...hits].join(", ")} — attributed to _task`,
      };
    }
  }

  if (quickFix) {
    return { requirementId: quickFix, ...(tc ? { tc } : {}), alsoAffects };
  }
  const unknownIds = candidates.filter((id) => !known.has(id));
  return {
    requirementId: UNATTRIBUTED_REQUIREMENT_ID,
    ...(tc ? { tc } : {}),
    alsoAffects: [...alsoAffects, ...unknownIds.filter((id) => /^AC-\d+$/.test(id))],
  };
}

export interface ChangeInput {
  file?: unknown;
  action?: unknown;
  kind?: unknown;
  ac_ids?: unknown;
  tc_ids?: unknown;
  tests?: unknown;
}

const CHANGE_ACTIONS: ReadonlySet<string> = new Set(["add", "modify", "delete"]);
const CHANGE_KINDS: ReadonlySet<string> = new Set([
  "test",
  "stub",
  "fixture",
  "config",
  "code",
  "dep",
]);

/** Attach reported changes to each requirement they serve; unknown ACs go to `_task`. */
export function applyChanges(
  task: TaskFileV2,
  changes: ReadonlyArray<ChangeInput>,
  by: string,
  defaultKind: ChangeKind,
  options?: { inferred?: boolean },
): string[] {
  const touched = new Set<string>();
  const known = new Set(attributableRequirementIds(task));
  const tcMap = tcToAcMap(task);
  for (const raw of changes) {
    if (typeof raw.file !== "string" || !raw.file.trim()) continue;
    const action = (
      typeof raw.action === "string" && CHANGE_ACTIONS.has(raw.action) ? raw.action : "modify"
    ) as ChangeAction;
    const kind = (
      typeof raw.kind === "string" && CHANGE_KINDS.has(raw.kind) ? raw.kind : defaultKind
    ) as ChangeKind;
    const tests = Array.isArray(raw.tests)
      ? raw.tests.filter((t): t is string => typeof t === "string")
      : [];
    const acIds = new Set<string>();
    if (Array.isArray(raw.ac_ids)) {
      for (const id of raw.ac_ids) if (typeof id === "string" && known.has(id)) acIds.add(id);
    }
    if (Array.isArray(raw.tc_ids)) {
      for (const tc of raw.tc_ids) {
        const ac = typeof tc === "string" ? tcMap.get(tc) : undefined;
        if (ac) acIds.add(ac);
      }
    }
    if (acIds.size === 0 && known.has(QUICK_FIX_REQUIREMENT_ID)) {
      acIds.add(QUICK_FIX_REQUIREMENT_ID);
    }
    const targets =
      acIds.size > 0
        ? [...acIds].map((id) => findRequirement(task, id) as Requirement)
        : [unattributed(task)];
    for (const req of targets) {
      const existing = req.changes.find(
        (candidate) => candidate.file === raw.file && candidate.kind === kind,
      );
      if (existing) {
        if (!existing.by.includes(by)) existing.by.push(by);
        if (action === "delete") existing.action = "delete";
        if (tests.length) existing.tests = [...new Set([...(existing.tests ?? []), ...tests])];
        if (!options?.inferred && existing.inferred) existing.inferred = undefined;
      } else {
        const change: Change = {
          file: raw.file,
          action,
          kind,
          by: [by],
          ...(tests.length ? { tests } : {}),
          ...(options?.inferred ? { inferred: true } : {}),
        };
        req.changes.push(change);
      }
      touched.add(req.id);
    }
  }
  return [...touched];
}

// ── Findings ledger ─────────────────────────────────────────────────

export function allFindings(task: TaskFileV2): Array<{ req: Requirement; finding: Finding }> {
  const out: Array<{ req: Requirement; finding: Finding }> = [];
  for (const req of task.requirements) {
    for (const finding of req.findings) out.push({ req, finding });
  }
  return out;
}

export function findFinding(
  task: TaskFileV2,
  id: string,
): { req: Requirement; finding: Finding } | undefined {
  return allFindings(task).find((entry) => entry.finding.id === id);
}

export function nextFindingId(task: TaskFileV2): string {
  let max = 0;
  for (const { finding } of allFindings(task)) {
    const n = Number(/^F-(\d+)$/.exec(finding.id)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return `F-${String(max + 1).padStart(3, "0")}`;
}

const RESOLVED_STATES: ReadonlySet<FindingState> = new Set([
  "verified",
  "dispute_upheld",
  "wont_fix_accepted",
  "waived",
  "superseded",
]);
const GATING_STATES: ReadonlySet<FindingState> = new Set([
  "open",
  "reraised",
  "disputed",
  "wont_fix_proposed",
]);
/** States a respondent (phase-test / phase-code) must answer. */
const OWED_STATES: ReadonlySet<FindingState> = new Set(["open", "reraised"]);

export function isResolved(finding: Finding): boolean {
  return RESOLVED_STATES.has(finding.state);
}

export function stateFromHistory(history: ReadonlyArray<HistoryEntry>): FindingState {
  let state: FindingState = "open";
  for (const entry of history) {
    switch (entry.outcome) {
      case "fixed":
        state = "addressed";
        break;
      case "disputed":
        state = "disputed";
        break;
      case "wont_fix":
        state = "wont_fix_proposed";
        break;
      case "note":
        break;
      default:
        state = entry.outcome;
    }
  }
  return state;
}

/** Findings that block `loops` (non-advisory, unresolved, requirement not waived). */
export function gatingFindings(
  task: TaskFileV2,
  loops: ReadonlyArray<LoopKind> = ["T", "C", "V"],
): Array<{ req: Requirement; finding: Finding }> {
  return allFindings(task).filter(
    ({ req, finding }) =>
      !req.waived &&
      !finding.advisory &&
      loops.includes(finding.loop) &&
      GATING_STATES.has(stateFromHistory(finding.history)),
  );
}

/** Findings the respondent for `loops` must answer on its next run (advisory included). */
export function owedFindings(
  task: TaskFileV2,
  loops: ReadonlyArray<LoopKind>,
): Array<{ req: Requirement; finding: Finding }> {
  return allFindings(task).filter(
    ({ req, finding }) =>
      !req.waived &&
      loops.includes(finding.loop) &&
      OWED_STATES.has(stateFromHistory(finding.history)),
  );
}

function severityOf(value: unknown): FindingSeverity {
  return value === "critical" || value === "warning" || value === "suggestion" ? value : "warning";
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { suggestion: 1, warning: 2, critical: 3 };

export type SeverityGate = "none" | "warn" | "block";

export function severityMeetsGate(severity: FindingSeverity, gate: SeverityGate): boolean {
  if (gate === "none") return true;
  if (gate === "warn") return SEVERITY_RANK[severity] >= SEVERITY_RANK.warning;
  return severity === "critical";
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
}

export function issueSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const SIMILARITY_THRESHOLD = 0.5;

export interface ReviewFindingInput {
  severity?: unknown;
  issue?: unknown;
  file?: unknown;
  line?: unknown;
  evidence?: unknown;
  recommendation?: unknown;
  category?: unknown;
  ref?: unknown;
  ac_id?: unknown;
  tc_id?: unknown;
  also_affects?: unknown;
  finding_id?: unknown;
}

export interface RaiseContext {
  /** Log ref of the raising run. */
  by: string;
  loop: LoopKind;
  gate: SeverityGate;
  /** Every raised finding is advisory (review-security). */
  advisoryAll?: boolean;
  /** Which prior findings a new finding may be matched against (re-raise without `finding_id`). */
  matchPriorLoops?: ReadonlyArray<LoopKind>;
}

export interface RaiseResult {
  raised: string[];
  reraised: string[];
  warnings: string[];
}

function reraise(
  finding: Finding,
  by: string,
  note: string,
  severity: FindingSeverity,
  gate: SeverityGate,
  advisoryAll: boolean,
): void {
  const entry: HistoryEntry = { by, outcome: "reraised", ...(note ? { note } : {}) };
  if (severity !== finding.severity) {
    entry.severity = severity;
    finding.severity = severity;
  }
  finding.advisory = advisoryAll || !severityMeetsGate(severity, gate) ? true : undefined;
  finding.history.push(entry);
  finding.state = stateFromHistory(finding.history);
}

/** Record reviewer findings: re-raise known IDs (explicit or by similarity), else raise new. */
export function applyReviewFindings(
  task: TaskFileV2,
  findings: ReadonlyArray<ReviewFindingInput>,
  ctx: RaiseContext,
): RaiseResult {
  const result: RaiseResult = { raised: [], reraised: [], warnings: [] };
  const matchLoops = ctx.matchPriorLoops ?? [ctx.loop];
  const advisoryAll = ctx.advisoryAll === true;

  for (const raw of findings) {
    const issue = typeof raw.issue === "string" ? raw.issue.trim() : "";
    if (!issue) continue;
    const severity = severityOf(raw.severity);

    // Explicit re-raise by id.
    if (typeof raw.finding_id === "string") {
      const prior = findFinding(task, raw.finding_id);
      if (prior) {
        reraise(prior.finding, ctx.by, issue, severity, ctx.gate, advisoryAll);
        result.reraised.push(prior.finding.id);
        continue;
      }
      result.warnings.push(`finding_id ${raw.finding_id} not found — recorded as new finding`);
    }

    const attribution = resolveAttribution(task, raw);
    if (attribution.warning) result.warnings.push(attribution.warning);

    // Implicit re-raise: same requirement + file, similar issue, not already re-raised this run.
    const file = typeof raw.file === "string" ? raw.file : undefined;
    const req = findRequirement(task, attribution.requirementId) ?? unattributed(task);
    const similar = req.findings.find(
      (candidate) =>
        matchLoops.includes(candidate.loop) &&
        !result.reraised.includes(candidate.id) &&
        !result.raised.includes(candidate.id) &&
        candidate.state !== "waived" &&
        (!file || !candidate.file || filesMatch(candidate.file, file)) &&
        issueSimilarity(candidate.issue, issue) >= SIMILARITY_THRESHOLD,
    );
    if (similar) {
      reraise(similar, ctx.by, issue, severity, ctx.gate, advisoryAll);
      result.reraised.push(similar.id);
      continue;
    }

    const detail = {
      ...(typeof raw.category === "string" ? { category: raw.category } : {}),
      ...(typeof raw.evidence === "string" ? { evidence: raw.evidence } : {}),
      ...(typeof raw.recommendation === "string" ? { recommendation: raw.recommendation } : {}),
    };
    const advisory = advisoryAll || !severityMeetsGate(severity, ctx.gate);
    const finding: Finding = {
      id: nextFindingId(task),
      state: "open",
      severity,
      loop: ctx.loop,
      ...(advisory ? { advisory: true } : {}),
      ...(attribution.tc ? { tc: attribution.tc } : {}),
      ...(attribution.alsoAffects.length ? { also_affects: attribution.alsoAffects } : {}),
      issue,
      ...(file ? { file } : {}),
      ...(typeof raw.line === "number" && raw.line >= 1 ? { line: raw.line } : {}),
      ...(Object.keys(detail).length ? { detail } : {}),
      raised: ctx.by,
      history: [],
    };
    req.findings.push(finding);
    result.raised.push(finding.id);
  }
  return result;
}

export interface RecheckInput {
  finding_id?: unknown;
  outcome?: unknown;
  note?: unknown;
  severity?: unknown;
}

const RECHECK_OUTCOMES: ReadonlySet<string> = new Set([
  "verified",
  "reraised",
  "dispute_upheld",
  "wont_fix_accepted",
]);

/**
 * Apply reviewer `rechecks[]`. Only findings owned by `loops` may be rechecked by this reviewer.
 * Afterwards, prior `addressed` / `disputed` findings raised by `reviewerActor` that were neither
 * rechecked nor re-raised are closed implicitly (reviewer did not object).
 */
export function applyRechecks(
  task: TaskFileV2,
  rechecks: ReadonlyArray<RecheckInput>,
  ctx: {
    by: string;
    loops: ReadonlyArray<LoopKind>;
    reviewerActor: string;
    gate: SeverityGate;
    advisoryAll?: boolean;
    /** Finding ids re-raised by this run's `findings[]` (skip implicit close). */
    reraisedThisRun: ReadonlyArray<string>;
  },
): { rechecked: string[]; implicit: string[]; warnings: string[] } {
  const rechecked: string[] = [];
  const implicit: string[] = [];
  const warnings: string[] = [];

  for (const raw of rechecks) {
    if (typeof raw.finding_id !== "string") continue;
    const outcome = typeof raw.outcome === "string" ? raw.outcome : "";
    if (!RECHECK_OUTCOMES.has(outcome)) {
      warnings.push(`recheck ${raw.finding_id}: unknown outcome "${outcome}"`);
      continue;
    }
    const hit = findFinding(task, raw.finding_id);
    if (!hit) {
      warnings.push(`recheck ${raw.finding_id}: finding not found`);
      continue;
    }
    if (!ctx.loops.includes(hit.finding.loop)) {
      warnings.push(`recheck ${raw.finding_id}: not owned by this reviewer — ignored`);
      continue;
    }
    const note = typeof raw.note === "string" ? raw.note : "";
    if (outcome === "reraised") {
      reraise(
        hit.finding,
        ctx.by,
        note,
        raw.severity === undefined ? hit.finding.severity : severityOf(raw.severity),
        ctx.gate,
        ctx.advisoryAll === true,
      );
    } else {
      hit.finding.history.push({
        by: ctx.by,
        outcome: outcome as HistoryOutcome,
        ...(note ? { note } : {}),
      });
      hit.finding.state = stateFromHistory(hit.finding.history);
    }
    rechecked.push(hit.finding.id);
  }

  for (const { finding } of allFindings(task)) {
    if (!ctx.loops.includes(finding.loop)) continue;
    if (refActor(finding.raised) !== ctx.reviewerActor && ctx.reviewerActor !== "*") continue;
    if (rechecked.includes(finding.id) || ctx.reraisedThisRun.includes(finding.id)) continue;
    const state = stateFromHistory(finding.history);
    if (state === "addressed") {
      finding.history.push({ by: ctx.by, outcome: "verified", note: "not re-raised" });
    } else if (state === "disputed") {
      finding.history.push({ by: ctx.by, outcome: "dispute_upheld", note: "not re-raised" });
    } else {
      continue;
    }
    finding.state = stateFromHistory(finding.history);
    implicit.push(finding.id);
  }

  return { rechecked, implicit, warnings };
}

export interface ResponseInput {
  finding_id?: unknown;
  issue?: unknown;
  ref?: unknown;
  ac_id?: unknown;
  file?: unknown;
  resolution?: unknown;
  note?: unknown;
}

const RESPONSE_RESOLUTIONS: ReadonlySet<string> = new Set(["fixed", "disputed", "wont_fix"]);

/**
 * Apply fixer `review_responses[]` to findings owned by `loops`. Unmatched responses are
 * returned as warnings (recorded on the log entry).
 */
export function applyResponses(
  task: TaskFileV2,
  responses: ReadonlyArray<ResponseInput>,
  ctx: { by: string; loops: ReadonlyArray<LoopKind> },
): { responded: string[]; unlinked: string[] } {
  const responded: string[] = [];
  const unlinked: string[] = [];
  const candidates = () =>
    allFindings(task).filter(
      ({ finding }) =>
        ctx.loops.includes(finding.loop) &&
        !responded.includes(finding.id) &&
        !isResolved({ ...finding, state: stateFromHistory(finding.history) }),
    );

  for (const raw of responses) {
    const resolution = typeof raw.resolution === "string" ? raw.resolution : "";
    const note = typeof raw.note === "string" ? raw.note : "";
    const label =
      typeof raw.finding_id === "string"
        ? raw.finding_id
        : typeof raw.issue === "string"
          ? raw.issue.slice(0, 80)
          : "(no id)";
    if (!RESPONSE_RESOLUTIONS.has(resolution)) {
      unlinked.push(`${label}: unknown resolution "${resolution}"`);
      continue;
    }

    let target: Finding | undefined;
    if (typeof raw.finding_id === "string") {
      target = candidates().find(({ finding }) => finding.id === raw.finding_id)?.finding;
    } else {
      const issue = typeof raw.issue === "string" ? raw.issue : "";
      const acHint =
        typeof raw.ac_id === "string"
          ? raw.ac_id
          : typeof raw.ref === "string" && /^AC-\d+$/.test(raw.ref)
            ? raw.ref
            : undefined;
      const tcHint = typeof raw.ref === "string" && /^TC-\d+$/.test(raw.ref) ? raw.ref : undefined;
      let best: { finding: Finding; score: number } | undefined;
      for (const { req, finding } of candidates()) {
        let score = issue ? issueSimilarity(finding.issue, issue) : 0;
        if (acHint && req.id === acHint) score += 0.2;
        if (tcHint && finding.tc === tcHint) score += 0.2;
        if (typeof raw.file === "string" && finding.file && filesMatch(finding.file, raw.file)) {
          score += 0.1;
        }
        if (!best || score > best.score) best = { finding, score };
      }
      if (best && best.score >= SIMILARITY_THRESHOLD) target = best.finding;
    }

    if (!target) {
      unlinked.push(label);
      continue;
    }
    target.history.push({
      by: ctx.by,
      outcome: resolution as HistoryOutcome,
      ...(note ? { note } : {}),
    });
    target.state = stateFromHistory(target.history);
    responded.push(target.id);
  }
  return { responded, unlinked };
}

export interface EvidenceInput {
  ac_id?: unknown;
  result?: unknown;
  tests?: unknown;
  command?: unknown;
  note?: unknown;
}

/**
 * Apply phase-verify-task `evidence[]`. Pass → `verification` + close V findings for that AC.
 * Fail → raise / re-raise a gating V finding under that AC.
 */
export function applyVerifyEvidence(
  task: TaskFileV2,
  evidence: ReadonlyArray<EvidenceInput>,
  by: string,
): { passed: string[]; failed: string[]; raised: string[] } {
  const passed: string[] = [];
  const failed: string[] = [];
  const raised: string[] = [];
  for (const raw of evidence) {
    const acId = typeof raw.ac_id === "string" ? raw.ac_id : "";
    const req = findRequirement(task, acId);
    if (!req) continue;
    const tests = Array.isArray(raw.tests)
      ? raw.tests.filter((t): t is string => typeof t === "string")
      : [];
    const command = typeof raw.command === "string" ? raw.command : undefined;
    const openV = req.findings.filter(
      (finding) => finding.loop === "V" && !RESOLVED_STATES.has(stateFromHistory(finding.history)),
    );
    if (raw.result === "pass") {
      req.verification = { by, result: "pass", tests, ...(command ? { command } : {}) };
      for (const finding of openV) {
        finding.history.push({ by, outcome: "verified" });
        finding.state = stateFromHistory(finding.history);
      }
      passed.push(acId);
      continue;
    }
    req.verification = { by, result: "fail", tests, ...(command ? { command } : {}) };
    failed.push(acId);
    const note = typeof raw.note === "string" && raw.note ? raw.note : "";
    const issue = `Verification failed for ${acId}${tests.length ? `: ${tests.join(", ")}` : ""}`;
    if (openV.length > 0) {
      for (const finding of openV) {
        finding.history.push({ by, outcome: "reraised", ...(note ? { note } : {}) });
        finding.state = stateFromHistory(finding.history);
      }
      continue;
    }
    const finding: Finding = {
      id: nextFindingId(task),
      state: "open",
      severity: "critical",
      loop: "V",
      issue,
      detail: {
        category: "verification",
        ...(note ? { evidence: note } : {}),
        recommendation: "Fix production code so the listed tests pass; do not edit tests.",
      },
      raised: by,
      history: [],
    };
    req.findings.push(finding);
    raised.push(finding.id);
  }
  return { passed, failed, raised };
}

// ── Human decisions (accord unblock) ────────────────────────────────

export type HumanAction = "note" | "fixed" | "accept" | "waive";

export interface HumanDecision {
  target: string;
  action: HumanAction;
  reason: string;
}

export function applyHumanDecision(
  task: TaskFileV2,
  decision: HumanDecision,
  by: string,
): { ok: true } | { ok: false; error: string } {
  if (/^F-\d+$/.test(decision.target)) {
    const hit = findFinding(task, decision.target);
    if (!hit) return { ok: false, error: `Finding ${decision.target} not found` };
    const state = stateFromHistory(hit.finding.history);
    let outcome: HistoryOutcome;
    if (decision.action === "note") outcome = "note";
    else if (decision.action === "fixed") outcome = "fixed";
    else if (decision.action === "waive") outcome = "waived";
    else if (state === "disputed") outcome = "dispute_upheld";
    else outcome = "wont_fix_accepted";
    hit.finding.history.push({ by, outcome, note: decision.reason, actor: "human" });
    hit.finding.state = stateFromHistory(hit.finding.history);
    return { ok: true };
  }
  const req = findRequirement(task, decision.target);
  if (!req) return { ok: false, error: `Target ${decision.target} not found` };
  if (decision.action !== "waive") {
    return { ok: false, error: `Only --waive applies to requirements (${decision.target})` };
  }
  req.waived = { by, reason: decision.reason };
  return { ok: true };
}

// ── Refresh (snapshot) ──────────────────────────────────────────────

const CODE_KINDS: ReadonlySet<ChangeKind> = new Set(["code", "config", "dep"]);
const TEST_KINDS: ReadonlySet<ChangeKind> = new Set(["test", "stub", "fixture"]);

function requirementStatus(task: TaskFileV2, req: Requirement): RequirementStatus {
  if (req.id === UNATTRIBUTED_REQUIREMENT_ID) return "n/a";
  if (req.waived) return "waived";
  const gating = req.findings.some(
    (finding) => !finding.advisory && GATING_STATES.has(finding.state),
  );
  if (gating) return "open";
  if (req.verification?.result === "pass") return "satisfied";
  const hasCode = req.changes.some((change) => CODE_KINDS.has(change.kind));
  const pastCodeReview =
    task.control.phase === "phase-verify-task" || task.control.status === "done";
  if (hasCode && pastCodeReview) return "implemented";
  if (req.changes.some((change) => TEST_KINDS.has(change.kind)) || hasCode) return "covered";
  return "pending";
}

function blockerLine(req: Requirement, finding: Finding): SummaryBlocker {
  return {
    finding: finding.id,
    ac: req.id,
    severity: finding.severity,
    state: finding.state,
    issue: finding.issue.length > 160 ? `${finding.issue.slice(0, 157)}…` : finding.issue,
  };
}

function sortBySeverity(left: SummaryBlocker, right: SummaryBlocker): number {
  return SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
}

const SUMMARY_LIST_CAP = 10;

function computeNext(task: TaskFileV2, blockers: SummaryBlocker[]): TaskSummaryNext {
  const { control } = task;
  const id = task.work_item;
  const taskArg = `--task ${String(task.task)}`;
  if (control.in_flight?.stage === "spawned") {
    return {
      who: "harness",
      why: `Awaiting ${control.in_flight.ref}`,
      do: [`If the session died: accord resume ${id}`],
    };
  }
  if (control.in_flight?.stage === "returned") {
    return {
      who: "harness",
      why: `${control.in_flight.ref} returned but was not applied`,
      do: [`accord resume ${id}   (re-applies the saved return packet)`],
    };
  }
  if (control.status === "done") {
    return { who: "none", why: "Task complete", do: [] };
  }
  if (control.status === "blocked") {
    const block = control.blocked;
    const why = block?.reason ?? "Task blocked";
    if (block?.kind === "crash") {
      return {
        who: "human",
        why,
        do: [
          "Fix the crash (see the last test output in the sidecar folder)",
          `accord unblock ${id} ${taskArg}`,
          `accord resume ${id}`,
        ],
      };
    }
    if (block?.kind === "stuck") {
      return {
        who: "human",
        why,
        do: [
          `Answer the pending decision (accord decisions ${id})`,
          `accord unblock ${id} ${taskArg}`,
          `accord resume ${id}`,
        ],
      };
    }
    const first = blockers[0]?.finding ?? "F-nnn";
    const actions = [
      "Fix the blocking findings below, or accept/waive them",
      `accord unblock ${id} ${taskArg}   (or: --note|--fixed|--accept|--waive ${first} "reason")`,
      `accord resume ${id}`,
    ];
    if (block?.lifetime) {
      actions.unshift(
        "Lifetime cap reached — only --accept/--waive (or raising the config cap) can proceed",
      );
    }
    return { who: "human", why, do: actions };
  }
  const awaitingHuman = blockers.filter((blocker) => blocker.state === "wont_fix_proposed");
  if (
    awaitingHuman.length > 0 &&
    control.phase !== "review-test" &&
    control.phase !== "review-code"
  ) {
    return {
      who: "human",
      why: `${String(awaitingHuman.length)} wont_fix proposal(s) await acceptance`,
      do: [`accord unblock ${id} ${taskArg} --accept ${awaitingHuman[0].finding} "reason"`],
    };
  }
  return {
    who: "agent",
    why: `Round ${control.round}: ${control.phase} is next`,
    do: [`accord resume ${id}   (spawns ${control.phase})`],
  };
}

function computeHeadline(
  task: TaskFileV2,
  blockers: SummaryBlocker[],
  advisories: SummaryBlocker[],
): string {
  const { control } = task;
  const reqs = task.requirements.filter((req) => req.id !== UNATTRIBUTED_REQUIREMENT_ID);
  const acsOf = (list: SummaryBlocker[]) => [...new Set(list.map((item) => item.ac))].join(", ");
  const counts = (list: SummaryBlocker[]) => {
    const critical = list.filter((item) => item.severity === "critical").length;
    const other = list.length - critical;
    return `${String(critical)} critical + ${String(other)} other`;
  };
  if (control.in_flight) {
    return `RUNNING ${control.in_flight.ref} (${control.in_flight.stage})`;
  }
  if (control.status === "done") {
    const waived = reqs.filter((req) => req.waived).length;
    const advisoryNote = advisories.length ? ` ${String(advisories.length)} advisory open.` : "";
    return `DONE: ${String(reqs.length - waived)}/${String(reqs.length)} requirements satisfied${waived ? `, ${String(waived)} waived` : ""}.${advisoryNote}`;
  }
  if (control.status === "blocked") {
    const reason = control.blocked?.reason ?? "blocked";
    const tail = blockers.length ? ` ${counts(blockers)} blocking on ${acsOf(blockers)}.` : "";
    return `BLOCKED in ${control.phase} (${control.round}): ${reason}.${tail}`;
  }
  const tail = blockers.length
    ? ` ${String(blockers.length)} open finding(s) on ${acsOf(blockers)}.`
    : "";
  return `${control.round}: next ${control.phase}.${tail}`;
}

/** Recompute every snapshot field. Idempotent. */
export function refreshTask(task: TaskFileV2, at: string): TaskFileV2 {
  for (const req of task.requirements) {
    for (const finding of req.findings) {
      finding.state = req.waived ? "waived" : stateFromHistory(finding.history);
    }
  }
  const counts: Partial<Record<RequirementStatus, number>> = {};
  for (const req of task.requirements) {
    req.status = requirementStatus(task, req);
    if (req.id !== UNATTRIBUTED_REQUIREMENT_ID) {
      counts[req.status] = (counts[req.status] ?? 0) + 1;
    }
  }

  const blockers: SummaryBlocker[] = [];
  const advisories: SummaryBlocker[] = [];
  for (const { req, finding } of allFindings(task)) {
    if (req.waived) continue;
    if (!GATING_STATES.has(finding.state)) continue;
    if (finding.advisory) advisories.push(blockerLine(req, finding));
    else blockers.push(blockerLine(req, finding));
  }
  blockers.sort(sortBySeverity);
  advisories.sort(sortBySeverity);

  task.summary = {
    headline: computeHeadline(task, blockers, advisories),
    updated: at,
    requirements: counts,
    next: computeNext(task, blockers),
    blockers: blockers.slice(0, SUMMARY_LIST_CAP),
    advisories: advisories.slice(0, SUMMARY_LIST_CAP),
  };
  return task;
}

// ── Derived helpers for routing / briefs ────────────────────────────

/** Latest log entry written by `actor` (optionally within `round`). */
export function latestLogFor(task: TaskFileV2, actor: string): LogEntry | undefined {
  for (let index = task.log.length - 1; index >= 0; index -= 1) {
    if (refActor(task.log[index].ref) === actor) return task.log[index];
  }
  return undefined;
}

/** All ACs with ≥1 change from `by` — used as `ac_covered` for legacy consumers. */
export function acsTouchedBy(task: TaskFileV2, by: string): string[] {
  return task.requirements
    .filter(
      (req) =>
        req.id !== UNATTRIBUTED_REQUIREMENT_ID &&
        req.changes.some((change) => change.by.includes(by)),
    )
    .map((req) => req.id);
}

/** Union of files changed by kinds in `kinds` across all requirements. */
export function changedFiles(task: TaskFileV2, kinds?: ReadonlySet<ChangeKind>): string[] {
  const files = new Set<string>();
  for (const req of task.requirements) {
    for (const change of req.changes) {
      if (!kinds || kinds.has(change.kind)) files.add(change.file);
    }
  }
  return [...files];
}

export { CODE_KINDS, TEST_KINDS };
