/**
 * Committed implementation trace — `docs/dev/<ID>/trace.json` + `trace.md`.
 *
 * A harness-owned projection of the transient `.tasks/` state (work item + per-task v2 files
 * + test/verify output sidecars) into a compact, reviewable record: per-AC implementation and
 * verification, accepted risks, decisions, deviations, task commits, and the RED/GREEN evidence
 * excerpts. Raw agent packets and loop-control state stay in `.tasks/` (gitignored).
 *
 * Regenerate, don't edit: written when a task completes (before its commit), when verify.md is
 * rendered, and at finalize.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseRef, parseRound, refActor } from "../tasks/model.js";
import { loadTaskResult, readTaskSidecar, sidecarName } from "../tasks/store.js";
import type {
  FindingSeverity,
  FindingState,
  LoopKind,
  QuickFixContract,
  RequirementStatus,
  TaskFileV2,
} from "../tasks/types.js";
import { UNATTRIBUTED_REQUIREMENT_ID } from "../tasks/types.js";
import { err, ok, type Result } from "../types/result.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { loadWorkItem } from "../work-items/io.js";
import { resolveTasksDir } from "../work-items/tasks-dir.js";
import type { WorkItem } from "../work-items/types.js";
import { renderTraceMarkdown } from "./render-trace-markdown.js";

export const TRACE_SCHEMA_VERSION = "1.0";
/** Max characters kept from a test/verify output sidecar. */
export const TRACE_EXCERPT_MAX_CHARS = 1500;

export interface TraceExcerpt {
  /** Log ref of the run that produced the output (`T1/phase-test`, `V2/phase-verify-task`). */
  ref: string;
  excerpt: string;
  truncated: boolean;
}

export interface TraceChange {
  file: string;
  action: string;
  kind: string;
}

export interface TraceVerification {
  by: string;
  result: "pass" | "fail";
  /** Test names live once, on the matching `acceptance[]` entry. */
  test_count: number;
  command?: string;
}

export interface TraceRequirement {
  id: string;
  /** Only for requirements without an `acceptance[]` entry (`_task`); AC text lives there. */
  text?: string;
  status: RequirementStatus;
  waived?: { by: string; reason: string };
  changes: TraceChange[];
  verification: TraceVerification | null;
}

export interface TraceTask {
  id: number;
  title: string;
  status: string;
  commits: string[];
  rounds: Record<LoopKind, number>;
  retries: { test_review: number; code_review: number; rgr: number; verify: number };
  unblocks: number;
  blocked?: { kind: string; reason: string };
  findings: { total: number; by_state: Partial<Record<FindingState, number>> };
  human_actions: Array<{ ref: string; at: string; note: string }>;
  red_evidence: TraceExcerpt | null;
  final_verification: TraceExcerpt | null;
  quick_fix_contract?: QuickFixContract;
  requirements: TraceRequirement[];
}

export interface TraceAcceptance {
  ac_id: string;
  text: string;
  /** Worst requirement status across the tasks that cover this AC. */
  status: RequirementStatus;
  tasks: Array<{ task: number; status: RequirementStatus }>;
  files: string[];
  tests: string[];
  verified: boolean;
}

export type TraceRiskKind = "accepted" | "unresolved" | "waived_requirement";

export interface TraceRisk {
  kind: TraceRiskKind;
  task_id: number;
  requirement: string;
  finding_id?: string;
  state?: FindingState;
  severity?: FindingSeverity;
  advisory: boolean;
  issue: string;
  file?: string;
  line?: number;
  raised?: string;
  resolution?: { by: string; outcome: string; note?: string; actor?: "human" };
}

export interface WorkItemTrace {
  schema_version: typeof TRACE_SCHEMA_VERSION;
  work_item_id: string;
  generated_at: string;
  pattern: string;
  outcome: {
    terminal_outcome: string | null;
    completed_at: string | null;
    next_action: string | null;
    retro_summary: string | null;
    shift_left_findings: Array<{ category: string; evidence: string; recommendation: string }>;
  };
  decisions: Array<{
    id: string;
    source: string;
    status: string;
    question: string;
    answer: string | null;
    phase?: string;
  }>;
  deviations: Array<{
    task_id: number;
    description: string;
    reason: string;
    resolution: string | null;
    blocking_recommendation?: string;
  }>;
  tasks: TraceTask[];
  acceptance: TraceAcceptance[];
  accepted_risks: TraceRisk[];
}

const ACCEPTED_STATES: ReadonlySet<FindingState> = new Set([
  "wont_fix_accepted",
  "dispute_upheld",
  "waived",
]);
const CLOSED_STATES: ReadonlySet<FindingState> = new Set(["verified", "superseded"]);

/** Requirement ids rolled up into `acceptance[]`. */
const ACCEPTANCE_ID = /^(AC-\d+|QF)$/;

const STATUS_RANK: Record<RequirementStatus, number> = {
  pending: 0,
  covered: 1,
  open: 2,
  implemented: 3,
  satisfied: 4,
  waived: 5,
  "n/a": 6,
};

export function traceJsonPath(workItemId: string): string {
  return path.join(devArtifactDirRel(workItemId), "trace.json");
}

export function traceMarkdownPath(workItemId: string): string {
  return path.join(devArtifactDirRel(workItemId), "trace.md");
}

function excerpt(text: string, ref: string): TraceExcerpt {
  const trimmed = text.trim();
  const truncated = trimmed.length > TRACE_EXCERPT_MAX_CHARS;
  return {
    ref,
    excerpt: truncated ? `${trimmed.slice(0, TRACE_EXCERPT_MAX_CHARS)}…` : trimmed,
    truncated,
  };
}

/** Output sidecar for the first (`first`) or last run of `actor` that wrote one. */
function outputExcerptFor(
  task: TaskFileV2,
  actor: string,
  which: "first" | "last",
): TraceExcerpt | null {
  const entries = task.log.filter((entry) => refActor(entry.ref) === actor);
  const ordered = which === "first" ? entries : [...entries].reverse();
  for (const entry of ordered) {
    const text = readTaskSidecar(task.work_item, task.task, sidecarName(entry.ref, "output.txt"));
    if (text?.trim()) return excerpt(text, entry.ref);
  }
  return null;
}

function countRounds(task: TaskFileV2): Record<LoopKind, number> {
  const rounds: Record<LoopKind, Set<string>> = { T: new Set(), C: new Set(), V: new Set() };
  for (const entry of task.log) {
    const parsed = parseRef(entry.ref);
    const round = parsed ? parseRound(parsed.round) : null;
    if (parsed && round) rounds[round.loop].add(parsed.round);
  }
  return { T: rounds.T.size, C: rounds.C.size, V: rounds.V.size };
}

function commitHashes(task: TaskFileV2): string[] {
  return task.log
    .filter((entry) => refActor(entry.ref) === "commit" && entry.result === "committed")
    .map((entry) => entry.note.split(/\s+/)[0] ?? "")
    .filter(Boolean);
}

function projectTask(task: TaskFileV2): {
  task: TraceTask;
  risks: TraceRisk[];
  acceptance: Array<{ id: string; text: string; status: RequirementStatus; tests: string[] }>;
} {
  const byState: Partial<Record<FindingState, number>> = {};
  const risks: TraceRisk[] = [];
  let total = 0;

  for (const req of task.requirements) {
    if (req.waived) {
      risks.push({
        kind: "waived_requirement",
        task_id: task.task,
        requirement: req.id,
        advisory: false,
        issue: req.text,
        resolution: { by: req.waived.by, outcome: "waived", note: req.waived.reason },
      });
    }
    for (const finding of req.findings) {
      total++;
      byState[finding.state] = (byState[finding.state] ?? 0) + 1;
      if (CLOSED_STATES.has(finding.state)) continue;
      const last = finding.history[finding.history.length - 1];
      risks.push({
        kind: ACCEPTED_STATES.has(finding.state) ? "accepted" : "unresolved",
        task_id: task.task,
        requirement: req.id,
        finding_id: finding.id,
        state: finding.state,
        severity: finding.severity,
        advisory: finding.advisory === true,
        issue: finding.issue,
        ...(finding.file ? { file: finding.file } : {}),
        ...(finding.line ? { line: finding.line } : {}),
        raised: finding.raised,
        ...(last
          ? {
              resolution: {
                by: last.by,
                outcome: last.outcome,
                ...(last.note ? { note: last.note } : {}),
                ...(last.actor ? { actor: last.actor } : {}),
              },
            }
          : {}),
      });
    }
  }

  const requirements: TraceRequirement[] = task.requirements
    .filter((req) => req.changes.length > 0 || req.id !== UNATTRIBUTED_REQUIREMENT_ID)
    .map((req) => ({
      id: req.id,
      ...(ACCEPTANCE_ID.test(req.id) ? {} : { text: req.text }),
      status: req.status,
      ...(req.waived ? { waived: req.waived } : {}),
      changes: req.changes.map((change) => ({
        file: change.file,
        action: change.action,
        kind: change.kind,
      })),
      verification: req.verification
        ? {
            by: req.verification.by,
            result: req.verification.result,
            test_count: req.verification.tests.length,
            ...(req.verification.command ? { command: req.verification.command } : {}),
          }
        : null,
    }));

  const retries = task.control.retries;
  const projected: TraceTask = {
    id: task.task,
    title: task.title,
    status: task.control.status,
    commits: commitHashes(task),
    rounds: countRounds(task),
    retries: {
      test_review: retries.test_review.lifetime,
      code_review: retries.code_review.lifetime,
      rgr: retries.rgr.lifetime,
      verify: retries.verify.lifetime,
    },
    unblocks: retries.unblocks,
    ...(task.control.blocked
      ? { blocked: { kind: task.control.blocked.kind, reason: task.control.blocked.reason } }
      : {}),
    findings: { total, by_state: byState },
    human_actions: task.log
      .filter((entry) => entry.actor === "human")
      .map((entry) => ({ ref: entry.ref, at: entry.at, note: entry.note })),
    red_evidence: outputExcerptFor(task, "phase-test", "first"),
    final_verification: outputExcerptFor(task, "phase-verify-task", "last"),
    ...(task.control.quick_fix_contract
      ? { quick_fix_contract: task.control.quick_fix_contract }
      : {}),
    requirements,
  };
  const acceptance = task.requirements
    .filter((req) => ACCEPTANCE_ID.test(req.id))
    .map((req) => ({
      id: req.id,
      text: req.text,
      status: req.status,
      tests: req.verification?.tests ?? [],
    }));
  return { task: projected, risks, acceptance };
}

function rollupAcceptance(
  tasks: TraceTask[],
  sources: Map<number, Array<{ id: string; text: string; tests: string[] }>>,
): TraceAcceptance[] {
  const byAc = new Map<string, TraceAcceptance>();
  for (const task of tasks) {
    const sourceById = new Map((sources.get(task.id) ?? []).map((source) => [source.id, source]));
    for (const req of task.requirements) {
      const source = sourceById.get(req.id);
      if (!source) continue;
      const entry = byAc.get(req.id) ?? {
        ac_id: req.id,
        text: source.text,
        status: req.status,
        tasks: [],
        files: [],
        tests: [],
        verified: false,
      };
      entry.tasks.push({ task: task.id, status: req.status });
      if (STATUS_RANK[req.status] < STATUS_RANK[entry.status]) entry.status = req.status;
      for (const change of req.changes) {
        if (!entry.files.includes(change.file)) entry.files.push(change.file);
      }
      for (const test of source.tests) {
        if (!entry.tests.includes(test)) entry.tests.push(test);
      }
      byAc.set(req.id, entry);
    }
  }
  for (const entry of byAc.values()) {
    entry.verified = entry.tasks.every(
      (taskEntry) => taskEntry.status === "satisfied" || taskEntry.status === "waived",
    );
  }
  const order = (id: string) =>
    id.startsWith("AC-") ? Number(id.slice(3)) : Number.MAX_SAFE_INTEGER;
  return [...byAc.values()].sort((a, b) => order(a.ac_id) - order(b.ac_id));
}

/** Task ids from `wi.task_ids`, falling back to `<ID>-task-N.json` files on disk. */
export function listWorkItemTaskIds(workItemId: string, wi: WorkItem | null): number[] {
  const ids = new Set<number>(wi?.task_ids ?? []);
  try {
    const dir = resolveTasksDir(workItemId);
    const pattern = new RegExp(`^${workItemId}-task-(\\d+)\\.json$`);
    for (const name of fs.readdirSync(dir)) {
      const match = pattern.exec(name);
      if (match) ids.add(Number(match[1]));
    }
  } catch {
    // no .tasks dir — rely on wi.task_ids
  }
  return [...ids].sort((a, b) => a - b);
}

/** Build the trace from `.tasks/` without writing it. */
export function buildWorkItemTrace(
  workItemId: string,
  generatedAt: string = new Date().toISOString(),
): Result<WorkItemTrace> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const tasks: TraceTask[] = [];
  const risks: TraceRisk[] = [];
  const sources = new Map<number, Array<{ id: string; text: string; tests: string[] }>>();
  for (const taskId of listWorkItemTaskIds(workItemId, wi)) {
    const loaded = loadTaskResult(workItemId, taskId);
    if (loaded.kind !== "ok") continue;
    const projected = projectTask(loaded.task);
    tasks.push(projected.task);
    risks.push(...projected.risks);
    sources.set(projected.task.id, projected.acceptance);
  }

  return ok({
    schema_version: TRACE_SCHEMA_VERSION,
    work_item_id: workItemId,
    generated_at: generatedAt,
    pattern: wi.pattern,
    outcome: {
      terminal_outcome: wi.terminal_outcome ?? null,
      completed_at: wi.completed_at ?? null,
      next_action: wi.next_action ?? null,
      retro_summary: typeof wi.retro?.summary === "string" ? wi.retro.summary : null,
      shift_left_findings: (wi.shift_left_findings ?? []).map((finding) => ({
        category: finding.category,
        evidence: finding.evidence,
        recommendation: finding.recommendation,
      })),
    },
    decisions: (wi.decisions ?? []).map((decision) => ({
      id: decision.id,
      source: decision.source,
      status: decision.status,
      question: decision.question,
      answer: decision.answer ?? null,
      ...(decision.phase ? { phase: decision.phase } : {}),
    })),
    deviations: (wi.deviations ?? []).map((deviation) => ({
      task_id: deviation.task_id,
      description: deviation.description,
      reason: deviation.reason ?? "",
      resolution: deviation.resolution ?? deviation.status ?? null,
      ...(deviation.blocking_recommendation
        ? { blocking_recommendation: deviation.blocking_recommendation }
        : {}),
    })),
    tasks,
    acceptance: rollupAcceptance(tasks, sources),
    accepted_risks: risks,
  });
}

/** Load a previously written `trace.json`, or `null`. */
export function readWorkItemTrace(workItemId: string): WorkItemTrace | null {
  try {
    return JSON.parse(fs.readFileSync(traceJsonPath(workItemId), "utf8")) as WorkItemTrace;
  } catch {
    return null;
  }
}

/** Build and write `trace.json` + `trace.md` under `docs/dev/<ID>/`. */
export function writeWorkItemTrace(workItemId: string): Result<{
  json_path: string;
  markdown_path: string;
  trace: WorkItemTrace;
}> {
  const built = buildWorkItemTrace(workItemId);
  if (!built.ok) return built;
  const jsonPath = traceJsonPath(workItemId);
  const markdownPath = traceMarkdownPath(workItemId);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(built.value, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderTraceMarkdown(built.value), "utf8");
  return ok({ json_path: jsonPath, markdown_path: markdownPath, trace: built.value });
}
