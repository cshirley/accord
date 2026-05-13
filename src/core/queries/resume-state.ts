/**
 * Resume state — determine where to pick up a work item.
 */

import { err, ok, type Result } from "../types/result.js";
import { devCheckpointRead } from "../work-items/checkpoint.js";
import { loadWorkItem } from "../work-items/io.js";

export interface ResumeState {
  id: string;
  phase: string;
  has_checkpoint: boolean;
  checkpoint_phase?: string;
  title: string;
  pattern: string;
  variant?: string;
  intent_mode?: string;
  escalation_ceiling?: string;
  target_paths?: string[];
  out_of_scope?: string[];
  expected_finish?: string;
}

export function devResumeState(id: string): Result<ResumeState> {
  const wi = loadWorkItem(id);
  if (!wi) return err(`No active work item for ${id}. Run /dev <description> to start one.`);

  const cp = devCheckpointRead(id);
  return ok({
    id: wi.id,
    phase: cp ? cp.phase : wi.phase,
    has_checkpoint: !!cp,
    checkpoint_phase: cp?.phase,
    title: wi.title,
    pattern: wi.pattern,
    variant: wi.variant,
    intent_mode: wi.intent_mode,
    escalation_ceiling: wi.escalation_ceiling,
    target_paths: wi.target_paths,
    out_of_scope: wi.out_of_scope,
    expected_finish: wi.expected_finish,
  });
}
