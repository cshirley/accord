/**
 * Shared types for work item state management.
 *
 * Cross-cutting enums (`WorkItemPattern`, `IntentMode`, `IntentConfidence`,
 * `TerminalOutcome`, `ShiftLeftFinding`) are re-exported from `core/types/domain`
 * — that module is the single source of truth.
 */

import type {
  IntentConfidence,
  IntentMode,
  ShiftLeftFinding,
  TerminalOutcome,
  WorkItemPattern,
} from "../types/domain.js";

export type {
  IntentConfidence,
  IntentMode,
  ShiftLeftFinding,
  ShiftLeftFindingCategory,
  TerminalOutcome,
  WorkItemPattern,
} from "../types/domain.js";

export interface WorkItem {
  schema_version: string;
  id: string;
  title: string;
  created: string;
  updated: string;
  pattern: WorkItemPattern;
  variant?: string;
  phase: string;
  intent_mode?: IntentMode;
  intent_confidence?: IntentConfidence;
  escalation_ceiling?: string;
  target_paths?: string[];
  out_of_scope?: string[];
  expected_finish?: string;
  terminal_outcome?: TerminalOutcome;
  completed_at?: string;
  next_action?: string | null;
  retro?: {
    ran_at: string;
    verify_verdict?: string;
    post_run_rework_detected?: boolean;
    summary?: string;
    [key: string]: unknown;
  };
  shift_left_findings?: ShiftLeftFinding[];
  spec: string | null;
  plan: string | null;
  verify: string | null;
  brief: string | null;
  task_ids: number[];
  decisions: Decision[];
  deviations: Deviation[];
  cost_usd: number;
  /** phase-gather spawns since the last human escalation (see `maxGatherAttemptsFromDevConfig`). */
  gather_attempts?: number;
  [key: string]: unknown;
}

export interface Decision {
  id: string;
  source: string;
  status: string;
  question: string;
  context?: string;
  phase?: string;
  asked_at: string;
  answer?: string;
  resolved_at?: string;
}

export interface Deviation {
  task_id: number;
  description: string;
  reason: string;
  at: string;
  /** Legacy; prefer `resolution`. */
  status?: string;
  resolution?: "mechanical" | "blocking" | "accepted";
  resolved_at?: string;
  blocking_recommendation?: string;
}

/** Per-task file — v2 requirement-centric trace (see `src/tasks/types.ts`). */
export type { QuickFixContract, TaskEvent, TaskFileV2 as TaskFile } from "../tasks/types.js";

export interface Checkpoint {
  schema_version: string;
  work_item_id: string;
  phase: string;
  draft: unknown;
  answered: string[];
  pending: string[];
}
