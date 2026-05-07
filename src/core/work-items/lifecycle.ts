/**
 * Work item lifecycle — bootstrap, transition, event promotion.
 */

import * as path from "node:path";
import type { IntentConfidence, IntentMode, ShiftLeftFinding, WorkItemPattern, WorkItem } from "./types.js";
import { TASKS_DIR, loadWorkItem, loadTaskFile, writeJson, now } from "./io.js";
import { devCheckpointDelete } from "./checkpoint.js";

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

  if (!wi.variant) delete wi.variant;

  const wiPath = path.join(TASKS_DIR, `${id}.json`);
  writeJson(wiPath, wi);
  return { path: wiPath, work_item: wi };
}

// ── Transition ─────────────────────────────────────────────

export function devTransition(
  id: string,
  nextPhase: string,
  updates?: { spec?: string; plan?: string; verify?: string; brief?: string },
): { work_item: WorkItem } | { error: string } {
  const wi = loadWorkItem(id);
  if (!wi) return { error: `Work item not found: ${id}` };

  wi.phase = nextPhase;
  wi.updated = now();
  if (updates?.spec) wi.spec = updates.spec;
  if (updates?.plan) wi.plan = updates.plan;
  if (updates?.verify) wi.verify = updates.verify;
  if (updates?.brief) wi.brief = updates.brief;

  writeJson(path.join(TASKS_DIR, `${id}.json`), wi);
  devCheckpointDelete(id);

  return { work_item: wi };
}

// ── Finalization / retrospective summary ───────────────────

export interface FinalizeWorkItemInput {
  terminal_outcome: "done" | "blocked" | "partially_achieved" | "unclear";
  next_action?: string | null;
  retro?: {
    ran_at?: string;
    verify_verdict?: string;
    post_run_rework_detected?: boolean;
    summary?: string;
    [key: string]: any;
  };
  shift_left_findings?: ShiftLeftFinding[];
}

export function devFinalizeWorkItem(
  id: string,
  input: FinalizeWorkItemInput,
): { work_item: WorkItem } | { error: string } {
  const wi = loadWorkItem(id);
  if (!wi) return { error: `Work item not found: ${id}` };

  const timestamp = now();
  wi.terminal_outcome = input.terminal_outcome;
  wi.completed_at = timestamp;
  wi.next_action = input.next_action ?? null;
  if (input.retro) wi.retro = { ...input.retro, ran_at: input.retro.ran_at || timestamp };
  if (input.shift_left_findings) wi.shift_left_findings = input.shift_left_findings;
  wi.updated = timestamp;

  writeJson(path.join(TASKS_DIR, `${id}.json`), wi);
  return { work_item: wi };
}

// ── Event promotion ────────────────────────────────────────

export interface PromotionResult {
  escalations_added: number;
  deviations_added: number;
  review_requested: boolean;
  review_agents: string[];
}

export function devPromoteEvents(
  workItemId: string,
  taskId: string,
): PromotionResult {
  const empty: PromotionResult = { escalations_added: 0, deviations_added: 0, review_requested: false, review_agents: [] };

  const tf = loadTaskFile(workItemId, taskId);
  if (!tf) return empty;

  const wi = loadWorkItem(workItemId);
  if (!wi) return empty;

  let escalations = 0;
  let devs = 0;
  let reviewRequested = false;
  const reviewAgents: string[] = [];
  const existingDecisionIds = new Set((wi.decisions || []).map(d => d.id));

  for (const event of (tf.events || [])) {
    switch (event.type) {
      case "escalation": {
        const decisionId = `esc-${workItemId}-${taskId}-${escalations}`;
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
        const numericTaskId = parseInt(taskId, 10);
        const alreadyExists = wi.deviations.some(
          d => d.task_id === numericTaskId && d.description === event.description,
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
        const hasTestFiles = files.some(f =>
          /\.test\.|\.spec\.|_test\.(go|rs)|test_.*\.py|_spec\.rb|Test\.java|Tests\.cs/i.test(f) ||
          /\/(test|__tests__|tests|spec)\//.test(f),
        );
        if (hasTestFiles) reviewAgents.push("review-test");
        const hasSecurityFiles = files.some(f =>
          /(auth|payment|api|public.?api)/i.test(f),
        );
        if (hasSecurityFiles) reviewAgents.push("review-security");
        break;
      }
    }
  }

  if (escalations > 0 || devs > 0) {
    wi.updated = now();
    writeJson(path.join(TASKS_DIR, `${workItemId}.json`), wi);
  }

  return { escalations_added: escalations, deviations_added: devs, review_requested: reviewRequested, review_agents: reviewAgents };
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
