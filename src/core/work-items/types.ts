/**
 * Shared types for work item state management.
 */

export type WorkItemPattern = "implement" | "quick_fix" | "investigate" | "infra" | "analyse";
export type IntentMode =
  | "narrow_change"
  | "pipeline"
  | "review"
  | "commit"
  | "explain"
  | "investigate";
export type IntentConfidence = "high" | "medium" | "low";

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
  terminal_outcome?: "done" | "blocked" | "partially_achieved" | "unclear";
  completed_at?: string;
  next_action?: string | null;
  retro?: {
    ran_at: string;
    verify_verdict?: string;
    post_run_rework_detected?: boolean;
    summary?: string;
    [key: string]: any;
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
  [key: string]: any;
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

export interface ShiftLeftFinding {
  category: string;
  evidence: string;
  recommendation: string;
}

export interface Deviation {
  task_id: number;
  description: string;
  reason: string;
  at: string;
  status?: string;
  blocking_recommendation?: string;
}

export interface TaskFile {
  schema_version: string;
  work_item_id: string;
  task_id: number;
  owner_nonce: string;
  phase: string;
  status: string;
  quick_fix_contract?: QuickFixContract;
  events: TaskEvent[];
  [key: string]: any;
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

export interface TaskEvent {
  type: string;
  question?: string;
  context?: string;
  phase?: string;
  description?: string;
  reason?: string;
  files?: string[];
  [key: string]: any;
}

export interface Checkpoint {
  schema_version: string;
  work_item_id: string;
  phase: string;
  draft: any;
  answered: string[];
  pending: string[];
}
