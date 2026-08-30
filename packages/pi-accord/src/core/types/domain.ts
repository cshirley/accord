/**
 * Single source of truth for cross-cutting domain enums.
 *
 * Anything used by both `core/work-items/` and `core/commands/` (or shared
 * with `core/queries/`) lives here so we don't drift between files.
 */

// ── Work item / pipeline shape ─────────────────────────────────

export type WorkItemPattern = "implement" | "quick_fix" | "investigate" | "infra" | "analyse";

export type WorkItemVariant = "express" | "standard" | "orchestrated";

// ── Intent classification ──────────────────────────────────────

export type IntentMode =
  | "narrow_change"
  | "pipeline"
  | "review"
  | "commit"
  | "explain"
  | "investigate";

export type IntentConfidence = "high" | "medium" | "low";

export type EscalationCeiling =
  | "pipeline_allowed"
  | "no_pipeline_without_confirmation"
  | "no_implementation_without_confirmation"
  | "read_only_until_confirmed"
  | "no_edits";

// ── Terminal outcomes ──────────────────────────────────────────

export type TerminalOutcome = "done" | "blocked" | "partially_achieved" | "unclear";

// ── Shift-left findings (retro + finalize) ─────────────────────

export type ShiftLeftFindingCategory =
  | "intent_scoping"
  | "artifact_preflight"
  | "tool_environment"
  | "subagent_reliability"
  | "terminal_outcome"
  | "spec_plan_gap";

export interface ShiftLeftFinding {
  category: ShiftLeftFindingCategory;
  evidence: string;
  recommendation: string;
}
