/**
 * Work item lifecycle — bootstrap, transition, event promotion.
 */

import * as path from "node:path";
import { createLogger } from "../logging.js";
import { err, ok, type Result } from "../types/result.js";
import { devCheckpointDelete } from "./checkpoint.js";
import { loadTaskFile, loadWorkItem, now, TASKS_DIR, writeJson } from "./io.js";
import type {
  IntentConfidence,
  IntentMode,
  ShiftLeftFinding,
  TerminalOutcome,
  WorkItem,
  WorkItemPattern,
} from "./types.js";

const log = createLogger("work-items");

function parseTaskId(taskId: string | number): number | null {
  if (typeof taskId === "number" && Number.isFinite(taskId)) return taskId;
  if (typeof taskId === "string" && /^\d+$/.test(taskId.trim())) {
    const n = Number(taskId.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Bootstrap ──────────────────────────────────────────────

const ENTRY_PHASES: Record<string, Record<string, string>> = {
  implement: { standard: "aligning", orchestrated: "aligning", express: "implementing" },
  quick_fix: { _default: "fixing" },
  investigate: { _default: "gathering" },
  infra: { _default: "exploring" },
  analyse: { _default: "researching" },
};

export interface IntentContractInput {
  intent_mode?: IntentMode;
  intent_confidence?: IntentConfidence;
  escalation_ceiling?: string;
  target_paths?: string[];
  out_of_scope?: string[];
  expected_finish?: string;
}

export function devBootstrap(
  id: string,
  title: string,
  pattern: WorkItemPattern,
  variant?: string,
  intent?: IntentContractInput,
): { path: string; work_item: WorkItem } {
  const phases = ENTRY_PHASES[pattern] || { _default: "speccing" };
  const phase = (variant && phases[variant]) || phases._default || "speccing";
  const timestamp = now();

  const wi: WorkItem = {
    schema_version: "1.0",
    id,
    title,
    created: timestamp,
    updated: timestamp,
    pattern,
    variant: variant || undefined,
    phase,
    spec: null,
    plan: null,
    verify: null,
    brief: null,
    task_ids: [],
    decisions: [],
    deviations: [],
    cost_usd: 0,
  };

  if (intent?.intent_mode) wi.intent_mode = intent.intent_mode;
  if (intent?.intent_confidence) wi.intent_confidence = intent.intent_confidence;
  if (intent?.escalation_ceiling) wi.escalation_ceiling = intent.escalation_ceiling;
  if (intent?.target_paths?.length) wi.target_paths = intent.target_paths;
  if (intent?.out_of_scope?.length) wi.out_of_scope = intent.out_of_scope;
  if (intent?.expected_finish) wi.expected_finish = intent.expected_finish;

  if (!wi.variant) wi.variant = undefined;

  const wiPath = path.join(TASKS_DIR, `${id}.json`);
  writeJson(wiPath, wi);
  return { path: wiPath, work_item: wi };
}

// ── Transition ─────────────────────────────────────────────

export function devTransition(
  id: string,
  nextPhase: string,
  updates?: { spec?: string; plan?: string; verify?: string; brief?: string },
): Result<{ work_item: WorkItem }> {
  const wi = loadWorkItem(id);
  if (!wi) return err(`Work item not found: ${id}`);

  wi.phase = nextPhase;
  wi.updated = now();
  if (updates?.spec) wi.spec = updates.spec;
  if (updates?.plan) wi.plan = updates.plan;
  if (updates?.verify) wi.verify = updates.verify;
  if (updates?.brief) wi.brief = updates.brief;

  writeJson(path.join(TASKS_DIR, `${id}.json`), wi);
  devCheckpointDelete(id);

  return ok({ work_item: wi });
}

// ── Finalization / retrospective summary ───────────────────

export interface FinalizeWorkItemInput {
  terminal_outcome: TerminalOutcome;
  next_action?: string | null;
  retro?: {
    ran_at?: string;
    verify_verdict?: string;
    post_run_rework_detected?: boolean;
    summary?: string;
    [key: string]: unknown;
  };
  shift_left_findings?: ShiftLeftFinding[];
}

export function devFinalizeWorkItem(
  id: string,
  input: FinalizeWorkItemInput,
): Result<{ work_item: WorkItem }> {
  const wi = loadWorkItem(id);
  if (!wi) return err(`Work item not found: ${id}`);

  const timestamp = now();
  wi.terminal_outcome = input.terminal_outcome;
  wi.completed_at = timestamp;
  wi.next_action = input.next_action ?? null;
  if (input.retro) wi.retro = { ...input.retro, ran_at: input.retro.ran_at || timestamp };
  if (input.shift_left_findings) wi.shift_left_findings = input.shift_left_findings;
  wi.updated = timestamp;

  writeJson(path.join(TASKS_DIR, `${id}.json`), wi);
  return ok({ work_item: wi });
}

// ── Event promotion ────────────────────────────────────────

export interface PromotionResult {
  escalations_added: number;
  deviations_added: number;
  review_requested: boolean;
  review_agents: string[];
}

export function devPromoteEvents(workItemId: string, taskId: string): PromotionResult {
  const empty: PromotionResult = {
    escalations_added: 0,
    deviations_added: 0,
    review_requested: false,
    review_agents: [],
  };

  const tf = loadTaskFile(workItemId, taskId);
  if (!tf) return empty;

  const wi = loadWorkItem(workItemId);
  if (!wi) return empty;

  let escalations = 0;
  let devs = 0;
  let reviewRequested = false;
  const reviewAgents: string[] = [];
  const existingDecisionIds = new Set((wi.decisions || []).map((d) => d.id));

  // Decision IDs encode the per-task event index so re-running promotion on
  // a task with new escalations doesn't collide with previously-promoted IDs.
  const events = tf.events || [];
  const numericTaskId = parseTaskId(taskId);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    switch (event.type) {
      case "escalation": {
        const decisionId = `esc-${workItemId}-${taskId}-evt${i}`;
        if (existingDecisionIds.has(decisionId)) continue;
        wi.decisions.push({
          id: decisionId,
          source: "escalation",
          status: "pending",
          question: event.question || "Unknown question",
          context: event.context,
          phase: event.phase || wi.phase,
          asked_at: now(),
        });
        existingDecisionIds.add(decisionId);
        escalations++;
        break;
      }
      case "deviation": {
        if (numericTaskId === null) {
          log.warn(
            `devPromoteEvents: skipping deviation for non-numeric taskId="${taskId}" on ${workItemId}`,
          );
          continue;
        }
        const alreadyExists = wi.deviations.some(
          (d) => d.task_id === numericTaskId && d.description === event.description,
        );
        if (alreadyExists) continue;
        wi.deviations.push({
          task_id: numericTaskId,
          description: event.description || "",
          reason: event.reason || "",
          at: now(),
        });
        devs++;
        break;
      }
      case "request_review": {
        reviewRequested = true;
        reviewAgents.push("review-code");
        const files: string[] = event.files || [];
        const hasTestFiles = files.some(
          (f) =>
            /\.test\.|\.spec\.|_test\.(go|rs)|test_.*\.py|_spec\.rb|Test\.java|Tests\.cs/i.test(
              f,
            ) || /\/(test|__tests__|tests|spec)\//.test(f),
        );
        if (hasTestFiles) reviewAgents.push("review-test");
        const hasSecurityFiles = files.some((f) => /(auth|payment|api|public.?api)/i.test(f));
        if (hasSecurityFiles) reviewAgents.push("review-security");
        break;
      }
    }
  }

  if (escalations > 0 || devs > 0) {
    wi.updated = now();
    writeJson(path.join(TASKS_DIR, `${workItemId}.json`), wi);
  }

  return {
    escalations_added: escalations,
    deviations_added: devs,
    review_requested: reviewRequested,
    review_agents: reviewAgents,
  };
}

// ── Preflight receipt ──────────────────────────────────────

export function devWritePreflightReceipt(
  workItemId: string,
  commands: string[],
  exitCodes: number[],
): { path: string } {
  const receiptPath = path.join(TASKS_DIR, `.verify-preflight-${workItemId}.json`);
  writeJson(receiptPath, {
    work_item_id: workItemId,
    ran_at: Math.floor(Date.now() / 1000),
    commands,
    exit_codes: exitCodes,
  });
  return { path: receiptPath };
}
